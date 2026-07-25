import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { PlaybackSync } from 'readalong-wasm';
import { ArrowLeft, Settings2, List } from 'lucide-react';
import { getBookData, updateBookProgress, type BookMeta, type ContentBlock, type SyncPoint } from '../../storage/db';
import Player from '../../components/Player/Player';
import { useAlignment } from '../../context/AlignmentContext';
import { ReaderSettings, type ReaderSettingsState, defaultSettings } from './ReaderSettings';
import { ReaderTOC } from './ReaderTOC';

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const { activeJob } = useAlignment();
  const [meta, setMeta] = useState<BookMeta | null>(null);
  const [paragraphs, setParagraphs] = useState<ContentBlock[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [images, setImages] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  
  const [activeParagraphIndex, setActiveParagraphIndex] = useState<number | null>(null);
  const [seekToMs, setSeekToMs] = useState<number | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [settings, setSettings] = useState<ReaderSettingsState>(() => {
    const saved = localStorage.getItem('reader-settings');
    return saved ? JSON.parse(saved) : defaultSettings;
  });

  const lastProgressSaveRef = useRef<number>(0);
  const latestTimeRef = useRef<number>(0);
  const initializedTimeRef = useRef<boolean>(false);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    localStorage.setItem('reader-settings', JSON.stringify(settings));
  }, [settings]);

  const syncEngineRef = useRef<PlaybackSync | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  
  // To map ID -> index for fast scrolling
  const idToIndexMap = useRef<Map<string, number>>(new Map());
  // To map Index -> ID for clicking to seek (Text -> Audio)
  const paragraphIdMap = useRef<Map<number, string>>(new Map());

  // We need the raw sync points for Text -> Audio seek. Let's fetch them.
  const [syncPoints, setSyncPoints] = useState<SyncPoint[]>([]);

  useEffect(() => {
    async function loadBook() {
      if (!id) return;
      try {
        const data = await getBookData(id);
        if (data.meta) {
          setMeta(data.meta);
          setParagraphs(data.paragraphs);
          
          if (data.audioBlob) {
            const url = URL.createObjectURL(data.audioBlob);
            objectUrlsRef.current.push(url);
            setAudioUrl(url);
          }
          
          if (data.images) {
            const imageUrls: Record<string, string> = {};
            for (const [path, uint8] of Object.entries(data.images)) {
              const blob = new Blob([new Uint8Array(uint8)]);
              const url = URL.createObjectURL(blob);
              objectUrlsRef.current.push(url);
              imageUrls[path] = url;
            }
            setImages(imageUrls);
          }

          if (data.syncMap && data.syncMap.length > 0) {
            setSyncPoints(data.syncMap);
            const engine = new PlaybackSync();
            data.syncMap.forEach((point) => {
              engine.add_sync_point(point.paragraph_id, point.timestamp_ms, point.confidence ?? undefined);
            });
            engine.build_engine();
            syncEngineRef.current = engine;
          }

          data.paragraphs.forEach((block, idx) => {
            if (block.id) {
              idToIndexMap.current.set(block.id, idx);
              paragraphIdMap.current.set(idx, block.id);
            }
          });
        }
      } catch (e) {
        console.error("Failed to load book:", e);
      } finally {
        setIsLoading(false);
      }
    }
    loadBook();
    
    return () => {
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
      
      // Save progress on unmount
      if (id && latestTimeRef.current > 0) {
        updateBookProgress(id, latestTimeRef.current).catch(console.error);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    // Only seek to saved progress once when audio first loads
    if (meta && audioUrl && !initializedTimeRef.current && meta.progress > 0) {
      setSeekToMs(meta.progress);
      initializedTimeRef.current = true;
    }
  }, [meta, audioUrl]);

  // Poll for updates if this book is actively processing
  useEffect(() => {
    if (id && activeJob?.bookId === id && activeJob.status === 'processing') {
      const poll = async () => {
        const data = await getBookData(id);
        if (data.syncMap && data.syncMap.length > 0) {
          setSyncPoints(data.syncMap);
          const engine = new PlaybackSync();
          data.syncMap.forEach((point) => {
            engine.add_sync_point(point.paragraph_id, point.timestamp_ms, point.confidence ?? undefined);
          });
          engine.build_engine();
          syncEngineRef.current = engine;
        }
      };
      
      poll();
      const interval = setInterval(poll, 2000);
      return () => clearInterval(interval);
    }
  }, [id, activeJob?.bookId, activeJob?.status]);

  const handleTimeUpdate = (currentTimeMs: number) => {
    latestTimeRef.current = currentTimeMs;
    // Throttle save progress to DB (e.g., every 5 seconds)
    const now = Date.now();
    if (id && now - lastProgressSaveRef.current > 5000) {
      updateBookProgress(id, currentTimeMs).catch(console.error);
      lastProgressSaveRef.current = now;
    }

    if (syncEngineRef.current) {
      const activeId = syncEngineRef.current.get_active_paragraph(currentTimeMs);
      if (activeId) {
        const index = idToIndexMap.current.get(activeId);
        if (index !== undefined) {
          setActiveParagraphIndex(prev => {
            if (prev !== index) {
              virtuosoRef.current?.scrollToIndex({
                index,
                align: 'center',
                behavior: 'smooth'
              });
              return index;
            }
            return prev;
          });
        }
      }
    }
  };

  const handleTextTap = (index: number) => {
    const paragraphId = paragraphIdMap.current.get(index);
    if (paragraphId) {
      const point = syncPoints.find(p => p.paragraph_id === paragraphId);
      if (point) {
        setSeekToMs(point.timestamp_ms);
        setActiveParagraphIndex(index);
      }
    }
  };

  const handleTOCSelect = (index: number) => {
    virtuosoRef.current?.scrollToIndex({ index, align: 'start', behavior: 'smooth' });
    handleTextTap(index);
    setShowTOC(false); // Auto close TOC on select
  };

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  if (!meta) return <div>Book not found.</div>;

  const isAligningThis = activeJob?.bookId === id && (activeJob?.status === 'processing' || activeJob?.status === 'paused');
  const pMin = activeJob?.progressMin || 0;
  const tMin = activeJob?.totalMin || 0;
  const pBucket = Math.floor(pMin / 10) * 10;
  const tBucket = Math.floor(tMin / 10) * 10;

  const getReaderStyles = (): React.CSSProperties => {
    return {
      '--reader-bg': settings.appearance === 'light' ? '#ffffff' : settings.appearance === 'sepia' ? '#fbf0d9' : '#1a1a1a',
      '--reader-text-color': settings.appearance === 'light' ? '#111111' : settings.appearance === 'sepia' ? '#5f4b32' : '#e0e0e0',
      '--reader-heading-color': settings.appearance === 'light' ? '#000000' : settings.appearance === 'sepia' ? '#3e2a14' : '#ffffff',
      '--reader-font': settings.typography === 'serif' ? 'Georgia, serif' : 'system-ui, -apple-system, sans-serif',
      '--reader-font-size': settings.textSize === 'small' ? '1rem' : settings.textSize === 'medium' ? '1.25rem' : '1.5rem',
      '--reader-line-height': settings.textHeight === 'small' ? '1.4' : settings.textHeight === 'medium' ? '1.6' : '2.0',
      '--reader-align': settings.alignment,
      '--reader-max-width': settings.pageMargins === 'narrow' ? '1000px' : settings.pageMargins === 'medium' ? '800px' : '600px',
      height: '100%',
      backgroundColor: 'transparent',
    } as React.CSSProperties;
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflowX: 'hidden', overflowY: 'hidden', backgroundColor: settings.appearance === 'light' ? '#ffffff' : settings.appearance === 'sepia' ? '#fbf0d9' : '#1a1a1a' }}>
      
      {/* TOC Sidebar */}
      {showTOC && (
        <ReaderTOC 
          paragraphs={paragraphs} 
          onSelect={handleTOCSelect} 
          activeIndex={activeParagraphIndex} 
          onClose={() => setShowTOC(false)}
        />
      )}

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        
        {/* Header */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', backgroundColor: 'var(--glass-bg)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border-color)', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link to="/" style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
              <ArrowLeft size={24} />
            </Link>
            <button onClick={() => setShowTOC(!showTOC)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}>
              <List size={24} />
            </button>
            <h2 style={{ margin: 0, fontSize: '1.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }}>
              {meta.title}
            </h2>
          </div>
          <button onClick={() => setShowSettings(!showSettings)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Settings2 size={20} />
            <span style={{ fontSize: '0.9rem', display: window.innerWidth > 600 ? 'inline' : 'none' }}>Settings</span>
          </button>
        </header>

        {/* Alignment Progress Bar (Sticky Top) */}
        {isAligningThis && (
          <div style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '1px solid var(--border-color)' }}>
             <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-primary)', minWidth: '100px' }}>
               {activeJob?.status === 'paused' ? 'Paused' : 'Aligning...'}
             </div>
             <div style={{ flex: 1, height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
               <div style={{ height: '100%', background: 'var(--accent-primary)', width: `${tMin > 0 ? (pMin / tMin) * 100 : 0}%`, transition: 'width 0.3s ease' }} />
             </div>
             <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{pBucket}m / {tBucket}m</div>
          </div>
        )}

        {/* Reader Scroller */}
        <div style={{ flex: 1, padding: '2rem 1rem 0 1rem', overflow: 'hidden' }}>
          <div style={getReaderStyles()}>
            <Virtuoso
              ref={virtuosoRef}
              data={paragraphs}
              style={{ height: '100%' }}
              itemContent={(index, block) => {
                const isActive = index === activeParagraphIndex;
                
                if (block.tag === 'img' && block.src) {
                  let url = block.src.startsWith('data:') ? block.src : images[block.src];
                  if (!url && !block.src.startsWith('data:')) {
                    const filename = block.src.split('/').pop()?.toLowerCase(); 
                    if (filename) {
                      const matchedKey = Object.keys(images).find(key => 
                        key.toLowerCase().endsWith(`/${filename}`) || key.toLowerCase() === filename
                      );
                      if (matchedKey) {
                        url = images[matchedKey];
                      }
                    }
                  }

                  if (!url) {
                    return (
                      <div className="reader-inner" style={{ color: 'var(--danger)', border: '1px dashed var(--danger)', padding: '1rem', margin: '2rem auto', textAlign: 'center', borderRadius: '8px' }}>
                        <div>[DEBUG] Missing Image Source: {block.src}</div>
                      </div>
                    );
                  }

                  return (
                    <div className="reader-image-container reader-inner" style={{ margin: '2rem auto', textAlign: 'center' }}>
                      <img 
                        src={url} 
                        alt="Book illustration" 
                        style={{ maxWidth: '100%', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      />
                    </div>
                  );
                }
                
                const isHeading = block.tag.startsWith('h');
                const Tag = block.tag as React.ElementType;
                
                return (
                  <div className="reader-inner" style={{ paddingBottom: index === paragraphs.length - 1 ? '160px' : '0' }}>
                    <div 
                      className={`reader-block ${isActive ? 'active' : ''} ${isHeading ? 'heading' : ''}`}
                      onClick={() => handleTextTap(index)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Tag>{block.text}</Tag>
                    </div>
                  </div>
                );
              }}
            />
          </div>
        </div>

        {/* Player (Hover overlay) */}
        {audioUrl && (
          <div className="player-overlay">
            <Player 
              audioSrc={audioUrl}
              onTimeUpdate={handleTimeUpdate}
              seekToMs={seekToMs}
              bookTitle={meta.title}
              bookCover={meta.coverImage}
            />
          </div>
        )}

      </div>

      {/* Settings Sidebar Overlay */}
      {showSettings && (
        <ReaderSettings settings={settings} setSettings={setSettings} onClose={() => setShowSettings(false)} />
      )}
      
    </div>
  );
}
