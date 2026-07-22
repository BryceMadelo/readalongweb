import { pipeline, env } from '@xenova/transformers';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { fuzzyAlign, stitchChunks, type ASRTranscriptChunk, type ContentBlock, type SyncPoint } from './fuzzyAlignment';
import { type AlignmentProvider } from './alignmentProvider';

// Import ffmpeg-core via Vite static asset resolution for offline support
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

// Disable local models, fetch from HF
env.allowLocalModels = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;

class ClientAlignmentProvider implements AlignmentProvider {
    async align(
        audioUrl: string,
        validBlocks: ContentBlock[],
        onProgress: (status: string) => void
    ): Promise<SyncPoint[]> {
        if (!transcriber) {
            onProgress('Loading Whisper model...');
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', {
                quantized: true // Keep it fast/light
            });
        }

        onProgress('Initializing FFmpeg...');
        const ffmpeg = new FFmpeg();

        ffmpeg.on('log', ({ message }) => {
            console.log(`[FFmpeg] ${message}`);
        });

        await ffmpeg.load({
            coreURL,
            wasmURL,
        });

        try {
            onProgress('Writing audio file to memory...');
            const response = await fetch(audioUrl);
            const audioBlob = await response.blob();
            await ffmpeg.writeFile('input.audio', await fetchFile(audioBlob));

            const FETCH_DURATION = 330; // Extract 330s total
            const ADVANCE_DURATION = 270; // Advance by 270s each time

            let allAdjustedChunks: ASRTranscriptChunk[] = [];
            let timeOffset = 0;
            let chunkIndex = 0;

            while (true) {
                chunkIndex++;
                onProgress(`Transcribing chunk ${chunkIndex} (offset: ${timeOffset}s)...`);

                // Extract the next chunk. -i before -ss for accurate seeking, but -ss before -i is much faster.
                // We'll use -ss before -i for speed.
                await ffmpeg.exec([
                    '-ss', timeOffset.toString(),
                    '-i', 'input.audio',
                    '-t', FETCH_DURATION.toString(),
                    '-c:a', 'pcm_f32le',
                    '-ar', '16000',
                    '-ac', '1',
                    '-f', 'f32le', // explicitly set output format
                    'out.bin' // overwrite the same file each time
                ]);

                let chunkData: Uint8Array;
                try {
                    chunkData = await ffmpeg.readFile('out.bin') as Uint8Array;
                } catch (e) {
                    console.log("No more data or error reading out.bin", e);
                    break;
                }

                if (chunkData.length === 0) {
                    console.log("Empty chunk, end of file reached.");
                    break;
                }

                // Copy to aligned Float32Array
                const alignedBuffer = new ArrayBuffer(chunkData.byteLength);
                new Uint8Array(alignedBuffer).set(chunkData);
                const float32Data = new Float32Array(alignedBuffer);

                const actualChunkDuration = float32Data.length / 16000;

                const output = await transcriber(float32Data, {
                    chunk_length_s: 30, // Internal Whisper chunking
                    stride_length_s: 5,
                    return_timestamps: 'word'
                });

                const outChunks = output.chunks || [];
                const isLastChunk = actualChunkDuration < FETCH_DURATION - 1; // if we got significantly less than requested

                // Stitching constraints:
                // We fetch 330s. We keep words inside [15s, 285s] local time.
                // For chunk 0, we keep [0, 285s].
                // For the last chunk, we keep [15s, actualChunkDuration].
                // The ADVANCE_DURATION is 270s (285 - 15).
                const adjustedChunks = stitchChunks(outChunks, timeOffset, isLastChunk, timeOffset === 0);

                allAdjustedChunks = allAdjustedChunks.concat(adjustedChunks);

                // Clean up MEMFS to avoid OOM
                await ffmpeg.deleteFile('out.bin');

                if (isLastChunk) {
                    break;
                }

                timeOffset += ADVANCE_DURATION;
            }

            onProgress('Aligning text...');
            return fuzzyAlign(validBlocks, allAdjustedChunks);
        } finally {
            ffmpeg.terminate();
        }
    }
}

const provider = new ClientAlignmentProvider();

// Handle messages from the main thread
self.addEventListener('message', async (event) => {
    const { type, audioUrl, validBlocks } = event.data;

    if (type === 'START_ALIGNMENT') {
        try {
            const syncMap = await provider.align(
                audioUrl,
                validBlocks,
                (status) => self.postMessage({ type: 'PROGRESS', status })
            );

            self.postMessage({ type: 'COMPLETE', syncMap });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            self.postMessage({ type: 'ERROR', error: error.message });
        }
    }
});
