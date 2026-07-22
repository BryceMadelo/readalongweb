import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Save, Download } from 'lucide-react';
import { getBookData, saveBook, type BookMeta, type ContentBlock, type SyncPoint } from '../../storage/db';

export default function Align() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<BookMeta | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | File | null>(null);
  const [syncPoints, setSyncPoints] = useState<SyncPoint[]>([]);
  const [images, setImages] = useState<Record<string, Uint8Array>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Filter out images for stamping (we only stamp text blocks)
  const textBlocks = useMemo(() => blocks.filter(b => b.tag !== 'img'), [blocks]);
  
  const [activeTextIndex, setActiveTextIndex] = useState<number>(0);
  const [audioUrl, setAudioUrl] = useState<string>('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      if (!id) return;
      try {
        const data = await getBookData(id);
        if (data.meta && data.audioBlob) {
          setMeta(data.meta);
          setBlocks(data.paragraphs);
          setAudioBlob(data.audioBlob);
          setAudioUrl(URL.createObjectURL(data.audioBlob));
          setSyncPoints(data.syncMap || []);
          setImages(data.images || {});
          
          if (data.syncMap && data.syncMap.length > 0) {
             setActiveTextIndex(data.syncMap.length);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    }
    load();
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [id]);

  const stampCurrentTime = () => {
    if (!audioRef.current || activeTextIndex >= textBlocks.length) return;
    
    const time_ms = Math.floor(audioRef.current.currentTime * 1000);
    const block = textBlocks[activeTextIndex];
    
    const newPoint = { id: block.id, time_ms };
    const existingIdx = syncPoints.findIndex(p => p.id === block.id);
    let newSyncPoints;
    
    if (existingIdx >= 0) {
        newSyncPoints = [...syncPoints];
        newSyncPoints[existingIdx] = newPoint;
    } else {
        newSyncPoints = [...syncPoints, newPoint];
    }

    newSyncPoints.sort((a, b) => a.time_ms - b.time_ms);
    setSyncPoints(newSyncPoints);
    
    // Find next unstamped block
    let nextIdx = activeTextIndex + 1;
    while (nextIdx < textBlocks.length && newSyncPoints.find(p => p.id === textBlocks[nextIdx].id)) {
        nextIdx++;
    }
    
    if (nextIdx < textBlocks.length) {
        setActiveTextIndex(nextIdx);
    }

    // Auto-scroll
    if (scrollContainerRef.current) {
        const activeElem = scrollContainerRef.current.children[nextIdx] as HTMLElement;
        if (activeElem) {
            activeElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!audioRef.current) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (audioRef.current.paused) {
          audioRef.current.play();
        } else {
          audioRef.current.pause();
        }
      } else if (e.code === 'Enter') {
        e.preventDefault();
        stampCurrentTime();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTextIndex, textBlocks]); // Re-bind on index change

  const handleSave = async () => {
    if (meta && audioBlob) {
      await saveBook(meta, blocks, audioBlob, syncPoints, images);
      alert("Sync map saved successfully!");
    }
  };

  const handleExport = () => {
    const jsonStr = JSON.stringify(syncPoints, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `sync_map_${meta?.id}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  };

  const handleSeekToPoint = (ms: number) => {
      if (audioRef.current) {
         audioRef.current.currentTime = ms / 1000;
         audioRef.current.play();
      }
  };
  
  const handleUndo = () => {
      if (syncPoints.length === 0) return;
      // Undo simply removes the point with the highest time_ms
      const sorted = [...syncPoints].sort((a, b) => a.time_ms - b.time_ms);
      const popped = sorted.pop();
      setSyncPoints(sorted);
      if (popped) {
          const idx = textBlocks.findIndex(b => b.id === popped.id);
          if (idx >= 0) setActiveTextIndex(idx);
      }
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '1rem', backgroundColor: 'var(--bg-primary)' }}>
      <header className="app-header" style={{ padding: '0.5rem', marginBottom: '1rem', borderRadius: '12px', borderBottom: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link to={`/reader/${meta?.id}`} className="btn btn-outline" style={{ padding: '0.5rem', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <ArrowLeft size={20} /> Back
            </Link>
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Alignment Studio: {meta?.title}</h2>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={handleExport} className="btn btn-secondary">
               <Download size={16} /> Export JSON
            </button>
            <button onClick={handleSave} className="btn btn-primary">
               <Save size={16} /> Save to DB
            </button>
          </div>
        </div>
      </header>

      {/* Audio Player Panel */}
      <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
         <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <audio ref={audioRef} src={audioUrl} controls style={{ width: '100%', maxWidth: '600px' }} />
            <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '1rem', color: 'var(--text-secondary)' }}>
              <span>Press <kbd style={{ padding: '0.2rem 0.4rem', background: 'var(--bg-tertiary)', borderRadius: '4px' }}>Space</kbd> to Play/Pause</span>
              <span>Press <kbd style={{ padding: '0.2rem 0.4rem', background: 'var(--bg-tertiary)', borderRadius: '4px' }}>Enter</kbd> to stamp current paragraph</span>
              <button onClick={handleUndo} className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>Undo Last Stamp</button>
            </div>
         </div>
      </div>

      {/* Transcript Panel */}
      <div 
        ref={scrollContainerRef}
        className="card" 
        style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', backgroundColor: 'var(--bg-secondary)' }}
      >
        {textBlocks.map((block, i) => {
          const syncPoint = syncPoints.find(p => p.id === block.id);
          const isStamped = !!syncPoint;
          const isActive = i === activeTextIndex;

          return (
            <div 
              key={block.id}
              onClick={() => {
                  if (syncPoint) {
                      handleSeekToPoint(syncPoint.time_ms);
                  } else {
                      setActiveTextIndex(i);
                  }
              }}
              style={{
                display: 'flex',
                gap: '1rem',
                padding: '0.75rem',
                borderLeft: isActive ? '4px solid var(--accent-primary)' : (isStamped ? '4px solid var(--success)' : '4px solid transparent'),
                backgroundColor: isActive ? 'var(--highlight-bg)' : 'transparent',
                borderRadius: '4px',
                marginBottom: '0.5rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                opacity: isStamped && !isActive ? 0.7 : 1
              }}
            >
               <div style={{ minWidth: '80px', color: 'var(--text-secondary)', fontSize: '0.875rem', fontFamily: 'monospace' }}>
                  {syncPoint ? (syncPoint.time_ms / 1000).toFixed(3) + 's' : '--:--'}
               </div>
               <div style={{ flex: 1, color: isStamped ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                  {block.text}
               </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
