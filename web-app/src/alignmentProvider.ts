import type { ContentBlock, SyncPoint } from './fuzzyAlignment';

export interface AlignmentProvider {
    align(
        audioUrl: string,
        validBlocks: ContentBlock[],
        onProgress: (status: string) => void
    ): Promise<SyncPoint[]>;
}
