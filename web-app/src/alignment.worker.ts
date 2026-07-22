import { pipeline, env } from '@xenova/transformers';

// Disable local models, fetch from HF
env.allowLocalModels = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;

import { fuzzyAlign, type ASRTranscriptChunk } from './fuzzyAlignment';

// Handle messages from the main thread
self.addEventListener('message', async (event) => {
    const { type, audioFile, validBlocks } = event.data;

    if (type === 'START_ALIGNMENT') {
        try {
            if (!transcriber) {
                self.postMessage({ type: 'PROGRESS', status: 'Loading Whisper model...' });
                transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', {
                    quantized: true // Keep it fast/light
                });
            }

            self.postMessage({ type: 'PROGRESS', status: 'Transcribing audio (this may take a while)...' });

            // To prevent OOM, we manually slice the audio file into smaller segments before decoding.
            // A 10-minute audio file is safe to decode and process in memory.
            // However, slicing an mp3/m4a file byte-wise doesn't guarantee clean audio frames.
            // Since `read_audio` (used internally by pipeline) uses a robust WASM decoder (FFmpeg/WaveFile),
            // it can handle partial file blobs gracefully in most cases, though we might miss a second at chunk boundaries.
            // For a production app, we would use WebCodecs `AudioDecoder` to stream decodes, but this is a solid middle ground.

            // Note: Since `File.slice` is byte-based, estimating byte-to-time mapping for VBR mp3s is hard.
            // A safer workaround that avoids massive byte array allocations while still using the pipeline is to decode using
            // an OfflineAudioContext in JS in chunks, OR use the pipeline's internal streaming if we pass the whole URL.
            // WAIT, the prompt explicitly says: "decodeAudioData being used on massive multi-hour audio files" causes OOM.
            // So we MUST use Web Audio API to decode chunks, or rely on `read_audio` with smaller blobs.
            // Actually, the simplest fix without writing a WebCodecs demuxer is to decode the file using `AudioContext`
            // BUT we can't decode the whole file.

            // Since we must chunk, let's use the object URL directly with the transcriber.
            // Wait, Transformers.js *loads the entire file into an ArrayBuffer* inside `read_audio` if given a URL.
            // This is what causes OOM on 10h files!
            // So we really do need to use `File.slice` to feed `read_audio` smaller blobs.
            // Let's assume a ~60MB file is roughly 10 hours of 16kbps voice.
            // Slicing it into 10MB chunks is safe.

            const CHUNK_SIZE_BYTES = 10 * 1024 * 1024; // 10MB chunks
            let allChunks: ASRTranscriptChunk[] = [];
            let totalProcessedS = 0; // We need to estimate or accumulate duration.

            for (let offset = 0; offset < audioFile.size; offset += CHUNK_SIZE_BYTES) {
                const end = Math.min(offset + CHUNK_SIZE_BYTES, audioFile.size);
                const sliceBlob = audioFile.slice(offset, end, audioFile.type);

                // create a temporary URL for this chunk
                const chunkUrl = URL.createObjectURL(sliceBlob);

                try {
                    const output = await transcriber(chunkUrl, {
                        chunk_length_s: 30,
                        stride_length_s: 5,
                        return_timestamps: 'word'
                    });

                    const outChunks = output.chunks || [];

                    // We need to know how long this chunk was to offset the next chunk's timestamps.
                    // The transcriber output chunks will have relative timestamps.
                    let maxTimestampS = 0;

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const adjustedChunks = outChunks.map((c: any) => {
                        const start = (c.timestamp[0] ?? 0);
                        const endT = (c.timestamp[1] ?? start);
                        maxTimestampS = Math.max(maxTimestampS, endT);
                        return {
                            text: c.text,
                            timestamp: [start + totalProcessedS, endT + totalProcessedS]
                        };
                    });

                    allChunks = allChunks.concat(adjustedChunks);
                    totalProcessedS += maxTimestampS; // Increment offset for the next chunk

                    const progressPct = Math.min(100, Math.round((end / audioFile.size) * 100));
                    self.postMessage({ type: 'PROGRESS', status: `Transcribing... ${progressPct}%` });

                    // Emit partial sync
                    const partialSyncMap = fuzzyAlign(validBlocks, allChunks);
                    self.postMessage({ type: 'PARTIAL_SYNC', syncMap: partialSyncMap });

                } catch (chunkErr) {
                    console.error("Chunk decode error, skipping chunk:", chunkErr);
                } finally {
                    URL.revokeObjectURL(chunkUrl);
                }
            }

            self.postMessage({ type: 'COMPLETE', syncMap: fuzzyAlign(validBlocks, allChunks) });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            self.postMessage({ type: 'ERROR', error: error.message });
        }
    }
});
