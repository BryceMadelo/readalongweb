import { pipeline, env } from '@xenova/transformers';

// Disable local models, fetch from HF
env.allowLocalModels = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;

// Handle messages from the main thread
self.addEventListener('message', async (event) => {
    const { type, audioData } = event.data;

    if (type === 'START_ALIGNMENT') {
        try {
            if (!transcriber) {
                self.postMessage({ type: 'PROGRESS', status: 'Loading Whisper model...' });
                transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
                    quantized: true // Keep it fast/light
                });
            }

            self.postMessage({ type: 'PROGRESS', status: 'Transcribing audio (this may take a while)...' });

            // audioData should be a Float32Array at 16kHz
            const output = await transcriber(audioData, {
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: 'word' // We need word-level timestamps for alignment
            });

            self.postMessage({ type: 'PROGRESS', status: 'Aligning text to audio...' });

            // Output chunks look like: { text: string, timestamp: [start, end] }
            const chunks = output.chunks || [];

            self.postMessage({ type: 'COMPLETE', chunks });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            self.postMessage({ type: 'ERROR', error: error.message });
        }
    }
});
