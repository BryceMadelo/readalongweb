import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import init from 'readalong-wasm';
import wasmUrl from 'readalong-wasm/readalong_wasm_bg.wasm?url';

import Library from './pages/Library/Library';
import Import from './pages/Import/Import';
import Reader from './pages/Reader/Reader';
import Align from './pages/Align/Align';

import './index.css';

function App() {
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  );
}

export default App;