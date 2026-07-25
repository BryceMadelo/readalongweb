use crate::transcribe::{ASRTranscriptChunk, ASRTranscriptWord};
use readalong_core::content::ContentBlock;
use readalong_core::sync::SyncPoint;
use std::cmp::min;

pub struct FuzzyAligner {
    paragraphs: Vec<ContentBlock>,
    current_p_idx: usize,
    words: Vec<ASRTranscriptWord>,
    asr_idx: usize,
    last_timestamp_ms: u64,
    sync_points: Vec<SyncPoint>,
}

impl FuzzyAligner {
    pub fn new(paragraphs: Vec<ContentBlock>) -> Self {
        Self {
            paragraphs,
            current_p_idx: 0,
            words: Vec::new(),
            asr_idx: 0,
            last_timestamp_ms: 0,
            sync_points: Vec::new(),
        }
    }

    pub fn add_chunks(&mut self, asr_chunks: Vec<ASRTranscriptChunk>) {
        for chunk in asr_chunks {
            for word in chunk.words {
                self.words.push(word);
            }
        }
    }

    pub fn get_sync_points(&self) -> Vec<SyncPoint> {
        self.sync_points.clone()
    }

    pub fn align_current_buffer(&mut self, is_final: bool) {
        if self.words.is_empty() {
            return;
        }

        while self.current_p_idx < self.paragraphs.len() {
            let p = &self.paragraphs[self.current_p_idx];

            if p.tag == "img" || p.text.trim().is_empty() {
                self.current_p_idx += 1;
                continue;
            }

            let p_words: Vec<String> = p
                .text
                .trim()
                .split_whitespace()
                .map(|w| {
                    w.chars()
                        .filter(|c| c.is_alphanumeric())
                        .collect::<String>()
                        .to_lowercase()
                })
                .filter(|w| !w.is_empty())
                .collect();

            if p_words.is_empty() {
                self.current_p_idx += 1;
                continue;
            }

            let mut best_start_idx: i32 = -1;
            let mut best_end_idx: i32 = -1;
            let mut max_match_count = 0;

            let min_required = if p_words.len() <= 3 {
                p_words.len()
            } else if p_words.len() <= 7 {
                (p_words.len() as f32 * 0.6).ceil() as usize
            } else {
                ((p_words.len() as f32 * 0.4).ceil() as usize).max(4)
            };

            let search_window_size = 1000;
            // Stop early if we don't have enough words in the buffer for a full search window,
            // UNLESS this is the final chunk (in which case we must search what we have).
            if !is_final && self.asr_idx + 100 > self.words.len() {
                break;
            }

            let mut window_start = self.asr_idx;
            let mut window_end = min(window_start + search_window_size, self.words.len());

            while best_start_idx == -1 && window_start < self.words.len() {
                for i in window_start..window_end {
                    let mut match_count = 0;
                    let mut p_idx = 0;
                    let mut a_idx = i;

                    while p_idx < p_words.len()
                        && a_idx < self.words.len()
                        && (a_idx - i) < p_words.len() + 5
                    {
                        if p_words[p_idx]
                            == self.words[a_idx]
                                .word
                                .chars()
                                .filter(|c| c.is_alphanumeric())
                                .collect::<String>()
                                .to_lowercase()
                        {
                            match_count += 1;
                            p_idx += 1;
                            a_idx += 1;
                        } else {
                            // Allowed small skips/mishearings
                            let mut found = false;
                            for look_ahead in 1..=3 {
                                if p_idx + look_ahead < p_words.len()
                                    && p_words[p_idx + look_ahead]
                                        == self.words[a_idx]
                                            .word
                                            .chars()
                                            .filter(|c| c.is_alphanumeric())
                                            .collect::<String>()
                                            .to_lowercase()
                                {
                                    match_count += 1;
                                    p_idx += look_ahead + 1;
                                    a_idx += 1;
                                    found = true;
                                    break;
                                } else if a_idx + look_ahead < self.words.len()
                                    && p_words[p_idx]
                                        == self.words[a_idx + look_ahead]
                                            .word
                                            .chars()
                                            .filter(|c| c.is_alphanumeric())
                                            .collect::<String>()
                                            .to_lowercase()
                                {
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

                if max_match_count < min_required {
                    window_start = window_end;
                    window_end = min(window_start + search_window_size, self.words.len());
                    best_start_idx = -1;
                    max_match_count = 0;

                    if window_start - self.asr_idx > 5000 {
                        break;
                    }
                } else {
                    break;
                }
            }

            // If we didn't find a strong match, we need to decide whether to stop and wait for more words,
            // or just skip this paragraph.
            // If the buffer doesn't have many words left after our search window, we wait for more
            // UNLESS this is the final chunk.
            if !is_final && max_match_count < min_required && self.words.len() - self.asr_idx < 1000 {
                // Not a great match, and we are near the end of the current buffer. Let's wait for more chunks.
                break;
            }

            let mut confidence: Option<f32> = None;
            let timestamp_ms: u64;

            if best_start_idx != -1 && max_match_count > 0 {
                let mut match_ratio = max_match_count as f32 / p_words.len() as f32;

                let gap = best_start_idx as usize - self.asr_idx;
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
                let raw_ts = (self.words[best_start_idx as usize].start * 1000.0).floor() as u64;
                timestamp_ms = raw_ts.max(self.last_timestamp_ms);

                self.asr_idx = best_end_idx as usize;
            } else {
                confidence = Some(0.0);
                let raw_ts = if self.asr_idx > 0 && self.asr_idx < self.words.len() {
                    (self.words[self.asr_idx].start * 1000.0).floor() as u64
                } else {
                    0
                };
                timestamp_ms = raw_ts.max(self.last_timestamp_ms);
            }

            self.last_timestamp_ms = timestamp_ms;

            self.sync_points.push(SyncPoint {
                paragraph_id: p.id.clone(),
                timestamp_ms,
                confidence,
            });

            self.current_p_idx += 1;
        }

        // Truncate the used words to save memory
        if self.asr_idx > 2000 {
            let retain_from = self.asr_idx - 1000;
            self.words.drain(0..retain_from);
            self.asr_idx -= retain_from;
        }
    }

    pub fn finish(&mut self) {
        // Do NOT emit fake sync points for unmatched tail paragraphs.
        // Previously this stuffed every remaining paragraph with last_timestamp_ms,
        // causing all of them (e.g. "Bye bye!") to cluster at the same timestamp.
        // The SyncEngine binary search would then return the LAST of those duplicates
        // as the active paragraph for any time >= that timestamp, producing false
        // highlights far earlier than the audio actually reaches that content.
        //
        // Paragraphs that were never matched simply have no sync point. They won't
        // auto-highlight during playback, which is correct: we don't know when they play.
        // Text→Audio seeking for those paragraphs is a fair trade-off.
    }
}
