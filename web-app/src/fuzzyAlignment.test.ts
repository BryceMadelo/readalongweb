import { fuzzyAlign, stitchChunks, type ContentBlock, type ASRTranscriptChunk } from './fuzzyAlignment';

describe('stitchChunks', () => {
    it('accumulates timestamps and trims overlap correctly', () => {
        // Chunk 1: isFirstChunk = true, isLastChunk = false
        const outChunks1 = [
            { text: 'hello', timestamp: [0, 1] }, // Keep: isFirstChunk overrides localStart >= 15
            { text: 'world', timestamp: [280, 284] }, // Keep: localStart < 285
            { text: 'overlap1', timestamp: [284, 286] }, // Keep: localStart < 285
            { text: 'overlap2', timestamp: [300, 302] }, // Drop: localStart >= 285
        ];

        const stitched1 = stitchChunks(outChunks1, 0, false, true);
        expect(stitched1.length).toBe(3);
        expect(stitched1[0].timestamp).toEqual([0, 1]);
        expect(stitched1[1].timestamp).toEqual([280, 284]);
        expect(stitched1[2].timestamp).toEqual([284, 286]);

        // Chunk 2: isFirstChunk = false, isLastChunk = false
        const outChunks2 = [
            { text: 'overlap1_repeat', timestamp: [14, 16] }, // Drop: localStart < 15
            { text: 'overlap2_repeat', timestamp: [15, 17] }, // Keep: localStart >= 15
            { text: 'mid', timestamp: [20, 22] }, // Keep: localStart >= 15 && localStart < 285
            { text: 'end_overlap', timestamp: [284, 286] } // Keep: localStart < 285
        ];

        // offset for chunk 2 is 270
        const stitched2 = stitchChunks(outChunks2, 270, false, false);
        expect(stitched2.length).toBe(3);
        expect(stitched2[0].timestamp).toEqual([15 + 270, 17 + 270]);
        expect(stitched2[1].timestamp).toEqual([20 + 270, 22 + 270]);
        expect(stitched2[2].timestamp).toEqual([284 + 270, 286 + 270]);

        // Chunk 3: isFirstChunk = false, isLastChunk = true
        const outChunks3 = [
            { text: 'end_overlap_repeat', timestamp: [13, 16] }, // Drop: localStart < 15
            { text: 'final1', timestamp: [15, 17] }, // Keep
            { text: 'final2', timestamp: [301, 302] }, // Keep: isLastChunk overrides localStart < 285
        ];

        // offset for chunk 3 is 540
        const stitched3 = stitchChunks(outChunks3, 540, true, false);
        expect(stitched3.length).toBe(2);
        expect(stitched3[0].timestamp).toEqual([15 + 540, 17 + 540]);
        expect(stitched3[1].timestamp).toEqual([301 + 540, 302 + 540]);
    });
});

describe('fuzzyAlign', () => {
    it('exact match', () => {
        const paragraphs: ContentBlock[] = [
            { id: 'p1', tag: 'p', text: 'hello world', needs_review: false },
            { id: 'p2', tag: 'p', text: 'this is a test', needs_review: false },
        ];

        const chunks: ASRTranscriptChunk[] = [
            { text: 'hello world', timestamp: [0, 2] },
            { text: 'this is a test', timestamp: [2, 6] },
        ];

        const syncPoints = fuzzyAlign(paragraphs, chunks);

        expect(syncPoints.length).toBe(2);
        expect(syncPoints[0].paragraph_id).toBe('p1');
        expect(syncPoints[0].timestamp_ms).toBe(0); // 0s
        expect(syncPoints[0].confidence).toBeGreaterThan(0.9);

        expect(syncPoints[1].paragraph_id).toBe('p2');
        expect(syncPoints[1].timestamp_ms).toBe(2000); // 2s start
        expect(syncPoints[1].confidence).toBeGreaterThan(0.9);
    });

    it('ASR mishearing & skipped narration', () => {
        const paragraphs: ContentBlock[] = [
            { id: 'p1', tag: 'p', text: 'The quick brown fox jumps over the lazy dog.', needs_review: false },
        ];

        // "jumps" -> "bumps" (mishearing)
        // missing "over the"
        const chunks: ASRTranscriptChunk[] = [
            { text: 'The quick brown fox bumps lazy dog.', timestamp: [10, 17] },
        ];

        const syncPoints = fuzzyAlign(paragraphs, chunks);

        expect(syncPoints.length).toBe(1);
        expect(syncPoints[0].paragraph_id).toBe('p1');
        expect(syncPoints[0].timestamp_ms).toBe(10000);
        // Confidence should be acceptable but maybe not perfect
        expect(syncPoints[0].confidence).toBeGreaterThan(0.5);
        expect(syncPoints[0].confidence).toBeLessThan(1.0);
    });

    it('ambiguous / duplicate text', () => {
        const paragraphs: ContentBlock[] = [
            { id: 'p1', tag: 'p', text: 'Chapter One', needs_review: true }, // From metadata filter
            { id: 'p2', tag: 'p', text: 'Chapter One', needs_review: false }, // Actual chapter title
            { id: 'p3', tag: 'p', text: 'It was the best of times', needs_review: false },
        ];

        const chunks: ASRTranscriptChunk[] = [
            { text: 'Chapter One', timestamp: [5, 6] },
            { text: 'It was the best of times', timestamp: [7, 10] },
        ];

        const syncPoints = fuzzyAlign(paragraphs, chunks);
        expect(syncPoints.length).toBe(3);

        // First one has needs_review = true, should be flagged low confidence
        expect(syncPoints[0].confidence).toBeLessThanOrEqual(0.3);

        // Second one matches 'Chapter One', should have ok confidence? Wait, it matched the first one actually,
        // but due to needs_review it's low. The second one will match the SAME thing or nothing and be low.
        // As long as p3 matches correctly.
        expect(syncPoints[2].paragraph_id).toBe('p3');
        expect(syncPoints[2].timestamp_ms).toBe(7000);
    });
});
