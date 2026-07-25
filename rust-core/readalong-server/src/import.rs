use axum::{
    Json,
    extract::{Multipart, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::align::FuzzyAligner;
use crate::db::LibraryDb;
use crate::transcribe::{AudioChunker, extract_audio_to_wav, transcribe_audio_chunk};

#[derive(Serialize)]
pub struct ImportResponse {
    pub book_id: String,
    pub message: String,
}

use axum::extract::Path as AxumPath;

#[derive(Serialize)]
pub struct StatusResponse {
    pub status: String,
    pub sync_map: Option<Vec<readalong_core::sync::SyncPoint>>,
}

pub async fn handle_status(
    State(db): State<Arc<Mutex<LibraryDb>>>,
    AxumPath(book_id): AxumPath<String>,
) -> impl IntoResponse {
    let db_lock = db.lock().unwrap();
    let status = match db_lock.get_book_status(&book_id) {
        Ok(s) => s,
        Err(_) => return (StatusCode::NOT_FOUND, "Book not found").into_response(),
    };

    // Always return sync map if it exists, so client can get partial progress
    let sync_map = db_lock.get_sync_map(&book_id).ok();

    (StatusCode::OK, Json(StatusResponse { status, sync_map })).into_response()
}

pub async fn handle_update_sync_map(
    State(db): State<Arc<Mutex<LibraryDb>>>,
    AxumPath(book_id): AxumPath<String>,
    Json(sync_points): Json<Vec<readalong_core::sync::SyncPoint>>,
) -> impl IntoResponse {
    let db_lock = db.lock().unwrap();
    if let Err(e) = db_lock.save_sync_map(&book_id, &sync_points) {
        tracing::error!("Failed to save sync map for {}: {}", book_id, e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
            .into_response();
    }

    (StatusCode::OK, "Sync map updated successfully").into_response()
}

pub async fn handle_import(
    State(db): State<Arc<Mutex<LibraryDb>>>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let book_id = Uuid::new_v4().to_string();
    let data_dir_str = std::env::var("DATA_DIR").unwrap_or_else(|_| ".".to_string());
    let tmp_dir = PathBuf::from(data_dir_str)
        .join("tmp_uploads")
        .join(&book_id);

    if let Err(e) = tokio::fs::create_dir_all(&tmp_dir).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create directory: {}", e),
        )
            .into_response();
    }

    let mut epub_path = None;
    let mut audio_path = None;

    while let Ok(Some(mut field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        let file_name = field.file_name().unwrap_or("unknown").to_string();

        let is_epub = name == "epub" || file_name.ends_with(".epub");
        let is_audio = name == "audio"
            || file_name.ends_with(".mp3")
            || file_name.ends_with(".m4b")
            || file_name.ends_with(".m4a");

        let path = if is_epub {
            tmp_dir.join("upload.epub")
        } else if is_audio {
            tmp_dir.join("upload.audio") // Extension doesn't matter for ffmpeg, it detects format
        } else {
            continue; // Ignore unknown fields
        };

        let mut file = match tokio::fs::File::create(&path).await {
            Ok(f) => f,
            Err(e) => {
                tracing::error!("Failed to create file {:?}: {}", path, e);
                continue;
            }
        };

        use tokio::io::AsyncWriteExt;
        let mut success = true;
        while let Ok(Some(chunk)) = field.chunk().await {
            if let Err(e) = file.write_all(&chunk).await {
                tracing::error!("Failed to write chunk to {:?}: {}", path, e);
                success = false;
                break;
            }
        }

        if success {
            if is_epub {
                epub_path = Some(path);
            } else if is_audio {
                audio_path = Some(path);
            }
        }
    }

    let epub_path = match epub_path {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, "Missing epub file").into_response(),
    };

    let audio_path = match audio_path {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, "Missing audio file").into_response(),
    };

    let book_id_clone = book_id.clone();

    // Fire and forget the processing task using spawn_blocking to prevent async starvation
    tokio::task::spawn_blocking(move || {
        tracing::info!("Starting processing for book {}", book_id_clone);

        // Update database status: Processing (in a real app, we'd have a status column)
        {
            let db_lock = db.lock().unwrap();
            if let Err(e) = db_lock.insert_book(
                &book_id_clone,
                "Unknown Title",
                "Unknown",
                epub_path.to_str().unwrap(),
                audio_path.to_str().unwrap(),
                "Processing...",
            ) {
                tracing::error!(
                    "Failed to insert initial book state {}: {}",
                    book_id_clone,
                    e
                );
            }
        }

        // Helper to mark failure
        let set_error = |err_msg: &str| {
            let db_lock = db.lock().unwrap();
            if let Err(e) = db_lock.insert_book(
                &book_id_clone,
                "Unknown Title",
                "Unknown",
                epub_path.to_str().unwrap(),
                audio_path.to_str().unwrap(),
                &format!("Error: {}", err_msg),
            ) {
                tracing::error!("Failed to update error state for {}: {}", book_id_clone, e);
            }
        };

        let wav_path = tmp_dir.join("extracted.wav");
        if let Err(e) = extract_audio_to_wav(&audio_path, &wav_path) {
            tracing::error!("Extraction failed for {}: {}", book_id_clone, e);
            set_error("Audio extraction failed");
            return;
        }

        // Ideally the model path would be configurable. We'll use a local model if available.
        // During docker build we can download it to /models/ggml-small.en.bin
        let model_path = Path::new("/models/ggml-small.en.bin");
        let fallback_model = Path::new("ggml-small.en.bin");

        let epub_bytes = match std::fs::read(&epub_path) {
            Ok(b) => b,
            Err(e) => {
                tracing::error!("Failed to read epub {}: {}", book_id_clone, e);
                set_error("Failed to read EPUB");
                return;
            }
        };

        // Extract content blocks
        let mut archive = match zip::ZipArchive::new(std::io::Cursor::new(&epub_bytes)) {
            Ok(a) => a,
            Err(e) => {
                tracing::error!("Failed to open epub as zip: {}", e);
                set_error("Failed to parse EPUB");
                return;
            }
        };

        let opf_path = match readalong_core::epub::find_opf_path(&mut archive) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("Failed to find opf path: {}", e);
                set_error("Invalid EPUB format");
                return;
            }
        };

        let opf_xml = match readalong_core::epub::read_zip_entry_as_string(&mut archive, &opf_path)
        {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Failed to read opf xml: {}", e);
                set_error("Invalid EPUB format");
                return;
            }
        };

        let spine = match readalong_core::epub::parse_opf_spine(&opf_xml) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Failed to parse opf spine: {}", e);
                set_error("Invalid EPUB format");
                return;
            }
        };

        let mut title = None;
        let mut author = None;
        if let Ok(doc) = roxmltree::Document::parse(&opf_xml) {
            if let Some(metadata) = doc
                .descendants()
                .find(|n| n.tag_name().name() == "metadata")
            {
                for child in metadata.children() {
                    if child.tag_name().name() == "title" {
                        title = child.text().map(|s| s.to_string());
                    } else if child.tag_name().name() == "creator" {
                        author = child.text().map(|s| s.to_string());
                    }
                }
            }
        }

        let opf_dir = if let Some(idx) = opf_path.rfind('/') {
            &opf_path[..idx]
        } else {
            ""
        };

        let mut all_paragraphs = Vec::new();

        for item in spine {
            let full_path = readalong_core::epub::resolve_opf_relative(opf_dir, &item.href);
            let html =
                match readalong_core::epub::read_zip_entry_as_string(&mut archive, &full_path) {
                    Ok(s) => s,
                    Err(e) => {
                        tracing::warn!("Failed to read chapter {}: {}", full_path, e);
                        continue;
                    }
                };

            let mut blocks = readalong_core::content::parse_chapter_html(
                &html,
                title.as_deref(),
                author.as_deref(),
            );
            for block in &mut blocks {
                // Make the block ID globally unique by prefixing with the chapter ID
                block.id = format!("{}_{}", item.id, block.id);
            }
            all_paragraphs.append(&mut blocks);
        }

        tracing::info!("Extracted {} paragraphs. Aligning...", all_paragraphs.len());

        let actual_model_path = if model_path.exists() {
            model_path
        } else if fallback_model.exists() {
            fallback_model
        } else {
            tracing::error!("Whisper model not found at either path");
            set_error("Whisper model not found");
            return;
        };

        let mut chunker = match AudioChunker::new(&wav_path) {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("Failed to initialize audio chunker: {}", e);
                set_error("Audio processing failed");
                return;
            }
        };

        let ctx_params = whisper_rs::WhisperContextParameters::default();
        let ctx = match whisper_rs::WhisperContext::new_with_params(
            actual_model_path.to_str().unwrap(),
            ctx_params,
        ) {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("Failed to load whisper model: {}", e);
                set_error("Whisper model load failed");
                return;
            }
        };

        let mut state = match ctx.create_state() {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Failed to create state: {}", e);
                set_error("Whisper state failed");
                return;
            }
        };

        let mut aligner = FuzzyAligner::new(all_paragraphs);
        let mut total_time_sec = 0.0;
        let mut has_error = false;
        let mut chunk_index = 0;

        loop {
            // Process 3 minutes of audio at a time
            chunk_index += 1;
            tracing::info!("Attempting to read chunk {}...", chunk_index);
            let chunk_res = match chunker.next_chunk(180) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("Failed to read chunk {}: {}", chunk_index, e);
                    set_error("Audio read failed");
                    has_error = true;
                    break;
                }
            };

            if let Some((audio_data, time_offset_sec)) = chunk_res {
                tracing::info!("Processing chunk {} at offset {:.1}s ({} samples)", chunk_index, time_offset_sec, audio_data.len());
                let asr_chunks =
                    match transcribe_audio_chunk(&audio_data, time_offset_sec, &mut state) {
                        Ok(c) => c,
                        Err(e) => {
                            tracing::error!("Transcription failed on chunk {}: {}", chunk_index, e);
                            set_error("Transcription failed");
                            has_error = true;
                            break;
                        }
                    };

                aligner.add_chunks(asr_chunks);
                aligner.align_current_buffer(false);

                let current_sync = aligner.get_sync_points();
                total_time_sec = time_offset_sec + (audio_data.len() as f32 / 16000.0);

                // Update DB with intermediate progress
                let status_msg =
                    format!("Processing (Aligned up to {:.1}m)", total_time_sec / 60.0);
                {
                    let db_lock = db.lock().unwrap();
                    if let Err(e) = db_lock.insert_book(
                        &book_id_clone,
                        "Unknown Title",
                        "Unknown Author",
                        epub_path.to_str().unwrap(),
                        audio_path.to_str().unwrap(),
                        &status_msg,
                    ) {
                        tracing::error!("Failed to update partial book status: {}", e);
                    }
                    if let Err(e) = db_lock.save_sync_map(&book_id_clone, &current_sync) {
                        tracing::error!("Failed to save partial sync map: {}", e);
                    }
                }
            } else {
                tracing::info!("Chunk {} returned no audio, EOF reached.", chunk_index);
                break; // End of audio
            }
        }

        if has_error {
            tracing::error!("Aborting finalization due to an error during chunking.");
            return; // Do not overwrite the error state with "Processed Book"
        }

        // Force alignment of any remaining buffered words now that we know there are no more chunks
        aligner.align_current_buffer(true);
        aligner.finish();
        let final_sync = aligner.get_sync_points();

        tracing::info!("Generated {} sync points", final_sync.len());

        let db_lock = db.lock().unwrap();
        if let Err(e) = db_lock.insert_book(
            &book_id_clone,
            "Unknown Title",
            "Unknown Author",
            epub_path.to_str().unwrap(),
            audio_path.to_str().unwrap(),
            "Processed Book",
        ) {
            tracing::error!("Failed to update book status {}: {}", book_id_clone, e);
        }

        if let Err(e) = db_lock.save_sync_map(&book_id_clone, &final_sync) {
            tracing::error!("Failed to save sync map for {}: {}", book_id_clone, e);
        }

        tracing::info!("Successfully processed book {}", book_id_clone);
    });

    (
        StatusCode::ACCEPTED,
        Json(ImportResponse {
            book_id,
            message: "Upload successful, processing started".to_string(),
        }),
    )
        .into_response()
}
