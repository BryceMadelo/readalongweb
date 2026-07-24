use readalong_core::content::ContentBlock;
use readalong_core::sync::SyncPoint;
use crate::transcribe::{ASRTranscriptChunk, ASRTranscriptWord};
use std::cmp::min;

pub fn fuzzy_align(paragraphs: &[ContentBlock], asr_chunks: &[ASRTranscriptChunk]) -> Vec<SyncPoint> {
    let mut sync_points = Vec::new();

    // Flatten chunks into words with timestamps
    let mut words: Vec<&ASRTranscriptWord> = Vec::new();
    for chunk in asr_chunks {
        for word in &chunk.words {
            words.push(word);
        }
    }

    // Quick fast forward if empty
    if words.is_empty() {
        return sync_points;
    }

    let mut asr_idx = 0;
    let mut last_timestamp_ms = 0;

    for p in paragraphs {
        if p.tag == "img" || p.text.trim().is_empty() {
            continue;
        }

        let p_words: Vec<String> = p.text
            .trim()
            .split_whitespace()
            .map(|w| w.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase())
            .filter(|w| !w.is_empty())
            .collect();

        if p_words.is_empty() {
            continue;
        }

        let mut best_start_idx: i32 = -1;
        let mut best_end_idx: i32 = -1;
        let mut max_match_count = 0;

        tracing::info!("Aligning paragraph: {:?}", p_words);
        tracing::info!("First 20 words in ASR from {}: {:?}", asr_idx, words.iter().skip(asr_idx).take(20).map(|w| &w.word).collect::<Vec<_>>());

        let search_window_size = 500;
        let mut window_start = asr_idx;
        let mut window_end = min(window_start + search_window_size, words.len());

        while best_start_idx == -1 && window_start < words.len() {
            for i in window_start..window_end {
                let mut match_count = 0;
                let mut p_idx = 0;
                let mut a_idx = i;

                while p_idx < p_words.len() && a_idx < words.len() && (a_idx - i) < p_words.len() + 5 {
                    if p_words[p_idx] == words[a_idx].word.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase() {
                        match_count += 1;
                        p_idx += 1;
                        a_idx += 1;
                    } else {
                        // Allowed small skips/mishearings
                        let mut found = false;
                        for look_ahead in 1..=3 {
                            if p_idx + look_ahead < p_words.len() && p_words[p_idx + look_ahead] == words[a_idx].word.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase() {
                                match_count += 1;
                                p_idx += look_ahead + 1;
                                a_idx += 1;
                                found = true;
                                break;
                            } else if a_idx + look_ahead < words.len() && p_words[p_idx] == words[a_idx + look_ahead].word.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase() {
                                match_count += 1;
                                p_idx += 1;
                                a_idx += look_ahead + 1;
                                found = true;
                                break;
                            }
                        }
                        if !found {
                            p_idx += 1;
                            a_idx += 1;
                        }
                    }
                }

                if match_count > max_match_count {
                    max_match_count = match_count;
                    best_start_idx = i as i32;
                    best_end_idx = a_idx as i32;
                }

                // Early exit if perfect match found
                if max_match_count == p_words.len() {
                    break;
                }
            }

            if max_match_count < min(3, p_words.len()) {
                window_start = window_end;
                window_end = min(window_start + search_window_size, words.len());
                best_start_idx = -1;
                max_match_count = 0;

                if window_start - asr_idx > 5000 {
                    break;
                }
            } else {
                break;
            }
        }

        let mut confidence: Option<f32> = None;
        let timestamp_ms: u64;

        if best_start_idx != -1 && max_match_count > 0 {
            let mut match_ratio = max_match_count as f32 / p_words.len() as f32;

            let gap = best_start_idx as usize - asr_idx;
            if gap > 50 {
                match_ratio *= 0.8;
            }

            let mut conf = match_ratio;

            if conf < 0.6 || (p_words.len() < 3 && conf < 1.0) {
                conf = conf.min(0.4);
            }

            if p.needs_review {
                conf = conf.min(0.3);
            }

            confidence = Some(conf);
            let raw_ts = (words[best_start_idx as usize].start * 1000.0).floor() as u64;
            timestamp_ms = raw_ts.max(last_timestamp_ms);

            asr_idx = best_end_idx as usize;
        } else {
            confidence = Some(0.0);
            let raw_ts = if asr_idx > 0 && asr_idx < words.len() {
                (words[asr_idx].start * 1000.0).floor() as u64
            } else {
                0
            };
            timestamp_ms = raw_ts.max(last_timestamp_ms);
        }

        last_timestamp_ms = timestamp_ms;

        sync_points.push(SyncPoint {
            paragraph_id: p.id.clone(),
            timestamp_ms,
            confidence,
        });
    }

    sync_points
}
