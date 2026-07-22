import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { load_epub_paragraphs, load_epub_images } from 'readalong-wasm';
import { Upload, Book, Music, ArrowLeft } from 'lucide-react';
import { saveBook, updateSyncMap, type ContentBlock } from '../../storage/db';
import { useAlignment } from '../../context/AlignmentContext';

export default function Import() {
  const navigate = useNavigate();
  const { startJob, updateJob, completeJob, failJob } = useAlignment();
  const [epubFile, setEpubFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!epubFile || !audioFile) {
      setError("Please provide both EPUB and Audio files to import a book.");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // 1. Process EPUB via WASM
      const arrayBuffer = await epubFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const epubData = load_epub_paragraphs(bytes);
      
      if (epubData.error) {
        throw new Error(`EPUB processing failed: ${epubData.error}`);
      }

      const validBlocks: ContentBlock[] = epubData.blocks.filter((b: ContentBlock) => 
        b.tag === 'img' || (b.text && b.text.trim().length > 0)
      );
      
      const bookId = crypto.randomUUID();
      const title = epubFile.name.replace('.epub', '').replace(/[-_]/g, ' ');

      // Use the global alignment context for background processing indication
      startJob({ bookId, bookTitle: title, progressMsg: "Preparing sync map...", status: 'processing' });

      // We don't decode the whole audio file at once because decoding a 10-hour
      // audio blob directly causes severe RAM spikes and OOM.
      // Instead, we pass the file directly to the worker, which uses ffmpeg.wasm
      // to chunk-decode the massive file into small 30-second segments.
      // --- NEW IMAGE EXTRACTION LOGIC ---
      // 4. Extract images using our new Rust function
      const rawImages = load_epub_images(bytes); 
      const processedImages: Record<string, Uint8Array> = {};
      
      for (let i = 0; i < rawImages.length; i++) {
        const [path, data] = rawImages[i];
        processedImages[path] = data; // Store raw Uint8Array against its zip path
      }
      console.log(`Extracted ${Object.keys(processedImages).length} images from the EPUB.`);
      // ----------------------------------

      // 5. Navigate to Library IMMEDIATELY. Let alignment run in the background.

      // Save book first with an empty sync map so it appears in the library instantly.
      await saveBook(
        {
          id: bookId,
          title: title,
          author: "Unknown Author",
          dateAdded: Date.now(),
          progress: 0
        },
        validBlocks,
        audioFile,
        [], // empty sync map initially
        processedImages
      );

      navigate('/'); // Go to library immediately

      // Fire off the background worker for alignment
      const worker = new Worker(new URL('../../alignment.worker.ts', import.meta.url), { type: 'module' });

      worker.onmessage = async (e) => {
        const { type, syncMap, status, error: workerError } = e.data;

        if (type === 'PROGRESS') {
           updateJob(status);
        } else if (type === 'PARTIAL_SYNC' || type === 'COMPLETE') {
          // Use the dedicated update function to avoid I/O thrashing on massive blobs
          await updateSyncMap(bookId, syncMap);

          if (type === 'COMPLETE') {
              completeJob();
              worker.terminate();
          }
        } else if (type === 'ERROR') {
          failJob(`Alignment failed: ${workerError}`);
          worker.terminate();
        }
      };

      const audioUrl = URL.createObjectURL(audioFile);

      worker.postMessage({
        type: 'START_ALIGNMENT',
        audioUrl,
        validBlocks
      });

    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred during import.");
      setIsProcessing(false);
      failJob("Import failed.");
    }
  };

  return (
    <div className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem', maxWidth: '800px' }}>
      <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '2rem', fontWeight: 500 }}>
        <ArrowLeft size={20} />
        Back to Library
      </Link>
      
      <header style={{ marginBottom: '3rem' }}>
        <h1>Import Book</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Upload your EPUB and Audio file to add a new book to your library.</p>
      </header>

      {error && (
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '2rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '3rem' }}>
        
        {/* EPUB Upload */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '1.5rem' }}>
          <div style={{ padding: '1rem', borderRadius: '12px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-primary)' }}>
            <Book size={32} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginBottom: '0.25rem' }}>EPUB Book</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>The book content (.epub)</p>
            <input 
              type="file" 
              accept=".epub" 
              onChange={(e) => setEpubFile(e.target.files?.[0] || null)}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Audio Upload */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '1.5rem' }}>
          <div style={{ padding: '1rem', borderRadius: '12px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-primary)' }}>
            <Music size={32} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginBottom: '0.25rem' }}>Audio Track</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>The audiobook file (.mp3, .m4a)</p>
            <input 
              type="file" 
              accept="audio/*" 
              onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
              style={{ width: '100%' }}
            />
          </div>
        </div>

      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <button 
          className="btn btn-primary" 
          onClick={handleImport}
          disabled={isProcessing || !epubFile || !audioFile}
          style={{ padding: '1rem 2rem', fontSize: '1.125rem', opacity: (isProcessing || !epubFile || !audioFile) ? 0.5 : 1 }}
        >
          {isProcessing ? 'Processing...' : (
            <>
              <Upload size={20} />
              Import to Library
            </>
          )}
        </button>
      </div>
    </div>
  );
}