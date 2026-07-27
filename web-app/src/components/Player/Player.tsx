import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Gauge } from 'lucide-react';

interface PlayerProps {
  audioSrc: string;
  onTimeUpdate?: (currentTimeMs: number) => void;
  onSeek?: (currentTimeMs: number) => void;
  seekToMs?: number | null;
  bookTitle?: string;
  bookCover?: string;
}

export default function Player({ 
  audioSrc, 
  onTimeUpdate, 
  onSeek,
  seekToMs,
  bookTitle = "ReadAlong",
  bookCover = ""
}: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  // Keep callback ref updated
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  // Handle external seek requests safely AFTER metadata is loaded
  useEffect(() => {
    if (isLoaded && seekToMs !== undefined && seekToMs !== null && audioRef.current) {
      audioRef.current.currentTime = seekToMs / 1000;
      setCurrentTime(seekToMs / 1000);
      // We do not auto-play here to respect browser autoplay policies.
      // The user can click Play to resume from the jumped position.
    }
  }, [seekToMs, isLoaded]);

  // Request Animation Frame loop for highly accurate time updates
  const loop = () => {
    if (audioRef.current && isPlaying) {
      const currentMs = Math.floor(Math.max(0, audioRef.current.currentTime * 1000));
      onTimeUpdateRef.current?.(currentMs);
      setCurrentTime(audioRef.current.currentTime);
    }
    rafRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(loop);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  // Media Session API
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: bookTitle,
        artist: 'ReadAlong',
        artwork: bookCover ? [{ src: bookCover, sizes: '512x512', type: 'image/jpeg' }] : []
      });

      navigator.mediaSession.setActionHandler('play', () => audioRef.current?.play());
      navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (audioRef.current && details.seekTime) {
          audioRef.current.currentTime = details.seekTime;
        }
      });
    }
  }, [bookTitle, bookCover]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      onSeek?.(Math.floor(newTime * 1000));
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div style={{
      position: 'fixed',
      bottom: '2rem',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'calc(100% - 4rem)',
      maxWidth: '700px',
      backgroundColor: 'var(--bg-secondary)',
      borderRadius: '24px',
      boxShadow: 'var(--card-shadow)',
      border: '1px solid var(--border-color)',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 100,
    }}>
      <audio 
        ref={audioRef}
        src={audioSrc}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          setIsLoaded(true);
        }}
        onEnded={() => setIsPlaying(false)}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1rem' }}>
        
        {/* Playback Controls (Left) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <button
            onClick={() => { if(audioRef.current) audioRef.current.currentTime -= 15; }}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}
          >
            <SkipBack size={20} />
          </button>

          <button
            onClick={togglePlay}
            style={{
              background: 'var(--accent-primary)',
              color: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)'
            }}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} style={{ marginLeft: '2px' }} />}
          </button>

          <button
            onClick={() => { if(audioRef.current) audioRef.current.currentTime += 15; }}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}
          >
            <SkipForward size={20} />
          </button>
        </div>

        {/* Center Progress Text */}
        <div style={{ flex: 1, padding: '0 2rem', textAlign: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '1px', color: 'var(--accent-primary)', textTransform: 'uppercase', marginBottom: '4px' }}>
              Active Reading
            </span>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {Math.round(progressPercent)}% COMPLETE
            </span>
            {/* Scrubber / Progress Bar */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              style={{
                width: '100%',
                height: '4px',
                borderRadius: '2px',
                appearance: 'none',
                background: `linear-gradient(to right, var(--accent-primary) ${progressPercent}%, var(--border-color) ${progressPercent}%)`,
                cursor: 'pointer',
                marginTop: '8px'
              }}
            />
          </div>
        </div>

        {/* Tools (Right) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: 'var(--text-secondary)' }}>
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex' }}>
            <Volume2 size={20} />
          </button>
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex' }}>
            <Gauge size={20} />
          </button>
        </div>

      </div>
    </div>
  );
}
