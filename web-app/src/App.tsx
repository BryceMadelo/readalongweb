import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import init from 'readalong-wasm';
import wasmUrl from 'readalong-wasm/readalong_wasm_bg.wasm?url';

import Library from './pages/Library/Library';
import Import from './pages/Import/Import';
import Reader from './pages/Reader/Reader';
import Align from './pages/Align/Align';
import { AlignmentProvider } from './context/AlignmentContext';
import { getApiToken, setApiToken } from './utils/api';

import './index.css';

function App() {
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(() => !getApiToken());
  const [tokenInput, setTokenInput] = useState('');

  useEffect(() => {
    const handleAuthError = () => {
      setShowAuthModal(true);
    };
    window.addEventListener('auth-error', handleAuthError);
    return () => window.removeEventListener('auth-error', handleAuthError);
  }, []);

  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    setApiToken(tokenInput);
    setShowAuthModal(false);
    // Optional: reload the page to restart any failed requests
    window.location.reload();
  };

  useEffect(() => {
    async function loadWasm() {
      try {
        await init({ module_or_path: wasmUrl });
        setIsWasmReady(true);
      } catch (err) {
        console.error("Failed to load WASM:", err);
        setError("Error booting Rust Core! Check console.");
      }
    }
    loadWasm();
  }, []);

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger)' }}>
        <h2>{error}</h2>
      </div>
    );
  }

  if (!isWasmReady) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
        <h2>Booting ReadAlong Core...</h2>
      </div>
    );
  }

  return (
    <AlignmentProvider>
      {showAuthModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <form onSubmit={handleSaveToken} style={{ background: 'var(--bg-secondary)', padding: '2rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '1rem', width: '300px' }}>
            <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Server Password Required</h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Please enter the API_TOKEN for your ReadAlong server.</p>
            <input
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="Server Password"
              style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              autoFocus
            />
            <button type="submit" style={{ padding: '0.5rem', borderRadius: '6px', border: 'none', background: 'var(--accent-primary)', color: 'white', cursor: 'pointer', fontWeight: 600 }}>Save & Retry</button>
          </form>
        </div>
      )}
      <BrowserRouter>
        <div className="app-container">
          <Routes>
            <Route path="/" element={<Library />} />
            <Route path="/import" element={<Import />} />
            <Route path="/reader/:id" element={<Reader />} />
            <Route path="/align/:id" element={<Align />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AlignmentProvider>
  );
}

export default App;