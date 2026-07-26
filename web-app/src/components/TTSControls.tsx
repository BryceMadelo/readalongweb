import { useState, useEffect } from 'react';
import { Play, Pause, Settings } from 'lucide-react';

interface TTSControlsProps {
  isPlaying: boolean;
  onToggle: () => void;
  onVoiceChange: (voiceURI: string) => void;
  onRateChange: (rate: number) => void;
}

export function TTSControls({ isPlaying, onToggle, onVoiceChange, onRateChange }: TTSControlsProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [rate, setRate] = useState(1.0);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      if (available.length === 0) return;
      setVoices(available);
      if (!selectedVoice) {
        const pref = available.find(v => v.lang.startsWith('en') && v.name.includes('Google'))
                  || available.find(v => v.lang.startsWith('en'))
                  || available[0];
        setSelectedVoice(pref.voiceURI);
        onVoiceChange(pref.voiceURI);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVoiceChange = (uri: string) => {
    setSelectedVoice(uri);
    onVoiceChange(uri);
  };

  const handleRateChange = (r: number) => {
    setRate(r);
    onRateChange(r);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          onClick={onToggle}
          style={{
            background: isPlaying ? 'var(--accent-primary)' : 'transparent',
            border: isPlaying ? 'none' : '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '0.4rem 0.8rem',
            color: isPlaying ? 'white' : 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s ease'
          }}
          onMouseOver={(e) => { if (!isPlaying) e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
          onMouseOut={(e) => { if (!isPlaying) e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          <span style={{ fontSize: '0.85rem', display: window.innerWidth > 768 ? 'inline' : 'none' }}>
            {isPlaying ? 'Stop TTS' : 'Read to Me'}
          </span>
        </button>

        <button
          onClick={() => setShowSettings(!showSettings)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '0.4rem'
          }}
          title="TTS Settings"
        >
          <Settings size={18} />
        </button>
      </div>

      {showSettings && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '0.5rem',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1rem',
          boxShadow: 'var(--card-shadow)',
          width: '250px',
          zIndex: 100
        }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Voice</label>
            <select
              value={selectedVoice}
              onChange={(e) => handleVoiceChange(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
            >
              {voices.map(v => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Speed: {rate}x</label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={rate}
              onChange={(e) => handleRateChange(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
