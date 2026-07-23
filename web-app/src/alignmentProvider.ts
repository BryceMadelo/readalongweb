import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { ContentBlock } from './fuzzyAlignment';

export interface AlignmentProvider {
    align(
        audioBlob: Blob,
        epubText: ContentBlock[],
        onProgress: (msg: string) => void
    ): Promise<any>;
}

export class ClientAlignmentProvider implements AlignmentProvider {
    public ffmpeg: FFmpeg;
    public transcriber: any;

    constructor(ffmpeg: FFmpeg, transcriber: any) {
        this.ffmpeg = ffmpeg;
        this.transcriber = transcriber;
    }

    async align(
        audioBlob: Blob,
        epubText: ContentBlock[],
        onProgress: (msg: string) => void
    ): Promise<any> {
        console.log("audioBlob:", audioBlob, "epubText:", epubText, "onProgress:", onProgress);
        return [];
    }
}
