import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getStats } from '../../storage/db';
import { fetchWithAuth } from '../../utils/api';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function Profile() {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState({ booksRead: 0, hoursListened: 0, streak: 0 });
  const [newEmail, setNewEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadStats() {
      const s = await getStats();
      setStats(s);
    }
    loadStats();
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword && newPassword !== confirmPassword) {
      return setError('New passwords do not match');
    }

    try {
      const res = await fetchWithAuth('http://localhost:3000/api/auth/update_profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail !== user?.email ? newEmail : undefined,
          current_password: currentPassword || undefined,
          new_password: newPassword || undefined
        })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to update profile');
      }

      setMessage('Profile updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!user) return null;

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: 'var(--text-secondary)', marginBottom: '2rem', fontWeight: 500 }}>
        <ArrowLeft size={16} /> Back to Library
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-primary) 0%, #ff8a00 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '2rem', fontWeight: 'bold' }}>
            {user.email.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 style={{ margin: 0, color: 'var(--text-primary)' }}>{user.email.split('@')[0]}</h1>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--accent-primary)', fontSize: '0.9rem', fontWeight: 500 }}>⭐ Reader</p>
          </div>
        </div>
        <button onClick={logout} style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>
          Sign Out
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '12px' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              📊 Reading Stats
            </h3>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ flex: 1, background: 'var(--bg-primary)', padding: '1.5rem', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{stats.booksRead}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Books in Library</div>
              </div>
              <div style={{ flex: 1, background: 'var(--bg-primary)', padding: '1.5rem', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{stats.hoursListened}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Hours Listened</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ background: 'var(--bg-secondary)', padding: '2rem', borderRadius: '12px' }}>
          <h3 style={{ margin: '0 0 1.5rem 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            ⚙️ Account Settings
          </h3>
          
          <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {error && <div style={{ color: 'var(--danger)', padding: '0.75rem', background: 'rgba(255, 69, 58, 0.1)', borderRadius: '6px' }}>{error}</div>}
            {message && <div style={{ color: '#32d74b', padding: '0.75rem', background: 'rgba(50, 215, 75, 0.1)', borderRadius: '6px' }}>{message}</div>}
            
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Email Address</label>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </div>

            <h4 style={{ margin: '1rem 0 0 0', color: 'var(--text-primary)' }}>Security</h4>
            
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Current Password (required to change email/password)</label>
              <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>New Password</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Confirm New Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
              <button type="button" onClick={() => { setNewPassword(''); setCurrentPassword(''); setConfirmPassword(''); setNewEmail(user.email); setError(''); setMessage(''); }} style={{ padding: '0.75rem 1.5rem', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
              <button type="submit" style={{ padding: '0.75rem 1.5rem', borderRadius: '6px', border: 'none', background: 'var(--accent-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>Save Changes</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
