import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { PlaybackSync } from 'readalong-wasm';
import { Settings2, Menu } from 'lucide-react';
import { getBookData, updateBookProgress, type BookMeta, type ContentBlock, type SyncPoint } from '../../storage/db';
import Player from '../../components/Player/Player';
import { useAlignment } from '../../context/AlignmentContext';
import { ReaderSettings } from './ReaderSettings';
import { type ReaderSettingsState, defaultSettings } from './types';
import { ReaderTOC } from './ReaderTOC';
import { TTSControls } from '../../components/TTSControls';
import { fetchWithAuth } from '../../utils/api';

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const { getJob } = useAlignment();
  const [meta, setMeta] = useState<BookMeta | null>(null);
  const [paragraphs, setParagraphs] = useState<ContentBlock[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [images, setImages] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isScrollReady, setIsScrollReady] = useState(false);
  
  const isPlayingRef = useRef(false);
  
  const [activeParagraphIndex, setActiveParagraphIndex] = useState<number | null>(null);
  const [initialScrollIndex, setInitialScrollIndex] = useState(0);
  const [seekToMs, setSeekToMs] = useState<number | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [ttsWordRange, setTtsWordRange] = useState<{ start: number, length: number } | null>(null);
  const [ttsActive, setTtsActive] = useState(false);
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsRate, setTtsRate] = useState(1.0);
  // Session ref: cancelled flag + snapshot of runtime config to avoid stale closures
  const ttsSessionRef = useRef<{ cancelled: boolean; voice: string; rate: number } | null>(null);
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

  // Auto-save reading position (paragraph index) whenever it changes
  useEffect(() => {
    if (id && activeParagraphIndex !== null && activeParagraphIndex > 0) {
      localStorage.setItem(`tts_progress_${id}`, activeParagraphIndex.toString());
    }
  }, [id, activeParagraphIndex]);

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
          let loadedMeta = data.meta;
          // Fetch remote progress
          const API_URL = import.meta.env.VITE_API_URL || '/api';
          try {
            const res = await fetchWithAuth(`${API_URL}/progress/${id}`);
            if (res.ok) {
              const progressData = await res.json();
              if (progressData.progress_ms != null && progressData.progress_ms > 0) {
                loadedMeta = { ...data.meta, progress: progressData.progress_ms };
              }
            }
          } catch (e) {
            console.error("Failed to fetch remote progress", e);
          }

          setMeta(loadedMeta);
          setParagraphs(data.paragraphs);
          
          if (data.hasAudio) {
            import('../../utils/api').then(({ getApiToken }) => {
              const token = getApiToken();
              setAudioUrl(`${API_URL}/books/${id}/audio?token=${token}`);
            });
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

          // Determine the correct starting paragraph index
          let startingIdx = 0;

          // 1. PRIMARY: Try audio progress via sync engine (source of truth for audiobooks)
          if (loadedMeta.progress > 0 && syncEngineRef.current) {
            const pId = syncEngineRef.current.get_active_paragraph(loadedMeta.progress);
            if (pId) {
              const idx = idToIndexMap.current.get(pId);
              if (idx !== undefined) {
                startingIdx = idx;
              }
            }
          }

          // 2. FALLBACK: Restore from localStorage (paragraph index — always saved on scroll)
          let savedIdx: string | null = null;
          if (startingIdx === 0) {
            savedIdx = localStorage.getItem(`tts_progress_${id}`);
            if (savedIdx !== null) {
              const idx = parseInt(savedIdx, 10);
              if (!isNaN(idx) && idx > 0 && idx < data.paragraphs.length) {
                startingIdx = idx;
              }
            }
          }

          // 3. FALLBACK: For text-only books, use raw progress as paragraph index
          if (startingIdx === 0 && !data.hasAudio && loadedMeta.progress > 0) {
            startingIdx = Math.floor(loadedMeta.progress);
          }

          console.log('[Reader] Restoring scroll position to paragraph', startingIdx, '(localStorage:', savedIdx, ', dbProgress:', loadedMeta.progress, ')');

          if (startingIdx > 0 && startingIdx < data.paragraphs.length) {
            setActiveParagraphIndex(startingIdx);
            setInitialScrollIndex(startingIdx);
            
            // Map the scrolled paragraph back to an audio timestamp so the Player starts correctly
            if (data.syncMap && data.syncMap.length > 0) {
              let targetMs: number | undefined;
              
              // FIRST: Check if the exact database progress matches our current scroll paragraph.
              // If it does, use the database progress so we don't lose the exact sub-paragraph position!
              if (loadedMeta.progress > 0 && syncEngineRef.current) {
                const pId = syncEngineRef.current.get_active_paragraph(loadedMeta.progress);
                if (pId) {
                  const pIdx = idToIndexMap.current.get(pId);
                  if (pIdx === startingIdx) {
                    targetMs = loadedMeta.progress;
                    console.log('[Reader] Preserving exact dbProgress because it matches scroll paragraph:', targetMs);
                  }
                }
              }

              // IF IT DOESN'T MATCH (e.g. user manually scrolled away before closing), 
              // snap to the beginning of the newly scrolled paragraph!
              if (targetMs === undefined) {
                for (let i = startingIdx; i >= 0; i--) {
                  const pId = data.paragraphs[i].id;
                  const point = data.syncMap.find(p => p.paragraph_id === pId);
                  if (point && point.timestamp_ms !== undefined) {
                    targetMs = point.timestamp_ms;
                    console.log('[Reader] Snapping audio to paragraph start:', targetMs);
                    break;
                  }
                }
              }

              if (targetMs !== undefined) {
                setSeekToMs(targetMs);
                latestTimeRef.current = targetMs;
                initializedTimeRef.current = true; // prevent the other useEffect from overwriting it
              }
            }
            
            // Force Virtuoso to actually scroll to this item, because initialTopMostItemIndex is notoriously buggy with dynamic heights
            setTimeout(() => {
              if (virtuosoRef.current) {
                virtuosoRef.current.scrollToIndex({ index: startingIdx, align: 'start' });
              }
            }, 150);
          }
          // Signal that we've determined the starting index — Virtuoso can now mount
          setIsScrollReady(true);
        }
      } catch (e) {
        console.error("Failed to load book:", e);
        setIsScrollReady(true); // still allow mount even on error
      } finally {
        setIsLoading(false);
      }
    }
    loadBook();
    
    return () => {
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
      // Cancel any active TTS on unmount
      if (ttsSessionRef.current) ttsSessionRef.current.cancelled = true;
      window.speechSynthesis.cancel();
      // Save audio time progress on unmount (only if audio was actually playing)
      if (id && latestTimeRef.current > 0) {
        updateBookProgress(id, latestTimeRef.current).catch(console.error);
      }
      // Note: paragraph index is already saved to localStorage via rangeChanged
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    return () => {
      if (id && latestTimeRef.current > 0) {
        updateBookProgress(id, latestTimeRef.current).catch(console.error);
        const API_URL = import.meta.env.VITE_API_URL || '/api';
        fetchWithAuth(`${API_URL}/progress/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ progress_ms: Math.floor(latestTimeRef.current) }),
          keepalive: true
        }).catch(console.error);
      }
    };
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
    const job = id ? getJob(id) : null;
    if (id && job?.status === 'processing') {
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
  }, [id, getJob(id ?? '')?.status]);

  const handleTimeUpdate = (currentTimeMs: number) => {
    latestTimeRef.current = currentTimeMs;
    // Throttle save progress to DB (e.g., every 5 seconds)
    const now = Date.now();
    if (id && now - lastProgressSaveRef.current > 5000) {
      updateBookProgress(id, currentTimeMs).catch(console.error);
      lastProgressSaveRef.current = now;

      const API_URL = import.meta.env.VITE_API_URL || '/api';
      fetchWithAuth(`${API_URL}/progress/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress_ms: Math.floor(currentTimeMs) })
      }).catch(console.error);
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
      if (point && point.timestamp_ms !== undefined) {
        setSeekToMs(point.timestamp_ms);
        latestTimeRef.current = point.timestamp_ms;
        setActiveParagraphIndex(index);
      }
    }
    // If TTS is active, jump to tapped paragraph
    if (ttsSessionRef.current && !ttsSessionRef.current.cancelled) {
      window.speechSynthesis.cancel();
      startTTSFrom(index, ttsSessionRef.current.voice, ttsSessionRef.current.rate);
    }
  };

  const handleTOCSelect = (index: number) => {
    virtuosoRef.current?.scrollToIndex({ index, align: 'start', behavior: 'smooth' });
    handleTextTap(index);
    setShowTOC(false); // Auto close TOC on select
  };

  // ─── TTS Engine ──────────────────────────────────────────────────────────────
  // Speak from a given paragraph index, advancing automatically through the book.
  // Uses a session object to avoid stale-closure issues with React state.
  function startTTSFrom(fromIndex: number, voiceURI: string, rate: number) {
    // Cancel any existing session
    if (ttsSessionRef.current) ttsSessionRef.current.cancelled = true;
    window.speechSynthesis.cancel();

    const session = { cancelled: false, voice: voiceURI, rate };
    ttsSessionRef.current = session;
    setTtsActive(true);

    function speakIndex(index: number) {
      if (session.cancelled || index >= paragraphs.length) {
        if (!session.cancelled) {
          setTtsActive(false);
          setTtsWordRange(null);
          ttsSessionRef.current = null;
        }
        return;
      }

      const block = paragraphs[index];

      // Skip images and empty/heading blocks silently
      if (block.tag === 'img' || !block.text?.trim()) {
        speakIndex(index + 1);
        return;
      }

      // Update visible highlight and scroll
      setActiveParagraphIndex(index);
      virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'smooth' });
      setTtsWordRange(null);

      const utterance = new SpeechSynthesisUtterance(block.text);

      if (session.voice) {
        const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === session.voice);
        if (voice) utterance.voice = voice;
      }
      utterance.rate = session.rate;

      utterance.onboundary = (e) => {
        if (e.name === 'word' && !session.cancelled) {
          setTtsWordRange({ start: e.charIndex, length: e.charLength ?? 5 });
        }
      };

      utterance.onend = () => {
        if (!session.cancelled) {
          setTtsWordRange(null);
          speakIndex(index + 1);
        }
      };

      utterance.onerror = (e) => {
        // 'canceled'/'interrupted' are intentional stops — don't advance
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        console.error('TTS error on paragraph', index, e.error);
        if (!session.cancelled) speakIndex(index + 1);
      };

      window.speechSynthesis.speak(utterance);
    }

    speakIndex(fromIndex);
  }

  function handleTTSToggle() {
    if (ttsActive) {
      // Stop
      if (ttsSessionRef.current) ttsSessionRef.current.cancelled = true;
      window.speechSynthesis.cancel();
      setTtsActive(false);
      setTtsWordRange(null);
      ttsSessionRef.current = null;
    } else {
      // Find a reasonable start paragraph
      // Priority: currently active paragraph > first non-empty text paragraph
      let startIndex = activeParagraphIndex ?? 0;
      if (paragraphs[startIndex]?.tag === 'img' || !paragraphs[startIndex]?.text?.trim()) {
        startIndex = paragraphs.findIndex(b => b.tag !== 'img' && !!b.text?.trim());
        if (startIndex < 0) return; // no text in book
      }
      startTTSFrom(startIndex, ttsVoice, ttsRate);
    }
  }

  const currentChapterText = useMemo(() => {
    if (activeParagraphIndex === null) return '';
    const headings = paragraphs
      .map((block, index) => ({ ...block, index }))
      .filter(block => block.tag.startsWith('h'));
    
    for (let i = headings.length - 1; i >= 0; i--) {
      if (headings[i].index <= activeParagraphIndex) {
        return headings[i].text;
      }
    }
    return '';
  }, [paragraphs, activeParagraphIndex]);

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  if (!meta) return <div>Book not found.</div>;

  const bookJob = id ? getJob(id) : null;
  const isAligningThis = !!bookJob && (bookJob.status === 'processing' || bookJob.status === 'paused');
  const pMin = bookJob?.progressMin || 0;
  const tMin = bookJob?.totalMin || 0;
  const pDisplay = Math.floor(pMin);
  const tDisplay = Math.floor(tMin);

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
      '--reader-guide-color': settings.guideColor,
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
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.5rem', backgroundColor: 'var(--glass-bg)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border-color)', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: 0 }}>
            <button onClick={() => setShowTOC(!showTOC)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <Menu size={24} />
            </button>
            <Link to="/" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 'bold', fontSize: '1.25rem', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              ReadAlong
            </Link>
            <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 0.5rem', flexShrink: 0 }} />
            <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.9rem', color: 'var(--text-secondary)', overflow: 'hidden', minWidth: 0, flex: 1 }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.title}</span>
              {currentChapterText && (
                <>
                  <span style={{ margin: '0 0.5rem', flexShrink: 0 }}>/</span>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentChapterText}</span>
                </>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <TTSControls
              isPlaying={ttsActive}
              onToggle={handleTTSToggle}
              onVoiceChange={(uri) => setTtsVoice(uri)}
              onRateChange={(r) => setTtsRate(r)}
            />

            <button onClick={() => setShowSettings(!showSettings)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Settings2 size={20} />
            </button>

            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-light), var(--accent-primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', fontSize: '0.85rem' }}>
              A
            </div>
          </div>
        </header>

        {/* Alignment Progress Bar (Sticky Top) */}
        {isAligningThis && (
          <div style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '1px solid var(--border-color)' }}>
             <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-primary)', minWidth: '100px' }}>
               {bookJob?.status === 'paused' ? 'Paused' : 'Aligning...'}
             </div>
             <div style={{ flex: 1, height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
               <div style={{ height: '100%', background: 'var(--accent-primary)', width: `${tMin > 0 ? (pMin / tMin) * 100 : 0}%`, transition: 'width 0.3s ease' }} />
             </div>
             <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{pDisplay}m / {tDisplay}m</div>
          </div>
        )}

        {/* Reader Scroller */}
        <div style={{ flex: 1, padding: '2rem 1rem 0 1rem', overflow: 'hidden' }}>
          <div style={getReaderStyles()}>
            {paragraphs.length > 0 && isScrollReady ? (
              <Virtuoso
              ref={virtuosoRef}
              data={paragraphs}
              style={{ height: '100%' }}
              initialTopMostItemIndex={initialScrollIndex}
              rangeChanged={(range) => {
                if (id && range.startIndex > 0 && paragraphs.length > 0) {
                  // Only update localStorage from scrolling if the active paragraph is NO LONGER on screen!
                  // If they are still looking at the active paragraph, don't let the topmost paragraph (startIndex) 
                  // falsely drag their saved position backwards.
                  const isVisible = activeParagraphIndex !== null && 
                                   activeParagraphIndex >= range.startIndex && 
                                   activeParagraphIndex <= range.endIndex;
                  
                  if (!isVisible && !isPlayingRef.current) {
                    localStorage.setItem(`tts_progress_${id}`, range.startIndex.toString());
                  }
                  
                  // Keep global time progress in sync with manual scrolling ONLY for text-only books
                  // If there is audio, latestTimeRef MUST strictly track the audio player's time.
                  if (!audioUrl && syncPoints.length === 0) {
                    latestTimeRef.current = range.startIndex;
                  }
                }
              }}
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
                
                const renderText = () => {
                  if (isActive && ttsWordRange && !isHeading) {
                    const before = block.text.substring(0, ttsWordRange.start);
                    const word = block.text.substring(ttsWordRange.start, ttsWordRange.start + ttsWordRange.length);
                    const after = block.text.substring(ttsWordRange.start + ttsWordRange.length);

                    return (
                      <>
                        {before}
                        <span style={{ backgroundColor: 'var(--accent-primary)', color: 'white', borderRadius: '4px', padding: '0 2px' }}>{word}</span>
                        {after}
                      </>
                    );
                  }
                  return block.text;
                };

                return (
                  <div className="reader-inner" style={{ paddingBottom: index === paragraphs.length - 1 ? '160px' : '0' }}>
                    <div 
                      className={`reader-block ${isActive ? 'active' : ''} ${isHeading ? 'heading' : ''}`}
                      onClick={() => handleTextTap(index)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Tag>{renderText()}</Tag>
                    </div>
                  </div>
                );
              }}
            />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                Loading book content...
              </div>
            )}
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
              onPlay={() => isPlayingRef.current = true}
              onPause={() => isPlayingRef.current = false}
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
