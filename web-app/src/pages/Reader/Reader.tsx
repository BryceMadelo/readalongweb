import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { PlaybackSync } from 'readalong-wasm';
import { ArrowLeft, Settings2 } from 'lucide-react';
import { getBookData, type BookMeta, type ContentBlock } from '../../storage/db';
import Player from '../../components/Player/Player';


export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<BookMeta | null>(null);
  const [paragraphs, setParagraphs] = useState<ContentBlock[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [images, setImages] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  
  const [activeParagraphIndex, setActiveParagraphIndex] = useState<number | null>(null);
  const [seekToMs, setSeekToMs] = useState<number | null>(null);

  const syncEngineRef = useRef<PlaybackSync | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  
  // To map ID -> index for fast scrolling
  const idToIndexMap = useRef<Map<string, number>>(new Map());
  // To map Index -> ID for clicking to seek (Text -> Audio)
  const paragraphIdMap = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    async function loadBook() {
      if (!id) return;
      try {
        const data = await getBookData(id);
        if (data.meta) {
          setMeta(data.meta);
          setParagraphs(data.paragraphs);
          
          if (data.audioBlob) {
            setAudioUrl(URL.createObjectURL(data.audioBlob));
          }
          
          if (data.images) {
            const imageUrls: Record<string, string> = {};
            for (const [path, uint8] of Object.entries(data.images)) {
              const blob = new Blob([new Uint8Array(uint8)]);
              imageUrls[path] = URL.createObjectURL(blob);
            }
            setImages(imageUrls);
          }

          // Rebuild Sync Engine
          if (data.syncMap && data.syncMap.length > 0) {
            const engine = new PlaybackSync();
            data.syncMap.forEach((point, idx) => {
              engine.add_sync_point(point.id, point.time_ms);
              // For a real EPUB, paragraph_ids should match the HTML IDs. 
              const mappedId = point.id;
              idToIndexMap.current.set(mappedId, idx);
              paragraphIdMap.current.set(idx, mappedId);
            });
            engine.build_engine();
            syncEngineRef.current = engine;
          }
        }
      } catch (e) {
        console.error("Failed to load book:", e);
      } finally {
        setIsLoading(false);
      }
    }
    loadBook();
    
    return () => {
      // Cleanup object URLs
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      Object.values(images).forEach(url => URL.revokeObjectURL(url));
    };
  }, [id]);

  const handleTimeUpdate = (currentTimeMs: number) => {
    if (syncEngineRef.current) {
      const activeId = syncEngineRef.current.get_active_paragraph(currentTimeMs);
      if (activeId) {
        const index = idToIndexMap.current.get(activeId);
        if (index !== undefined && index !== activeParagraphIndex) {
          setActiveParagraphIndex(index);
          
          // Auto-scroll logic: keep the active paragraph roughly in the center
          virtuosoRef.current?.scrollToIndex({
            index,
            align: 'center',
            behavior: 'smooth'
          });
        }
      }
    }
  };



  // We need the raw sync points for Text -> Audio seek. Let's fetch them.
  const [syncPoints, setSyncPoints] = useState<{id: string, time_ms: number}[]>([]);
  
  useEffect(() => {
    if (id) {
      getBookData(id).then(data => setSyncPoints(data.syncMap));
    }
  }, [id]);

  const handleTextTap = (index: number) => {
    // We assume sequential mapping for this spike, e.g. index -> point.
    // A robust parser would align paragraph HTML IDs with sync points.
    if (syncPoints[index]) {
      setSeekToMs(syncPoints[index].time_ms);
      setActiveParagraphIndex(index);
    }
  };

  if (isLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  }

  if (!meta) {
    return <div>Book not found.</div>;
  }

  return (
    <div style={{ paddingBottom: '160px' }}> {/* Space for player */}
      <header className="app-header">
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/" style={{ color: 'var(--text-secondary)', textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={24} />
          </Link>
          <h2 style={{ margin: 0, fontSize: '1.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
            {meta.title}
          </h2>
          <Link to={`/align/${meta.id}`} className="btn btn-outline" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
            <Settings2 size={16} />
            <span style={{ fontSize: '0.875rem' }}>Align</span>
          </Link>
        </div>
      </header>

      <div className="container" style={{ paddingTop: '2rem', height: 'calc(100vh - 80px - 160px)' }}>
        <Virtuoso
          ref={virtuosoRef}
          data={paragraphs}
          style={{ height: '100%' }}
          itemContent={(index, block) => {
            const isActive = index === activeParagraphIndex;
            
            if (block.tag === 'img' && block.src) {
              let url = block.src.startsWith('data:') ? block.src : images[block.src];
              
              // Case-insensitive fallback
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
                   <div style={{ color: 'var(--danger)', border: '1px dashed var(--danger)', padding: '1rem', margin: '2rem 0', textAlign: 'center', borderRadius: '8px' }}>
                     <div>[DEBUG] Missing Image Source: {block.src}</div>
                     <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: '#666' }}>
                       Available images in state: {Object.keys(images).length > 0 ? Object.keys(images).join(', ') : 'NONE'}
                     </div>
                   </div>
                 );
              }

              return (
                <div className="reader-image-container" style={{ margin: '2rem 0', textAlign: 'center' }}>
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
              <div 
                className={`reader-block ${isActive ? 'active' : ''} ${isHeading ? 'heading' : ''}`}
                onClick={() => handleTextTap(index)}
                style={{ cursor: 'pointer' }}
              >
                <Tag>{block.text}</Tag>
              </div>
            );
          }}
        />
      </div>

      {audioUrl && (
        <Player 
          audioSrc={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          seekToMs={seekToMs}
          bookTitle={meta.title}
          bookCover={meta.coverImage}
        />
      )}
    </div>
  );
}
