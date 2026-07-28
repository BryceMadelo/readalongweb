import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Login failed');
      }
      const data = await res.json();
      login(data.token, data.user);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Left side hero */}
      <div style={{ 
        flex: 1, 
        background: 'linear-gradient(180deg, rgba(88,86,214,0.3) 0%, rgba(88,86,214,0.8) 100%), url(https://images.unsplash.com/photo-1507842217343-583bb7270b66?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        padding: '3rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        color: 'white'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 'auto' }}>
          <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>📖 ReadAlong</span>
        </div>
        <h1 style={{ fontSize: '3rem', marginBottom: '1rem', fontWeight: 600 }}>Digital Serenity.</h1>
        <p style={{ fontSize: '1.2rem', opacity: 0.9, maxWidth: '400px', lineHeight: 1.5 }}>
          Immerse yourself in a world where reading and listening blend seamlessly.
        </p>
      </div>

      {/* Right side form */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Welcome Back</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Enter your details to continue your journey.</p>

          <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: '8px', padding: '4px', marginBottom: '2rem' }}>
            <Link to="/login" style={{ flex: 1, textAlign: 'center', padding: '0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', color: 'var(--accent-primary)', fontWeight: 500, textDecoration: 'none' }}>Login</Link>
            <Link to="/signup" style={{ flex: 1, textAlign: 'center', padding: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, textDecoration: 'none' }}>Sign Up</Link>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {error && <div style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{error}</div>}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>Email</label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@example.com"
                style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>Password</label>
                <a href="#" style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', textDecoration: 'none' }}>Forgot?</a>
              </div>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              />
            </div>

            <button type="submit" style={{ padding: '0.85rem', borderRadius: '8px', border: 'none', background: 'var(--accent-primary)', color: 'white', fontWeight: 600, fontSize: '1rem', cursor: 'pointer', marginTop: '1rem' }}>
              Sign In →
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
