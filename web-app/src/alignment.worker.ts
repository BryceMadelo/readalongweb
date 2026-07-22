import { pipeline, env } from '@xenova/transformers';

// Disable local models, fetch from HF
env.allowLocalModels = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;

import { fuzzyAlign, type ASRTranscriptChunk } from './fuzzyAlignment';

// Handle messages from the main thread
self.addEventListener('message', async (event) => {
    const { type, audioUrl, validBlocks } = event.data;

    if (type === 'START_ALIGNMENT') {
        try {
            if (!transcriber) {
                self.postMessage({ type: 'PROGRESS', status: 'Loading Whisper model...' });
                transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', {
                    quantized: true // Keep it fast/light
                });
            }

            self.postMessage({ type: 'PROGRESS', status: 'Transcribing audio (this may take a while)...' });

            const output = await transcriber(audioUrl, {
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: 'word'
            });

            const outChunks = output.chunks || [];
            
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adjustedChunks: ASRTranscriptChunk[] = outChunks.map((c: any) => {
                const start = (c.timestamp[0] ?? 0);
                const endT = (c.timestamp[1] ?? start);
                return {
                    text: c.text,
                    timestamp: [start, endT]
                };
            });

            self.postMessage({ type: 'COMPLETE', syncMap: fuzzyAlign(validBlocks, adjustedChunks) });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            self.postMessage({ type: 'ERROR', error: error.message });
        }
    }
});
