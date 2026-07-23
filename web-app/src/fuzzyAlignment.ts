export interface ASRTranscriptWord {
    word: string;
    start: number; // in seconds
    end: number;   // in seconds
}

export interface ASRTranscriptChunk {
    text: string;
    timestamp: [number, number]; // [start, end]
}

export interface ContentBlock {
    id: string;
    tag: string;
    text: string;
    src?: string;
    needs_review: boolean;
}

export interface SyncPoint {
    paragraph_id: string;
    timestamp_ms: number;
    confidence: number | null;
}

/**
 * Fuzzy alignment between extracted EPUB paragraphs and ASR transcript words.
 */
export function fuzzyAlign(
    paragraphs: ContentBlock[],
    asrChunks: ASRTranscriptChunk[]
): SyncPoint[] {
    const syncPoints: SyncPoint[] = [];

    // We flatten the chunks into words with timestamps for finer granularity
    const words: ASRTranscriptWord[] = [];
    for (const chunk of asrChunks) {
        if (!chunk.timestamp || chunk.timestamp.length < 2) continue;

        const chunkWords = chunk.text.trim().split(/\s+/);
        if (chunkWords.length === 0) continue;

        const chunkDuration = chunk.timestamp[1] - chunk.timestamp[0];
        const wordDuration = chunkDuration / chunkWords.length;

        for (let i = 0; i < chunkWords.length; i++) {
            words.push({
                word: chunkWords[i].replace(/[^\w]/g, '').toLowerCase(),
                start: chunk.timestamp[0] + i * wordDuration,
                end: chunk.timestamp[0] + (i + 1) * wordDuration,
            });
        }
    }

    // Quick fast forward if empty
    if (words.length === 0) return syncPoints;

    let asrIdx = 0;

    for (const p of paragraphs) {
        if (p.tag === 'img' || p.text.trim() === '') {
            continue;
        }

        const pWords = p.text.trim().split(/\s+/).map(w => w.replace(/[^\w]/g, '').toLowerCase()).filter(w => w.length > 0);
        if (pWords.length === 0) continue;

        // If it's a known junk/review block, it might not be narrated
        if (p.needs_review) {
             // We can still try to match, but with lower confidence expectation, or just skip it if it's too risky.
             // Let's just do a basic match attempt
        }

        let bestStartIdx = -1;
        let maxMatchCount = 0;

        // Use a dynamic search window. Start small, expand if no good match is found.
        // This allows recovering from large gaps (e.g. missing chapter audio) without killing performance normally.
        const searchWindowSize = 500;
        let windowStart = asrIdx;
        let windowEnd = Math.min(windowStart + searchWindowSize, words.length);

        while (bestStartIdx === -1 && windowStart < words.length) {

        // A simple sliding window approach
        for (let i = windowStart; i < windowEnd; i++) {
            // Count how many consecutive words match approximately
            let matchCount = 0;
            let pIdx = 0;
            let aIdx = i;

            while (pIdx < pWords.length && aIdx < words.length && (aIdx - i) < pWords.length + 5) {
                if (pWords[pIdx] === words[aIdx].word) {
                    matchCount++;
                    pIdx++;
                    aIdx++;
                } else {
                    // Allowed small skips/mishearings
                    let found = false;
                    for(let lookAhead=1; lookAhead<=3; lookAhead++) {
                        if (pIdx + lookAhead < pWords.length && pWords[pIdx + lookAhead] === words[aIdx].word) {
                            matchCount++;
                            pIdx += lookAhead + 1;
                            aIdx++;
                            found = true;
                            break;
                        } else if (aIdx + lookAhead < words.length && pWords[pIdx] === words[aIdx + lookAhead].word) {
                            matchCount++;
                            pIdx++;
                            aIdx += lookAhead + 1;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        pIdx++;
                        aIdx++;
                    }
                }
            }

            if (matchCount > maxMatchCount) {
                maxMatchCount = matchCount;
                bestStartIdx = i;
            }

            // Early exit if perfect match found
            if (maxMatchCount === pWords.length) {
                break;
            }
        }

        // If we didn't find a decent match, expand the search window and try again
        if (maxMatchCount < Math.min(3, pWords.length)) {
            // We failed to find a good match in the current window.
            // Move the window forward and try again, up to the end of the text.
            windowStart = windowEnd;
            windowEnd = Math.min(windowStart + searchWindowSize, words.length);
            bestStartIdx = -1; // Reset to force continuation

            // If we've searched way too far ahead (e.g., 5000 words gap), we should probably
            // give up on this paragraph to avoid scanning the entire book for a missing paragraph,
            // which causes O(N*M) lag.
            if (windowStart - asrIdx > 5000) {
                 break;
            }
        } else {
            break; // Found a decent match, stop expanding
        }
        } // end while

        let confidence: number | null;
        let timestamp_ms: number;

        if (bestStartIdx !== -1 && maxMatchCount > 0) {
            // Calculate match ratio based on paragraph length
            let matchRatio = maxMatchCount / pWords.length;

            // Penalty if the match is too far from expected position (gap)
            const gap = bestStartIdx - asrIdx;
            if (gap > 50) {
                matchRatio *= 0.8;
            }

            confidence = matchRatio;

            // Heuristic for low confidence
            if (confidence < 0.6 || (pWords.length < 3 && confidence < 1.0)) {
                confidence = Math.min(confidence, 0.4); // clamp low
            }

            if (p.needs_review) {
                 confidence = Math.min(confidence, 0.3); // Explicitly low confidence if flagged by parser
            }

            timestamp_ms = Math.floor(words[bestStartIdx].start * 1000);

            // Advance our ASR pointer
            asrIdx = bestStartIdx + maxMatchCount;
        } else {
            // Didn't find anything, just use previous timestamp but flag very low confidence
            confidence = 0.0;
            timestamp_ms = asrIdx > 0 && asrIdx < words.length ? Math.floor(words[asrIdx].start * 1000) : 0;
        }

        syncPoints.push({
            paragraph_id: p.id,
            timestamp_ms: timestamp_ms,
            confidence: confidence
        });
    }

    return syncPoints;
}
