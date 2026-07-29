import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import init from 'readalong-wasm';
import wasmUrl from 'readalong-wasm/readalong_wasm_bg.wasm?url';

import Library from './pages/Library/Library';
import Import from './pages/Import/Import';
import Reader from './pages/Reader/Reader';
import Align from './pages/Align/Align';
import Login from './pages/Login/Login';
import Signup from './pages/Signup/Signup';
import Profile from './pages/Profile/Profile';
import RecentActivities from './pages/RecentActivities/RecentActivities';
import { AlignmentProvider } from './context/AlignmentContext';
import { AuthProvider, useAuth } from './context/AuthContext';

import './index.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

function AppRoutes() {
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
    <AlignmentProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        
        <Route path="/" element={<ProtectedRoute><Library /></ProtectedRoute>} />
        <Route path="/activity" element={<ProtectedRoute><RecentActivities /></ProtectedRoute>} />
        <Route path="/import" element={<ProtectedRoute><Import /></ProtectedRoute>} />
        <Route path="/reader/:id" element={<ProtectedRoute><Reader /></ProtectedRoute>} />
        <Route path="/align/:id" element={<ProtectedRoute><Align /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      </Routes>
    </AlignmentProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app-container">
          <AppRoutes />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;