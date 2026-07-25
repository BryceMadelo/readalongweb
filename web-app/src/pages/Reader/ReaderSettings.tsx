import React from 'react';

export interface ReaderSettingsState {
  appearance: 'light' | 'sepia' | 'dark';
  typography: 'serif' | 'sans';
  textSize: 'small' | 'medium' | 'large';
  textHeight: 'small' | 'medium' | 'large';
  alignment: 'left' | 'center' | 'justify';
  pageMargins: 'narrow' | 'medium' | 'wide';
}

export const defaultSettings: ReaderSettingsState = {
  appearance: 'light',
  typography: 'sans',
  textSize: 'medium',
  textHeight: 'medium',
  alignment: 'left',
  pageMargins: 'medium',
};

interface ReaderSettingsProps {
  settings: ReaderSettingsState;
  setSettings: React.Dispatch<React.SetStateAction<ReaderSettingsState>>;
  onClose: () => void;
}

export function ReaderSettings({ settings, setSettings, onClose }: ReaderSettingsProps) {
  const update = (key: keyof ReaderSettingsState, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '320px', backgroundColor: 'var(--bg-primary)', borderLeft: '1px solid var(--border-color)', zIndex: 100, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 15px rgba(0,0,0,0.05)' }}>
      <div style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
        <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Reader Settings</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-primary)' }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        
        {/* Appearance */}
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Appearance</div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            {['light', 'sepia', 'dark'].map(opt => (
              <div key={opt} style={{ flex: 1, textAlign: 'center' }}>
                <button 
                  onClick={() => update('appearance', opt)}
                  style={{ 
                    width: '100%', 
                    aspectRatio: '16/10', 
                    borderRadius: '8px', 
                    cursor: 'pointer',
                    border: settings.appearance === opt ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                    backgroundColor: opt === 'light' ? '#ffffff' : opt === 'sepia' ? '#f4ecd8' : '#1a1a1a'
                  }} 
                />
                <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', textTransform: 'capitalize' }}>{opt}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Typography */}
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Typography</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {['serif', 'sans'].map(opt => (
              <button 
                key={opt}
                onClick={() => update('typography', opt)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: 'none',
                  backgroundColor: settings.typography === opt ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: settings.typography === opt ? 'white' : 'var(--text-primary)',
                  fontFamily: opt === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif',
                  textTransform: 'capitalize',
                  fontWeight: 500
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Text Size */}
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Text Size</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {['small', 'medium', 'large'].map(opt => (
              <button 
                key={opt}
                onClick={() => update('textSize', opt)}
                style={{
                  flex: 1, padding: '0.75rem', borderRadius: '8px', cursor: 'pointer', border: 'none',
                  backgroundColor: settings.textSize === opt ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: settings.textSize === opt ? 'white' : 'var(--text-primary)',
                  fontSize: opt === 'small' ? '0.9rem' : opt === 'medium' ? '1.1rem' : '1.3rem',
                  fontWeight: 600
                }}
              >
                A
              </button>
            ))}
          </div>
        </div>

        {/* Alignment */}
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Alignment</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {['left', 'center', 'justify'].map(opt => (
              <button 
                key={opt}
                onClick={() => update('alignment', opt)}
                style={{
                  flex: 1, padding: '0.75rem', borderRadius: '8px', cursor: 'pointer', border: 'none',
                  backgroundColor: settings.alignment === opt ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: settings.alignment === opt ? 'white' : 'var(--text-primary)',
                  display: 'flex', justifyContent: 'center'
                }}
              >
                {/* Simple icon representation */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '20px', alignItems: opt === 'left' ? 'flex-start' : opt === 'center' ? 'center' : 'stretch' }}>
                  <div style={{ height: '2px', background: 'currentColor', width: '100%' }}></div>
                  <div style={{ height: '2px', background: 'currentColor', width: '80%' }}></div>
                  <div style={{ height: '2px', background: 'currentColor', width: '100%' }}></div>
                  <div style={{ height: '2px', background: 'currentColor', width: '60%' }}></div>
                </div>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
