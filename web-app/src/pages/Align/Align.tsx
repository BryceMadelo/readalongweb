import { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Save, Download } from 'lucide-react';
import { PlaybackSync } from 'readalong-wasm';
import { getBookData, saveBook, type BookMeta, type ContentBlock, type SyncPoint } from '../../storage/db';

export default function Align() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<BookMeta | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | File | null>(null);
  const [syncPoints, setSyncPoints] = useState<SyncPoint[]>([]);
  const [images, setImages] = useState<Record<string, Uint8Array>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showOnlyLowConfidence, setShowOnlyLowConfidence] = useState(true);

  // Filter out images for stamping (we only stamp text blocks)
  const textBlocks = useMemo(() => blocks.filter(b => b.tag !== 'img'), [blocks]);
  
  const filteredTextBlocks = useMemo(() => {
      if (!showOnlyLowConfidence) return textBlocks;
      return textBlocks.filter(b => {
          const sp = syncPoints.find(p => p.paragraph_id === b.id);
          return !sp || sp.confidence === null || sp.confidence === undefined || sp.confidence < 0.6;
      });
  }, [textBlocks, showOnlyLowConfidence, syncPoints]);

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
    if (!audioRef.current || activeTextIndex >= filteredTextBlocks.length) return;
    
    const timestamp_ms = Math.floor(audioRef.current.currentTime * 1000);
    const block = filteredTextBlocks[activeTextIndex];
    
    const newPoint = { paragraph_id: block.id, timestamp_ms, confidence: 1.0 };
    const existingIdx = syncPoints.findIndex(p => p.paragraph_id === block.id);
    let newSyncPoints: SyncPoint[];
    
    if (existingIdx >= 0) {
        newSyncPoints = [...syncPoints];
        newSyncPoints[existingIdx] = newPoint;
    } else {
        newSyncPoints = [...syncPoints, newPoint];
    }

    newSyncPoints.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
    setSyncPoints(newSyncPoints);
    
    // Advance logic for full view:
    // If showOnlyLowConfidence is false, we want to advance to the next unstamped block, OR if all remaining are stamped, just advance by 1.
    // If showOnlyLowConfidence is true, the current block will disappear on the next render. So the next block will naturally slide into the current index.

    let nextIdx = activeTextIndex;

    if (!showOnlyLowConfidence) {
        // Normal mode: skip already stamped blocks, but if we're just overriding everything sequentially, we should at least advance by 1
        nextIdx++;
        // If you strictly want to skip ALL stamped blocks (like a first-pass stamping):
        // while (nextIdx < filteredTextBlocks.length && newSyncPoints.find(p => p.paragraph_id === filteredTextBlocks[nextIdx].id)) {
        //     nextIdx++;
        // }
    } else {
        // In Low Confidence mode, `nextIdx` stays the same because the item will be removed from `filteredTextBlocks`.
        // However, if it's the very last item in the list, we don't want to advance out of bounds on the next render.
        // We'll let `useEffect` or render logic handle bounds.
    }

    if (nextIdx < filteredTextBlocks.length) {
        setActiveTextIndex(nextIdx);
    } else if (nextIdx >= filteredTextBlocks.length && filteredTextBlocks.length > 0) {
        // Clamp to end
        setActiveTextIndex(filteredTextBlocks.length - 1);
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
  }, [activeTextIndex, filteredTextBlocks]); // Re-bind on index change

  const handleSave = async () => {
    if (meta && audioBlob) {
      // Validate with WASM SyncEngine before saving
      const sorted = [...syncPoints].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
      try {
          const engine = new PlaybackSync();
          // Provide points in chronological order to `add_sync_point`
          for (const p of sorted) {
              engine.add_sync_point(p.paragraph_id, p.timestamp_ms, p.confidence ?? undefined);
          }
          engine.build_engine(); // This will test instantiation and any core panics
      } catch (e) {
          alert("Validation failed: Sync map timestamps must be monotonically increasing. " + e);
          return;
      }

      try {
          // Push to backend server
          const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
          const response = await fetch(`${API_URL}/sync_map/${meta.id}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sorted)
          });

          if (!response.ok) {
              throw new Error(`Server returned ${response.status}: ${await response.text()}`);
          }
      } catch (err) {
          console.error("Failed to sync map to server:", err);
          alert("Failed to sync with the backend server, but saving locally.");
      }

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

      // When undoing, if we are in low-confidence mode, the previously "fixed" point will reappear
      // in our `filteredTextBlocks` list on the *next* render because it's no longer in `syncPoints`.
      // The easiest way to handle this is to pop it from syncPoints, and let the `activeTextIndex`
      // naturally point to it if it reappears in the list.
      const sorted = [...syncPoints].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
      const popped = sorted.pop();
      setSyncPoints(sorted);

      if (popped) {
          // If we are showing all blocks, we find its index in the full list
          if (!showOnlyLowConfidence) {
              const idx = textBlocks.findIndex(b => b.id === popped.paragraph_id);
              if (idx >= 0) setActiveTextIndex(idx);
          } else {
              // In low confidence mode, it will re-enter the array.
              // Without predicting where it re-enters, resetting to 0 is safest,
              // or searching for it on the next render via an effect.
              // For a simple fix, resetting to top of the low-confidence list is safe.
              setActiveTextIndex(0);
          }
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
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Fix sync issues: {meta?.title}</h2>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                <input
                    type="checkbox"
                    checked={showOnlyLowConfidence}
                    onChange={(e) => {
                        setShowOnlyLowConfidence(e.target.checked);
                        setActiveTextIndex(0); // Reset index on filter change
                    }}
                />
                Show Low Confidence Only
            </label>
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
        {filteredTextBlocks.map((block, i) => {
          const syncPoint = syncPoints.find(p => p.paragraph_id === block.id);
          const isStamped = !!syncPoint;
          const isActive = i === activeTextIndex;

          return (
            <div 
              key={block.id}
              onClick={() => {
                  if (syncPoint) {
                      handleSeekToPoint(syncPoint.timestamp_ms);
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
                  {syncPoint ? (syncPoint.timestamp_ms / 1000).toFixed(3) + 's' : '--:--'}
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
