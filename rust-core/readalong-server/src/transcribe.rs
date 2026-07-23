use std::path::{Path, PathBuf};
use std::process::Command;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct ASRTranscriptWord {
    pub word: String,
    pub start: f32,
    pub end: f32,
}

pub struct ASRTranscriptChunk {
    pub text: String,
    pub timestamp: (f32, f32),
    pub words: Vec<ASRTranscriptWord>,
}

pub fn extract_audio_to_wav(input_path: &Path, output_path: &Path) -> Result<(), String> {
    tracing::info!("Extracting audio from {:?} to {:?}", input_path, output_path);

    // Using standard ffmpeg binary
    // -ar 16000: 16kHz
    // -ac 1: Mono
    // -c:a pcm_s16le: 16-bit PCM
    let output = Command::new("ffmpeg")
        .arg("-y") // Overwrite output files
        .arg("-i")
        .arg(input_path)
        .arg("-ar")
        .arg("16000")
        .arg("-ac")
        .arg("1")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(output_path)
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    Ok(())
}

pub fn transcribe_audio(wav_path: &Path, model_path: &Path) -> Result<Vec<ASRTranscriptChunk>, String> {
    tracing::info!("Transcribing {:?}", wav_path);

    // Read WAV file
    let mut reader = hound::WavReader::open(wav_path).map_err(|e| e.to_string())?;

    // Whisper-rs requires 32-bit float audio data
    let audio_data: Vec<f32> = if reader.spec().sample_format == hound::SampleFormat::Int {
        reader
            .samples::<i16>()
            .map(|s| s.unwrap_or(0) as f32 / 32768.0)
            .collect()
    } else {
        reader
            .samples::<f32>()
            .map(|s| s.unwrap_or(0.0))
            .collect()
    };

    tracing::info!("Audio data loaded: {} samples", audio_data.len());

    let ctx_params = WhisperContextParameters::default();
    let ctx = WhisperContext::new_with_params(model_path.to_str().unwrap(), ctx_params)
        .map_err(|e| format!("Failed to load whisper model: {}", e))?;

    let mut state = ctx.create_state().map_err(|e| format!("Failed to create state: {}", e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    // Request word-level timestamps
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(true);

    // Enable token timestamps for word-level precision
    params.set_token_timestamps(true);

    tracing::info!("Running whisper inference...");
    state.full(params, &audio_data[..]).map_err(|e| format!("Failed to run whisper: {}", e))?;

    let num_segments = state.full_n_segments().map_err(|e| format!("Failed to get segments: {}", e))?;
    tracing::info!("Transcription complete: {} segments", num_segments);

    let mut chunks = Vec::new();

    for i in 0..num_segments {
        let text = state.full_get_segment_text(i).map_err(|e| e.to_string())?;
        let t0 = state.full_get_segment_t0(i).map_err(|e| e.to_string())?;
        let t1 = state.full_get_segment_t1(i).map_err(|e| e.to_string())?;

        // Whisper time is in 10ms units (centiseconds)
        let start_sec = t0 as f32 / 100.0;
        let end_sec = t1 as f32 / 100.0;

        let num_tokens = state.full_n_tokens(i).unwrap_or(0);
        let mut words = Vec::new();

        let mut current_word = String::new();
        let mut current_word_start = -1.0;

        for j in 0..num_tokens {
            if let Ok(token_data) = state.full_get_token_data(i, j) {
                if let Ok(token_text) = state.full_get_token_text(i, j) {
                    let token_t0 = token_data.t0 as f32 / 100.0;
                    let token_t1 = token_data.t1 as f32 / 100.0;

                    if current_word_start < 0.0 {
                        current_word_start = token_t0;
                    }

                    current_word.push_str(&token_text);

                    // Basic heuristic: if the token ends with space, or we're at the end of segment, flush word
                    if token_text.ends_with(' ') || j == num_tokens - 1 {
                        let word_text = current_word.trim().to_string();
                        if !word_text.is_empty() {
                            words.push(ASRTranscriptWord {
                                word: word_text,
                                start: current_word_start,
                                end: token_t1,
                            });
                        }
                        current_word.clear();
                        current_word_start = -1.0;
                    }
                }
            }
        }

        chunks.push(ASRTranscriptChunk {
            text,
            timestamp: (start_sec, end_sec),
            words,
        });
    }

    Ok(chunks)
}
