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
    tracing::info!(
        "Extracting audio from {:?} to {:?}",
        input_path,
        output_path
    );

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

pub struct AudioChunker {
    reader: hound::WavReader<std::io::BufReader<std::fs::File>>,
    sample_rate: u32,
    samples_read: u64,
    is_int_format: bool,
}

impl AudioChunker {
    pub fn new(wav_path: &Path) -> Result<Self, String> {
        let reader = hound::WavReader::open(wav_path).map_err(|e| e.to_string())?;
        let sample_rate = reader.spec().sample_rate;
        let is_int_format = reader.spec().sample_format == hound::SampleFormat::Int;

        Ok(Self {
            reader,
            sample_rate,
            samples_read: 0,
            is_int_format,
        })
    }

    pub fn total_duration_sec(&self) -> f32 {
        self.reader.len() as f32 / self.sample_rate as f32
    }

    pub fn next_chunk(&mut self, duration_sec: u32) -> Result<Option<(Vec<f32>, f32)>, String> {
        let max_samples = (self.sample_rate * duration_sec) as usize;
        let mut audio_data = Vec::with_capacity(max_samples);

        if self.is_int_format {
            let mut iter = self.reader.samples::<i16>();
            while audio_data.len() < max_samples {
                match iter.next() {
                    Some(Ok(s)) => audio_data.push(s as f32 / 32768.0),
                    Some(Err(e)) => return Err(e.to_string()),
                    None => break,
                }
            }
        } else {
            let mut iter = self.reader.samples::<f32>();
            while audio_data.len() < max_samples {
                match iter.next() {
                    Some(Ok(s)) => audio_data.push(s),
                    Some(Err(e)) => return Err(e.to_string()),
                    None => break,
                }
            }
        }

        if audio_data.is_empty() {
            return Ok(None);
        }

        let time_offset_sec = self.samples_read as f32 / self.sample_rate as f32;
        self.samples_read += audio_data.len() as u64;

        Ok(Some((audio_data, time_offset_sec)))
    }
}

pub fn transcribe_audio_chunk(
    audio_data: &[f32],
    time_offset_sec: f32,
    state: &mut whisper_rs::WhisperState,
) -> Result<Vec<ASRTranscriptChunk>, String> {
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    // Request word-level timestamps
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    // Enable token timestamps for word-level precision
    params.set_token_timestamps(true);

    // Whisper doesn't have offset_ms in params. Wait, we should just let whisper process
    // from 0 and then offset the timestamps manually.
    // Let me check if whisper_rs FullParams has offset. It does not have offset_ms usually, or it's just t0.
    // Actually, offset_ms is used to *start* decoding at a certain point. We are chunking externally!
    // So we just add time_offset_sec to start_sec and end_sec ourselves.

    tracing::info!("Running whisper inference on chunk...");
    state
        .full(params, audio_data)
        .map_err(|e| format!("Failed to run whisper: {}", e))?;

    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("Failed to get segments: {}", e))?;
    tracing::info!("Transcription chunk complete: {} segments", num_segments);

    let mut chunks = Vec::new();

    for i in 0..num_segments {
        let text = state.full_get_segment_text(i).map_err(|e| e.to_string())?;
        let t0 = state.full_get_segment_t0(i).map_err(|e| e.to_string())?;
        let t1 = state.full_get_segment_t1(i).map_err(|e| e.to_string())?;

        // Whisper time is in 10ms units (centiseconds), offset by time_offset_sec
        let start_sec = time_offset_sec + (t0 as f32 / 100.0);
        let end_sec = time_offset_sec + (t1 as f32 / 100.0);

        let num_tokens = state.full_n_tokens(i).unwrap_or(0);
        let mut words = Vec::new();

        let mut current_word = String::new();
        let mut current_word_start = -1.0;

        for j in 0..num_tokens {
            if let Ok(token_data) = state.full_get_token_data(i, j) {
                if let Ok(token_text) = state.full_get_token_text(i, j) {
                    let token_t0 = time_offset_sec + (token_data.t0 as f32 / 100.0);
                    let token_t1 = time_offset_sec + (token_data.t1 as f32 / 100.0);

                    // Strip whisper special tags (e.g., [_TT_1416], [_BEG_])
                    // which happen when token timestamps are enabled.
                    let mut cleaned_token = String::new();
                    let mut in_bracket = false;
                    for c in token_text.chars() {
                        if c == '[' {
                            in_bracket = true;
                        } else if c == ']' {
                            in_bracket = false;
                        } else if !in_bracket {
                            cleaned_token.push(c);
                        }
                    }

                    if token_text.starts_with(' ') && !current_word.is_empty() {
                        let word_text = current_word.trim().to_string();
                        if !word_text.is_empty() {
                            words.push(ASRTranscriptWord {
                                word: word_text,
                                start: current_word_start,
                                end: token_t0, // approximate end as start of next token
                            });
                        }
                        current_word.clear();
                        current_word_start = -1.0;
                    }

                    if current_word_start < 0.0 {
                        current_word_start = token_t0;
                    }

                    current_word.push_str(&cleaned_token);

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
