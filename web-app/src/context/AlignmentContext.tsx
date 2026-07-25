import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { updateSyncMap } from '../storage/db';

interface AlignmentJob {
  bookId: string;
  bookTitle: string;
  progressMsg: string;
  status: 'uploading' | 'processing' | 'paused' | 'complete' | 'error';
  progressMin?: number;
  totalMin?: number;
}

interface AlignmentContextType {
  activeJob: AlignmentJob | null;
  startJob: (job: AlignmentJob) => void;
  updateJob: (progressMsg: string, progressMin?: number, totalMin?: number, status?: 'processing' | 'paused') => void;
  pauseJob: () => Promise<void>;
  resumeJob: () => Promise<void>;
  completeJob: () => void;
  failJob: (errorMsg: string) => void;
  clearJob: () => void;
}

const AlignmentContext = createContext<AlignmentContextType | null>(null);

export function AlignmentProvider({ children }: { children: ReactNode }) {
  const [activeJob, setActiveJob] = useState<AlignmentJob | null>(() => {
    const saved = localStorage.getItem('activeAlignmentJob');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (activeJob) {
      localStorage.setItem('activeAlignmentJob', JSON.stringify(activeJob));
    } else {
      localStorage.removeItem('activeAlignmentJob');
    }
  }, [activeJob]);

  const startJob = (job: AlignmentJob) => setActiveJob(job);
  const updateJob = (progressMsg: string, progressMin?: number, totalMin?: number, status?: 'processing' | 'paused') => {
    setActiveJob((prev) => {
      if (prev && prev.progressMsg === progressMsg && prev.status === (status || prev.status)) return prev;
      return prev ? { ...prev, progressMsg, progressMin: progressMin ?? prev.progressMin, totalMin: totalMin ?? prev.totalMin, status: status || prev.status } : null;
    });
  };

  const pauseJob = async () => {
    if (!activeJob) return;
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      await fetch(`${API_URL}/pause/${activeJob.bookId}`, { method: 'POST' });
      setActiveJob(prev => prev ? { ...prev, status: 'paused' } : null);
    } catch (e) {
      console.error("Failed to pause", e);
    }
  };

  const resumeJob = async () => {
    if (!activeJob) return;
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      await fetch(`${API_URL}/resume/${activeJob.bookId}`, { method: 'POST' });
      setActiveJob(prev => prev ? { ...prev, status: 'processing' } : null);
    } catch (e) {
      console.error("Failed to resume", e);
    }
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
          // Always save intermediate sync points so playback works earlier
          if (data.sync_map && data.sync_map.length > 0) {
            await updateSyncMap(activeJob.bookId, data.sync_map);
          }
          
          if (data.status === 'Processed Book') {
            if (data.sync_map) {
              completeJob();
            } else {
              failJob("Alignment finished but no sync map was returned.");
            }
          } else if (data.status.startsWith('Error')) {
            failJob(data.status);
          } else if (data.status.startsWith('Processing|')) {
            const parts = data.status.split('|');
            const pMin = parseFloat(parts[1]);
            const tMin = parseFloat(parts[2]);
            const pDisplay = Math.floor(pMin);
            const tDisplay = Math.floor(tMin);
            updateJob(`Processing (${pDisplay}m / ${tDisplay}m)`, pMin, tMin, 'processing');
          } else if (data.status === 'Paused') {
            updateJob('Paused', undefined, undefined, 'paused');
          } else {
            updateJob(data.status);
          }
        } else if (statusRes.status === 404) {
          // Job not found on server (e.g. server restarted), clear it
          failJob("Alignment job lost (server restarted)");
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [activeJob?.bookId, activeJob?.status]);

  return (
    <AlignmentContext.Provider value={{ activeJob, startJob, updateJob, pauseJob, resumeJob, completeJob, failJob, clearJob }}>
      {children}
      {/* Toast removed as per design, progress is shown in Library and Reader */}
    </AlignmentContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAlignment() {
  const ctx = useContext(AlignmentContext);
  if (!ctx) throw new Error('useAlignment must be used within AlignmentProvider');
  return ctx;
}
