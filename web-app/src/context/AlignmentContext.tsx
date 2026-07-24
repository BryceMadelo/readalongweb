import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { updateSyncMap } from '../storage/db';

interface AlignmentJob {
  bookId: string;
  bookTitle: string;
  progressMsg: string;
  status: 'processing' | 'complete' | 'error';
}

interface AlignmentContextType {
  activeJob: AlignmentJob | null;
  startJob: (job: AlignmentJob) => void;
  updateJob: (progressMsg: string) => void;
  completeJob: () => void;
  failJob: (errorMsg: string) => void;
  clearJob: () => void;
}

const AlignmentContext = createContext<AlignmentContextType | null>(null);

export function AlignmentProvider({ children }: { children: ReactNode }) {
  const [activeJob, setActiveJob] = useState<AlignmentJob | null>(null);

  const startJob = (job: AlignmentJob) => setActiveJob(job);
  const updateJob = (progressMsg: string) => {
    setActiveJob((prev) => prev ? { ...prev, progressMsg } : null);
  };
  const completeJob = () => {
    setActiveJob((prev) => prev ? { ...prev, status: 'complete', progressMsg: 'Sync map generated successfully!' } : null);
  };
  const failJob = (errorMsg: string) => {
    setActiveJob((prev) => prev ? { ...prev, status: 'error', progressMsg: errorMsg } : null);
  };
  const clearJob = () => setActiveJob(null);

  useEffect(() => {
    if (!activeJob || activeJob.status !== 'processing') {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const statusRes = await fetch(`${API_URL}/status/${activeJob.bookId}`);
        if (statusRes.ok) {
          const data = await statusRes.json();
          if (data.status === 'Processed Book') {
            if (data.sync_map) {
              await updateSyncMap(activeJob.bookId, data.sync_map);
              completeJob();
            } else {
              failJob("Alignment finished but no sync map was returned.");
            }
          } else if (data.status.startsWith('Error')) {
            failJob(data.status);
          } else {
            updateJob(data.status);
          }
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [activeJob?.bookId, activeJob?.status]);

  return (
    <AlignmentContext.Provider value={{ activeJob, startJob, updateJob, completeJob, failJob, clearJob }}>
      {children}
      {/* Global Toast for background alignment status */}
      {activeJob && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          backgroundColor: activeJob.status === 'error' ? 'var(--danger)' : 'var(--bg-tertiary)',
          color: activeJob.status === 'error' ? 'white' : 'var(--text-primary)',
          padding: '1rem',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          minWidth: '250px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <strong style={{ fontSize: '0.9rem' }}>Aligning "{activeJob.bookTitle}"</strong>
             {(activeJob.status === 'complete' || activeJob.status === 'error') && (
                 <button
                    onClick={clearJob}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.8 }}
                 >
                     ✕
                 </button>
             )}
          </div>
          <span style={{ fontSize: '0.875rem', opacity: 0.9 }}>{activeJob.progressMsg}</span>
        </div>
      )}
    </AlignmentContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAlignment() {
  const ctx = useContext(AlignmentContext);
  if (!ctx) throw new Error('useAlignment must be used within AlignmentProvider');
  return ctx;
}
