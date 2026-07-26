import { useState, useRef, DragEvent } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { load_epub_paragraphs, load_epub_images } from 'readalong-wasm';
import { Upload, ArrowLeft, CheckCircle, File as FileIcon, X, Plus, Book, Music } from 'lucide-react';
import { saveBook, updateSyncMap, type ContentBlock, getBookData } from '../../storage/db';
import { useAlignment } from '../../context/AlignmentContext';

export default function Import() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const addAudioBookId = searchParams.get('add_audio');
  const { startJob, failJob } = useAlignment();
  const [epubFile, setEpubFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState(false);

  const epubInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith('.epub')) {
        setEpubFile(file);
      } else {
        setError("Please drop a valid .epub file.");
      }
    }
  };

  const handleImport = async () => {
    // If we're strictly in "add audio" mode
    if (addAudioBookId) {
      if (!audioFile) {
        setError("Please select an audio file to add to the existing book.");
        return;
      }
      setIsProcessing(true);
      setError(null);
      try {
        const bookData = await getBookData(addAudioBookId);
        if (!bookData || !bookData.meta) {
           throw new Error("Could not find original book.");
        }

        const formData = new FormData();
        formData.append('audio', audioFile);

        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const response = await fetch(`${API_URL}/add_audio/${addAudioBookId}`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${await response.text()}`);
        }

        // Re-save book with new audio blob
        await saveBook(
          bookData.meta,
          bookData.paragraphs,
          audioFile,
          [],
          bookData.images
        );

        startJob({ bookId: addAudioBookId, bookTitle: bookData.meta.title, progressMsg: "Aligning text and audio...", status: 'processing' });

        setSuccess(true);
        setTimeout(() => {
          navigate('/');
        }, 1500);

      } catch (err: unknown) {
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to add audio.");
        setIsProcessing(false);
      }
      return;
    }


    // Normal import mode
    if (!epubFile) {
      setError("An EPUB file is required to import a book.");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const arrayBuffer = await epubFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const epubData = load_epub_paragraphs(bytes);
      
      if (epubData.error) {
        throw new Error(`EPUB processing failed: ${epubData.error}`);
      }

      const validBlocks: ContentBlock[] = epubData.blocks.filter((b: ContentBlock) => 
        b.tag === 'img' || (b.text && b.text.trim().length > 0)
      );
      
      const title = epubFile.name.replace('.epub', '').replace(/[-_]/g, ' ');

      const rawImages = load_epub_images(bytes); 
      const processedImages: Record<string, Uint8Array> = {};
      
      for (let i = 0; i < rawImages.length; i++) {
        const [path, data] = rawImages[i];
        processedImages[path] = data;
      }

      const formData = new FormData();
      formData.append('epub', epubFile);
      if (audioFile) {
        formData.append('audio', audioFile);
      }

      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${API_URL}/import`, {
          method: 'POST',
          body: formData,
      });

      if (!response.ok) {
          throw new Error(`Server returned ${response.status}: ${await response.text()}`);
      }

      const { book_id: serverBookId } = await response.json();

      await saveBook(
        {
          id: serverBookId,
          title: title,
          author: "Unknown Author",
          dateAdded: Date.now(),
          progress: 0
        },
        validBlocks,
        audioFile,
        [],
        processedImages
      );

      if (audioFile) {
        startJob({ bookId: serverBookId, bookTitle: title, progressMsg: "Aligning text and audio...", status: 'processing' });
      }

      setSuccess(true);
      setTimeout(() => {
        navigate('/');
      }, 1500);

    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred during import.");
      setIsProcessing(false);
      failJob("Import failed.");
    }
  };

  return (
    <div className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem', maxWidth: '800px' }}>
      {success && (
        <div style={{
          position: 'fixed', top: '2rem', left: '50%', transform: 'translateX(-50%)',
          backgroundColor: '#10b981', color: 'white', padding: '1rem 2rem', borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: '0.75rem',
          zIndex: 1000, animation: 'fadeIn 0.3s ease-out'
        }}>
          <CheckCircle size={20} />
          <span style={{ fontWeight: 500 }}>{addAudioBookId ? 'Audio track successfully added' : 'Book successfully imported to your library'}</span>
        </div>
      )}

      <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '2rem', fontWeight: 500 }}>
        <ArrowLeft size={20} />
        Back to Library
      </Link>
      
      <header style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{addAudioBookId ? 'Add Audio Track' : 'Import Content'}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
          {addAudioBookId ? 'Upload a narration file to sync with your existing book.' : 'Upload an EPUB book and optional narration to add to your library.'}
        </p>
      </header>

      {error && (
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '2rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginBottom: '3rem' }}>
        
        {/* Main Content (EPUB) */}
        {!addAudioBookId && (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Main Content (EPUB) <span style={{ color: 'var(--danger)' }}>*</span></h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>The primary text content of your book</p>
              </div>
            </div>

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !epubFile && epubInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                borderRadius: '12px',
                padding: '3rem 2rem',
                textAlign: 'center',
                backgroundColor: isDragging ? 'rgba(59, 130, 246, 0.05)' : 'var(--bg-secondary)',
                cursor: epubFile ? 'default' : 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem'
              }}
            >
              <input
                type="file"
                accept=".epub"
                ref={epubInputRef}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    setEpubFile(e.target.files[0]);
                  }
                }}
                style={{ display: 'none' }}
              />

              {!epubFile ? (
                <>
                  <div style={{
                    width: '64px', height: '64px', borderRadius: '50%',
                    backgroundColor: 'var(--bg-tertiary)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    color: 'var(--accent-primary)', marginBottom: '0.5rem'
                  }}>
                    <Upload size={32} />
                  </div>
                  <div>
                    <p style={{ fontSize: '1.1rem', fontWeight: 500, marginBottom: '0.25rem' }}>Drag and drop your EPUB file or click to browse</p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Supports .epub files up to 50MB</p>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', width: '100%', maxWidth: '400px' }}>
                    <Book size={24} color="var(--accent-primary)" />
                    <div style={{ flex: 1, textAlign: 'left', overflow: 'hidden' }}>
                      <p style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{epubFile.name}</p>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{formatFileSize(epubFile.size)}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEpubFile(null); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.5rem' }}
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', fontSize: '0.9rem', fontWeight: 500 }}>
                    <CheckCircle size={18} />
                    Metadata Ready
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Audio Track (Optional) */}
        <section>
          <div style={{ marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Audio Track <span style={{ color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 'normal' }}>{addAudioBookId ? '' : '(OPTIONAL)'}</span></h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{addAudioBookId ? 'The professional narration file' : 'Sync a professional narration file later in the reader settings'}</p>
          </div>

          <div style={{
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '1.5rem',
            backgroundColor: 'var(--bg-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <input 
              type="file" 
              accept="audio/*" 
              ref={audioInputRef}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  setAudioFile(e.target.files[0]);
                }
              }}
              style={{ display: 'none' }}
            />

            {!audioFile ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                    <Music size={24} />
                  </div>
                  <div>
                    <p style={{ fontWeight: 500 }}>No audio track selected</p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Supports .mp3, .m4a</p>
                  </div>
                </div>
                <button
                  onClick={() => audioInputRef.current?.click()}
                  className="btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
                >
                  <Plus size={18} />
                  Add Audio
                </button>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, overflow: 'hidden' }}>
                  <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-primary)' }}>
                    <Music size={24} />
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <p style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{audioFile.name}</p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{formatFileSize(audioFile.size)}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', fontSize: '0.9rem', fontWeight: 500 }}>
                    <CheckCircle size={18} />
                    Ready
                  </div>
                  <button
                    onClick={() => setAudioFile(null)}
                    className="btn"
                    style={{ padding: '0.5rem', color: 'var(--text-secondary)', backgroundColor: 'transparent', border: '1px solid var(--border-color)' }}
                  >
                    <X size={18} />
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Organization */}
        {!addAudioBookId && (
          <section>
            <div style={{ marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Organization</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Group your content for easier access</p>
            </div>

            <div style={{
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1.5rem',
              backgroundColor: 'var(--bg-secondary)',
            }}>
              <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 500, marginBottom: '0.5rem' }}>Collection</label>
              <select
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: '1rem',
                  outline: 'none',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
                defaultValue="uncategorized"
              >
                <option value="uncategorized">Uncategorized</option>
                <option value="favorites">Favorites</option>
                <option value="to-read">To Read</option>
              </select>
            </div>
          </section>
        )}

      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '2rem' }}>
        <button
          onClick={() => navigate('/')}
          className="btn"
          style={{ padding: '0.875rem 1.5rem', backgroundColor: 'transparent', border: 'none', color: 'var(--text-secondary)', fontWeight: 500 }}
          disabled={isProcessing}
        >
          Cancel
        </button>
        <button 
          className="btn btn-primary" 
          onClick={handleImport}
          disabled={isProcessing || (!epubFile && !addAudioBookId) || (addAudioBookId && !audioFile)}
          style={{ padding: '0.875rem 2rem', fontSize: '1rem', opacity: (isProcessing || (!epubFile && !addAudioBookId) || (addAudioBookId && !audioFile)) ? 0.5 : 1 }}
        >
          {isProcessing ? (addAudioBookId ? 'Adding Audio...' : 'Importing...') : (addAudioBookId ? 'Confirm Addition' : 'Complete Import')}
        </button>
      </div>
    </div>
  );
}
