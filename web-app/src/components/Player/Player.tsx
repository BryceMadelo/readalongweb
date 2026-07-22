import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';

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
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Handle external seek requests
  useEffect(() => {
    if (seekToMs !== undefined && seekToMs !== null && audioRef.current) {
      audioRef.current.currentTime = seekToMs / 1000;
      if (!isPlaying) {
        audioRef.current.play().catch(console.error);
      }
    }
  }, [seekToMs]);

  // Request Animation Frame loop for highly accurate time updates
  const loop = () => {
    if (audioRef.current && isPlaying) {
      const currentMs = Math.floor(Math.max(0, audioRef.current.currentTime * 1000));
      onTimeUpdate?.(currentMs);
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

  const formatTime = (time: number) => {
    if (isNaN(time)) return "00:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '2rem',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'calc(100% - 4rem)',
      maxWidth: '800px',
      backgroundColor: 'var(--bg-secondary)',
      borderRadius: '24px',
      boxShadow: 'var(--card-shadow)',
      border: '1px solid var(--border-color)',
      padding: '1rem 2rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      zIndex: 100,
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)'
    }}>
      <audio 
        ref={audioRef}
        src={audioSrc}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Scrubber */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        <span>{formatTime(currentTime)}</span>
        <input 
          type="range" 
          min={0} 
          max={duration || 100} 
          value={currentTime} 
          onChange={handleSeek}
          style={{ 
            flex: 1, 
            height: '4px', 
            borderRadius: '2px', 
            appearance: 'none',
            background: `linear-gradient(to right, var(--accent-primary) ${(currentTime / duration) * 100}%, var(--border-color) ${(currentTime / duration) * 100}%)`,
            cursor: 'pointer'
          }}
        />
        <span>{formatTime(duration)}</span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1.5rem' }}>
        <button 
          onClick={() => { if(audioRef.current) audioRef.current.currentTime -= 15; }}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <SkipBack size={24} />
        </button>
        
        <button 
          onClick={togglePlay}
          style={{ 
            background: 'var(--accent-primary)', 
            color: 'white', 
            border: 'none', 
            borderRadius: '50%', 
            width: '48px', 
            height: '48px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)'
          }}
        >
          {isPlaying ? <Pause size={24} /> : <Play size={24} style={{ marginLeft: '4px' }} />}
        </button>
        
        <button 
          onClick={() => { if(audioRef.current) audioRef.current.currentTime += 15; }}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <SkipForward size={24} />
        </button>
      </div>
    </div>
  );
}
