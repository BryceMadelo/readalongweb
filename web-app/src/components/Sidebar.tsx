import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Library as LibraryIcon, Compass, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function Sidebar() {
  const { user } = useAuth();
  const location = useLocation();

  const navItems = [
    { name: 'My Library', path: '/', icon: LibraryIcon },
    { name: 'Recent Activities', path: '/activity', icon: Clock },
  ];

  return (
    <aside style={{ width: '260px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-secondary)', padding: '1.5rem', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '3rem' }}>
        <div style={{ width: '32px', height: '32px', background: 'var(--accent-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BookOpen size={20} style={{ color: 'white' }} />
        </div>
        <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.5px' }}>ReadAlong</span>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.75rem', 
                padding: '0.75rem 1rem', 
                borderRadius: '8px', 
                backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent', 
                color: isActive ? 'white' : 'var(--text-secondary)', 
                textDecoration: 'none', 
                fontWeight: 500 
              }}
            >
              <item.icon size={20} /> {item.name}
            </Link>
          );
        })}
      </nav>

      {/* User Profile Card Pinned at Bottom */}
      <Link to="/profile" style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '1rem', marginTop: 'auto', textDecoration: 'none', color: 'inherit' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-light), var(--accent-primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
          {user?.email?.charAt(0).toUpperCase()}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{user?.email?.split('@')[0]}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Premium Member</span>
        </div>
      </Link>
    </aside>
  );
}
