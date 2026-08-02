use axum::{
    Json,
    extract::{Extension, Multipart, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::AppState;
use crate::align::FuzzyAligner;
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
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    let status = match db_lock.get_book_status(&book_id) {
        Ok(s) => s,
        Err(_) => return (StatusCode::NOT_FOUND, "Book not found").into_response(),
    };

    // Always return sync map if it exists, so client can get partial progress
    let sync_map = db_lock.get_sync_map(&user_id.0, &book_id).ok();

    (StatusCode::OK, Json(StatusResponse { status, sync_map })).into_response()
}

pub async fn handle_update_sync_map(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
    Json(sync_points): Json<Vec<readalong_core::sync::SyncPoint>>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    if let Err(e) = db_lock.save_sync_map(&user_id.0, &book_id, &sync_points) {
        tracing::error!("Failed to save sync map for {}: {}", book_id, e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
            .into_response();
    }

    (StatusCode::OK, "Sync map updated successfully").into_response()
}

pub async fn handle_get_sync_map(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();

    match db_lock.get_sync_map(&user_id.0, &book_id) {
        Ok(points) => (StatusCode::OK, Json(points)).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "Sync map not found").into_response(),
    }
}

pub async fn handle_pause(
    Extension(_user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
) -> impl IntoResponse {
    // If it was in the queue waiting, remove it
    app_state.queue.remove_job(&book_id);

    let db_lock = app_state.db.lock().unwrap();
    if let Err(e) = db_lock.update_book_status(&book_id, "Paused") {
        tracing::error!("Failed to pause book {}: {}", book_id, e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
    }
    (StatusCode::OK, "Paused").into_response()
}

pub async fn handle_resume(
    Extension(_user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    // Assuming when we resume, the status goes back to Processing.
    // The exact progress will be overwritten by the loop shortly.
    if let Err(e) = db_lock.update_book_status(&book_id, "Processing...") {
        tracing::error!("Failed to resume book {}: {}", book_id, e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
    }
    (StatusCode::OK, "Resumed").into_response()
}

#[derive(serde::Deserialize)]
pub struct EditBookRequest {
    pub title: String,
    pub author: String,
}

pub async fn handle_edit(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
    Json(payload): Json<EditBookRequest>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    if let Err(e) = db_lock.update_book_meta(&user_id.0, &book_id, &payload.title, &payload.author)
    {
        tracing::error!("Failed to edit book {}: {}", book_id, e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
    }
    (StatusCode::OK, "Updated").into_response()
}

pub async fn handle_delete_book(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();

    // Attempt to clean up files
    if let Ok((epub, audio)) = db_lock.get_book_paths(&user_id.0, &book_id) {
        let _ = std::fs::remove_file(&epub);
        let _ = std::fs::remove_file(&audio);
    }

    if let Err(e) = db_lock.delete_book(&user_id.0, &book_id) {
        tracing::error!("Failed to delete book {}: {}", book_id, e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
    }

    // Attempt to remove directory
    let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| ".".to_string());
    let dir_path = std::path::Path::new(&data_dir)
        .join("tmp_uploads")
        .join(&book_id);
    let _ = std::fs::remove_dir_all(&dir_path);

    (StatusCode::OK, "Deleted").into_response()
}

#[derive(serde::Deserialize)]
pub struct FavoriteBookRequest {
    pub is_favorite: bool,
}

pub async fn handle_favorite(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
    Json(payload): Json<FavoriteBookRequest>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    if let Err(e) = db_lock.set_favorite(&user_id.0, &book_id, payload.is_favorite) {
        tracing::error!("Failed to favorite book {}: {}", book_id, e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
    }
    (StatusCode::OK, "Updated").into_response()
}

pub async fn handle_upload_cover(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
    mut multipart: axum::extract::Multipart,
) -> impl IntoResponse {
    let mut cover_path: Option<String> = None;
    let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| ".".to_string());

    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();
        if name == "cover" {
            let bytes = field.bytes().await.unwrap_or_default();
            if bytes.len() > 0 {
                let dir_path = std::path::Path::new(&data_dir)
                    .join("tmp_uploads")
                    .join(&book_id);
                std::fs::create_dir_all(&dir_path).ok();
                let path = dir_path.join("cover.jpg");
                if let Ok(_) = std::fs::write(&path, &bytes) {
                    cover_path = Some(path.to_str().unwrap().to_string());
                }
            }
        }
    }

    if let Some(path) = cover_path {
        let db_lock = app_state.db.lock().unwrap();
        if let Err(e) = db_lock.set_cover_image(&user_id.0, &book_id, &path) {
            tracing::error!("Failed to save cover image for book {}: {}", book_id, e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
        }
        (StatusCode::OK, "Cover uploaded").into_response()
    } else {
        (StatusCode::BAD_REQUEST, "No cover image provided").into_response()
    }
}

pub async fn handle_get_cover(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
    req: axum::extract::Request,
) -> impl IntoResponse {
    let cover_path = {
        let db_lock = app_state.db.lock().unwrap();
        db_lock
            .get_cover_image(&user_id.0, &book_id)
            .unwrap_or(None)
    };

    if let Some(path) = cover_path {
        match tower::ServiceExt::oneshot(tower_http::services::ServeFile::new(&path), req).await {
            Ok(res) => res.into_response(),
            Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Error serving file").into_response(),
        }
    } else {
        (StatusCode::NOT_FOUND, "Cover not found").into_response()
    }
}

pub async fn handle_get_content(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
) -> impl IntoResponse {
    let epub_path_str = {
        let db_lock = app_state.db.lock().unwrap();
        match db_lock.get_book_paths(&user_id.0, &book_id) {
            Ok((epub, _)) => epub,
            Err(_) => return (StatusCode::NOT_FOUND, "Book not found").into_response(),
        }
    };

    let epub_bytes = match std::fs::read(&epub_path_str) {
        Ok(b) => b,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read EPUB").into_response();
        }
    };

    let mut archive = match zip::ZipArchive::new(std::io::Cursor::new(epub_bytes.as_slice())) {
        Ok(a) => a,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to parse EPUB zip",
            )
                .into_response();
        }
    };

    let opf_path = match readalong_core::epub::find_opf_path(&mut archive) {
        Ok(p) => p,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Invalid EPUB format").into_response();
        }
    };

    let opf_xml = match readalong_core::epub::read_zip_entry_as_string(&mut archive, &opf_path) {
        Ok(s) => s,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Invalid EPUB format").into_response();
        }
    };

    let spine = match readalong_core::epub::parse_opf_spine(&opf_xml) {
        Ok(s) => s,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Invalid EPUB format").into_response();
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
        let chapter_dir = if let Some(idx) = full_path.rfind('/') {
            &full_path[..idx]
        } else {
            ""
        };

        let html = match readalong_core::epub::read_zip_entry_as_string(&mut archive, &full_path) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let mut blocks =
            readalong_core::content::parse_chapter_html(&html, title.as_deref(), author.as_deref());
        for block in &mut blocks {
            block.id = format!("{}_{}", item.id, block.id);

            // Format image src to point to our new resource endpoint so mobile can download it natively
            if block.tag == "img" {
                if let Some(src) = &block.src {
                    let img_path = readalong_core::epub::resolve_opf_relative(chapter_dir, src);
                    // Update the src to point to the endpoint we are about to create below
                    block.src = Some(format!("/api/books/{}/resource/{}", book_id, img_path));
                }
            }
        }
        all_paragraphs.append(&mut blocks);
    }

    (StatusCode::OK, Json(all_paragraphs)).into_response()
}

pub async fn handle_get_resource(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    // This extracts the book_id and the dynamic wildcard path to the image inside the EPUB
    AxumPath((book_id, asset_path)): AxumPath<(String, String)>,
) -> impl IntoResponse {
    let epub_path_str = {
        let db_lock = app_state.db.lock().unwrap();
        match db_lock.get_book_paths(&user_id.0, &book_id) {
            Ok((epub, _)) => epub,
            Err(_) => return (StatusCode::NOT_FOUND, "Book not found").into_response(),
        }
    };

    let epub_bytes = match std::fs::read(&epub_path_str) {
        Ok(b) => b,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read EPUB").into_response();
        }
    };

    let mut archive = match zip::ZipArchive::new(std::io::Cursor::new(epub_bytes.as_slice())) {
        Ok(a) => a,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to parse EPUB zip",
            )
                .into_response();
        }
    };

    // Use the zip index finder from readalong_core to safely handle spaces/case issues
    let idx = match readalong_core::epub::find_zip_index(&mut archive, &asset_path) {
        Some(i) => i,
        None => return (StatusCode::NOT_FOUND, "Resource not found in EPUB").into_response(),
    };

    let mut file = match archive.by_index(idx) {
        Ok(f) => f,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read resource").into_response();
        }
    };

    let mut buffer = Vec::new();
    use std::io::Read;
    if file.read_to_end(&mut buffer).is_err() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read resource bytes",
        )
            .into_response();
    }

    // Assign standard image mime types based on extension
    let content_type = if asset_path.to_lowercase().ends_with(".png") {
        "image/png"
    } else if asset_path.to_lowercase().ends_with(".gif") {
        "image/gif"
    } else if asset_path.to_lowercase().ends_with(".svg") {
        "image/svg+xml"
    } else {
        "image/jpeg"
    };

    ([(axum::http::header::CONTENT_TYPE, content_type)], buffer).into_response()
}

pub async fn handle_import(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
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
    let mut title = String::from("Unknown Title");
    let mut author = String::from("Unknown Author");

    while let Ok(Some(mut field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();

        if name == "title" {
            if let Ok(text) = field.text().await {
                title = text;
            }
            continue;
        } else if name == "author" {
            if let Ok(text) = field.text().await {
                author = text;
            }
            continue;
        }

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

    // Audio is optional — if not provided, save the book as "Ready" and skip alignment
    if audio_path.is_none() {
        let book_id_clone = book_id.clone();
        let user_id_clone = user_id.0.clone();
        tokio::task::spawn_blocking(move || {
            let db_lock = app_state.db.lock().unwrap();
            if let Err(e) = db_lock.insert_book(
                &book_id_clone,
                &user_id_clone,
                &title,
                &author,
                epub_path.to_str().unwrap(),
                "",
                "Ready",
            ) {
                tracing::error!("Failed to insert epub-only book {}: {}", book_id_clone, e);
            }
        });
        return (
            StatusCode::ACCEPTED,
            Json(ImportResponse {
                book_id,
                message: "Upload successful, no audio provided".to_string(),
            }),
        )
            .into_response();
    }

    let audio_path = audio_path.unwrap();
    let book_id_clone = book_id.clone();

    {
        let db_lock = app_state.db.lock().unwrap();
        if let Err(e) = db_lock.insert_book(
            &book_id_clone,
            &user_id.0,
            &title,
            &author,
            epub_path.to_str().unwrap(),
            audio_path.to_str().unwrap(),
            "Queued",
        ) {
            tracing::error!("Failed to insert book {}: {}", book_id_clone, e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
        }
    }
    let user_id_clone = user_id.0.clone();
    app_state.queue.add_job(book_id_clone.clone());

    // Fire and forget the processing task using spawn_blocking to prevent async starvation
    tokio::task::spawn_blocking(move || {
        tracing::info!("Starting processing task for book {}", book_id_clone);

        // Wait for the queue to allow us to proceed (i.e. status is no longer 'Queued...')
        loop {
            let mut is_queued = false;
            if let Ok(db_lock) = app_state.db.lock() {
                if let Ok(status) = db_lock.get_book_status(&book_id_clone) {
                    if status.starts_with("Queued") {
                        is_queued = true;
                    }
                } else {
                    return; // deleted?
                }
            }
            if is_queued {
                std::thread::sleep(std::time::Duration::from_secs(2));
            } else {
                break;
            }
        }

        // Update database status: Processing (in a real app, we'd have a status column)
        {
            let db_lock = app_state.db.lock().unwrap();
            if let Err(e) = db_lock.update_book_status(&book_id_clone, "Processing...") {
                tracing::error!(
                    "Failed to update book status to Processing... {}: {}",
                    book_id_clone,
                    e
                );
            }
        }

        // Helper to mark failure
        let set_error = |err_msg: &str| {
            let db_lock = app_state.db.lock().unwrap();
            if let Err(e) = db_lock.insert_book(
                &book_id_clone,
                &user_id_clone,
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

        // Acquire the global alignment lock before doing ANY Whisper inference or state creation
        // This prevents CUDA OOM or memory pool corruption if multiple alignments happen.
        let _alignment_guard = app_state.alignment_lock.lock().unwrap();

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
        let mut has_error = false;
        let mut chunk_index = 0;

        let total_audio_duration_sec = chunker.total_duration_sec();

        loop {
            // Check for pause status
            {
                let mut is_paused = false;
                if let Ok(db_lock) = app_state.db.lock() {
                    if let Ok(status) = db_lock.get_book_status(&book_id_clone) {
                        if status == "Paused" {
                            is_paused = true;
                        }
                    }
                }
                if is_paused {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    continue;
                }
            }

            // Process 60 seconds of audio at a time to prevent OOM on low-memory machines
            chunk_index += 1;
            tracing::info!("Attempting to read chunk {}...", chunk_index);
            let chunk_res = match chunker.next_chunk(60) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("Failed to read chunk {}: {}", chunk_index, e);
                    set_error("Audio read failed");
                    has_error = true;
                    break;
                }
            };

            if let Some((audio_data, time_offset_sec)) = chunk_res {
                tracing::info!(
                    "Processing chunk {} at offset {:.1}s ({} samples)",
                    chunk_index,
                    time_offset_sec,
                    audio_data.len()
                );
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
                let total_time_sec = time_offset_sec + (audio_data.len() as f32 / 16000.0);

                // Update DB with intermediate progress
                let current_min = total_time_sec / 60.0;
                let total_min = total_audio_duration_sec / 60.0;
                let status_msg = format!("Processing|{}|{}", current_min, total_min);

                {
                    let db_lock = app_state.db.lock().unwrap();
                    if let Err(e) = db_lock.update_book_status(&book_id_clone, &status_msg) {
                        tracing::error!("Failed to update partial book status: {}", e);
                    }
                    if let Err(e) =
                        db_lock.save_sync_map(&user_id_clone, &book_id_clone, &current_sync)
                    {
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

        let db_lock = app_state.db.lock().unwrap();
        if let Err(e) = db_lock.insert_book(
            &book_id_clone,
            &user_id_clone,
            "Unknown Title",
            "Unknown Author",
            epub_path.to_str().unwrap(),
            audio_path.to_str().unwrap(),
            "Processed Book",
        ) {
            tracing::error!("Failed to update book status {}: {}", book_id_clone, e);
        }

        if let Err(e) = db_lock.save_sync_map(&user_id_clone, &book_id_clone, &final_sync) {
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

/// POST /add_audio/:book_id — attach (or replace) an audio track and re-run alignment
pub async fn handle_add_audio(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let data_dir_str = std::env::var("DATA_DIR").unwrap_or_else(|_| ".".to_string());
    let tmp_dir = PathBuf::from(&data_dir_str)
        .join("tmp_uploads")
        .join(&book_id);

    if let Err(e) = tokio::fs::create_dir_all(&tmp_dir).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create directory: {}", e),
        )
            .into_response();
    }

    // Receive the audio file
    let mut audio_path: Option<PathBuf> = None;
    while let Ok(Some(mut field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        let file_name = field.file_name().unwrap_or("unknown").to_string();
        let is_audio = name == "audio"
            || file_name.ends_with(".mp3")
            || file_name.ends_with(".m4b")
            || file_name.ends_with(".m4a");

        if !is_audio {
            continue;
        }

        let path = tmp_dir.join("upload.audio");
        let mut file = match tokio::fs::File::create(&path).await {
            Ok(f) => f,
            Err(e) => {
                tracing::error!("Failed to create audio file: {}", e);
                continue;
            }
        };

        use tokio::io::AsyncWriteExt;
        let mut success = true;
        while let Ok(Some(chunk)) = field.chunk().await {
            if let Err(e) = file.write_all(&chunk).await {
                tracing::error!("Failed to write chunk: {}", e);
                success = false;
                break;
            }
        }
        if success {
            audio_path = Some(path);
        }
    }

    let audio_path = match audio_path {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, "Missing audio file").into_response(),
    };

    // Retrieve the existing epub path from the DB
    let epub_path_str = {
        let db_lock = app_state.db.lock().unwrap();
        match db_lock.get_book_paths(&user_id.0, &book_id) {
            Ok((epub, _)) => epub,
            Err(_) => return (StatusCode::NOT_FOUND, "Book not found").into_response(),
        }
    };
    let epub_path = PathBuf::from(&epub_path_str);
    if !epub_path.exists() {
        return (StatusCode::NOT_FOUND, "EPUB file not found on server").into_response();
    }

    let book_id_clone = book_id.clone();
    let user_id_clone = user_id.0.clone();
    let tmp_dir_clone = tmp_dir.clone();

    app_state.queue.add_job(book_id_clone.clone());

    // Kick off alignment (same pipeline as handle_import)
    tokio::task::spawn_blocking(move || {
        tracing::info!(
            "Starting processing task for re-align book {}",
            book_id_clone
        );

        loop {
            let mut is_queued = false;
            if let Ok(db_lock) = app_state.db.lock() {
                if let Ok(status) = db_lock.get_book_status(&book_id_clone) {
                    if status.starts_with("Queued") {
                        is_queued = true;
                    }
                } else {
                    return; // deleted?
                }
            }
            if is_queued {
                std::thread::sleep(std::time::Duration::from_secs(2));
            } else {
                break;
            }
        }

        {
            let db_lock = app_state.db.lock().unwrap();
            if let Err(e) = db_lock.insert_book(
                &book_id_clone,
                &user_id_clone,
                "Unknown Title",
                "Unknown Author",
                epub_path.to_str().unwrap(),
                audio_path.to_str().unwrap(),
                "Processing...",
            ) {
                tracing::error!(
                    "Failed to update book state for re-align {}: {}",
                    book_id_clone,
                    e
                );
            }
        }

        let set_error = |err_msg: &str| {
            let db_lock = app_state.db.lock().unwrap();
            let _ = db_lock.update_book_status(&book_id_clone, &format!("Error: {}", err_msg));
        };

        let wav_path = tmp_dir_clone.join("extracted.wav");
        if let Err(e) = extract_audio_to_wav(&audio_path, &wav_path) {
            tracing::error!("Audio extraction failed for {}: {}", book_id_clone, e);
            set_error("Audio extraction failed");
            return;
        }

        let model_path = Path::new("/models/ggml-small.en.bin");
        let fallback_model = Path::new("ggml-small.en.bin");

        let epub_bytes = match std::fs::read(&epub_path) {
            Ok(b) => b,
            Err(e) => {
                tracing::error!("Failed to read epub: {}", e);
                set_error("Failed to read EPUB");
                return;
            }
        };

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
                tracing::error!("Failed to find opf: {}", e);
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
                tracing::error!("Failed to parse spine: {}", e);
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
                    Err(_) => continue,
                };
            let mut blocks = readalong_core::content::parse_chapter_html(
                &html,
                title.as_deref(),
                author.as_deref(),
            );
            for block in &mut blocks {
                block.id = format!("{}_{}", item.id, block.id);
            }
            all_paragraphs.append(&mut blocks);
        }

        let actual_model_path = if model_path.exists() {
            model_path
        } else if fallback_model.exists() {
            fallback_model
        } else {
            set_error("Whisper model not found");
            return;
        };

        let mut chunker = match AudioChunker::new(&wav_path) {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("Audio chunker failed: {}", e);
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
                tracing::error!("Whisper load failed: {}", e);
                set_error("Whisper model load failed");
                return;
            }
        };

        let mut state = match ctx.create_state() {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Whisper state failed: {}", e);
                set_error("Whisper state failed");
                return;
            }
        };

        let mut aligner = FuzzyAligner::new(all_paragraphs);
        let mut has_error = false;
        let mut chunk_index = 0;
        let total_audio_duration_sec = chunker.total_duration_sec();

        loop {
            {
                let mut is_paused = false;
                if let Ok(db_lock) = app_state.db.lock() {
                    if let Ok(status) = db_lock.get_book_status(&book_id_clone) {
                        if status == "Paused" {
                            is_paused = true;
                        }
                    }
                }
                if is_paused {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    continue;
                }
            }

            chunk_index += 1;
            let chunk_res = match chunker.next_chunk(180) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("Chunk read failed: {}", e);
                    set_error("Audio read failed");
                    has_error = true;
                    break;
                }
            };

            if let Some((audio_data, time_offset_sec)) = chunk_res {
                let asr_chunks =
                    match transcribe_audio_chunk(&audio_data, time_offset_sec, &mut state) {
                        Ok(c) => c,
                        Err(e) => {
                            tracing::error!("Transcription failed chunk {}: {}", chunk_index, e);
                            set_error("Transcription failed");
                            has_error = true;
                            break;
                        }
                    };
                aligner.add_chunks(asr_chunks);
                aligner.align_current_buffer(false);

                let current_sync = aligner.get_sync_points();
                let total_time_sec = time_offset_sec + (audio_data.len() as f32 / 16000.0);
                let current_min = total_time_sec / 60.0;
                let total_min = total_audio_duration_sec / 60.0;
                let status_msg = format!("Processing|{}|{}", current_min, total_min);

                {
                    let db_lock = app_state.db.lock().unwrap();
                    let _ = db_lock.update_book_status(&book_id_clone, &status_msg);
                    let _ = db_lock.save_sync_map(&user_id_clone, &book_id_clone, &current_sync);
                }
            } else {
                break;
            }
        }

        if has_error {
            return;
        }

        aligner.align_current_buffer(true);
        aligner.finish();
        let final_sync = aligner.get_sync_points();

        let db_lock = app_state.db.lock().unwrap();
        let _ = db_lock.insert_book(
            &book_id_clone,
            &user_id_clone,
            "Unknown Title",
            "Unknown Author",
            epub_path.to_str().unwrap(),
            audio_path.to_str().unwrap(),
            "Processed Book",
        );
        let _ = db_lock.save_sync_map(&user_id_clone, &book_id_clone, &final_sync);
        tracing::info!("Re-alignment complete for book {}", book_id_clone);
    });

    (
        StatusCode::ACCEPTED,
        Json(ImportResponse {
            book_id,
            message: "Audio received, re-alignment started".to_string(),
        }),
    )
        .into_response()
}
