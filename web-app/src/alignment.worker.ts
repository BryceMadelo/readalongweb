import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core-mt?url';
import wasmURL from '@ffmpeg/core-mt/wasm?url';
import workerURL from '@ffmpeg/core-mt/worker?url';
import { pipeline } from '@xenova/transformers';
import { ClientAlignmentProvider } from './alignmentProvider';

const ffmpeg = new FFmpeg();
let alignmentProvider: ClientAlignmentProvider | null = null;
let currentProgressId = 0;

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;
    console.log('Worker received message type:', type);

    if (type === 'ALIGN_AUDIO') {
        const { audioBlob, epubText } = payload;

        try {
            console.log('Starting alignment process...');
            self.postMessage({ type: 'PROGRESS', payload: { message: 'Loading audio transcriber and core tools (this may take a moment)...' } });

            if (!alignmentProvider) {
                console.log('Loading FFmpeg core and Transformers.js pipeline...');
                await ffmpeg.load({
                    coreURL,
                    wasmURL,
                    workerURL,
                });

                const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
                    quantized: true,
                });

                alignmentProvider = new ClientAlignmentProvider(ffmpeg, transcriber);
            }

            const progressId = ++currentProgressId;
            self.postMessage({ type: 'PROGRESS', payload: { message: 'Transcribing and aligning audio...' } });
            console.log('Calling align()...');

            const syncPoints = await alignmentProvider.align(
                audioBlob,
                epubText,
                (msg: string) => {
                    if (progressId === currentProgressId) {
                        self.postMessage({ type: 'PROGRESS', payload: { message: msg } });
                    }
                }
            );

            console.log('Alignment successful, sending points back.');
            self.postMessage({ type: 'ALIGN_SUCCESS', payload: { syncMap: syncPoints } });

        } catch (error: any) {
            console.error('Alignment failed with error:', error);
            self.postMessage({ type: 'ALIGN_ERROR', payload: { error: error.message || 'Unknown alignment error' } });
        }
    }
};
