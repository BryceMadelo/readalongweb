import { useEffect, useState } from 'react';
import { Sidebar } from '../../components/Sidebar';
import { getHistory, type HistoryActivity } from '../../storage/db';
import { BookOpen, UploadCloud, Settings, Clock, Activity, Settings2, FileAudio } from 'lucide-react';

export default function RecentActivities() {
  const [history, setHistory] = useState<HistoryActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      const h = await getHistory();
      setHistory(h.sort((a, b) => b.timestamp - a.timestamp));
      setIsLoading(false);
    }
    loadHistory();
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const groups = {
    'Today': history.filter(h => h.timestamp >= today.getTime()),
    'Yesterday': history.filter(h => h.timestamp >= yesterday.getTime() && h.timestamp < today.getTime()),
    'Last Week': history.filter(h => h.timestamp >= lastWeek.getTime() && h.timestamp < yesterday.getTime()),
    'Older': history.filter(h => h.timestamp < lastWeek.getTime())
  };

  const getIconForType = (type: string) => {
    switch(type) {
      case 'import': return <UploadCloud size={20} style={{ color: '#3B82F6' }} />;
      case 'read': return <BookOpen size={20} style={{ color: '#10B981' }} />;
      case 'align': return <FileAudio size={20} style={{ color: '#8B5CF6' }} />;
      case 'settings': return <Settings2 size={20} style={{ color: '#F59E0B' }} />;
      default: return <Activity size={20} style={{ color: 'var(--text-secondary)' }} />;
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
        <Sidebar />
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading Activity...</p>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
        <header style={{ marginBottom: '3rem' }}>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Clock size={32} style={{ color: 'var(--accent-primary)' }} /> Recent Activities
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Track your reading journey and updates</p>
        </header>

        <div style={{ maxWidth: '800px' }}>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderRadius: '12px' }}>
              <Activity size={48} style={{ opacity: 0.5, marginBottom: '1rem' }} />
              <p>No recent activity found. Start by importing a book!</p>
            </div>
          ) : (
            Object.entries(groups).map(([groupName, items]) => {
              if (items.length === 0) return null;
              return (
                <div key={groupName} style={{ marginBottom: '2.5rem' }}>
                  <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                    {groupName}
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {items.map(item => (
                      <div key={item.id} style={{ 
                        display: 'flex', alignItems: 'center', gap: '1.5rem', 
                        padding: '1.25rem', background: 'var(--bg-secondary)', 
                        borderRadius: '12px', border: '1px solid var(--border-color)',
                        transition: 'transform 0.2s ease, border-color 0.2s ease'
                      }} onMouseOver={e => {
                        e.currentTarget.style.transform = 'translateX(4px)';
                        e.currentTarget.style.borderColor = 'var(--accent-primary)';
                      }} onMouseOut={e => {
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.borderColor = 'var(--border-color)';
                      }}>
                        <div style={{ 
                          width: '48px', height: '48px', borderRadius: '12px', 
                          background: 'var(--bg-tertiary)', display: 'flex', 
                          alignItems: 'center', justifyContent: 'center'
                        }}>
                          {getIconForType(item.type)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: '0 0 0.25rem 0', fontWeight: 500, fontSize: '1.05rem' }}>{item.message}</p>
                          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
