import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { updateSyncMap } from '../storage/db';
import { fetchWithAuth } from '../utils/api';

export interface AlignmentJob {
  bookId: string;
  bookTitle: string;
  progressMsg: string;
  status: 'uploading' | 'processing' | 'paused' | 'complete' | 'error' | 'queued';
  progressMin?: number;
  totalMin?: number;
}

type JobMap = Record<string, AlignmentJob>;

interface AlignmentContextType {
  /** All currently tracked jobs, keyed by bookId */
  jobs: JobMap;
  /** Look up a single job by bookId */
  getJob: (bookId: string) => AlignmentJob | null;
  /** The most-recently-started active (non-complete/error) job — for global notification banners */
  activeJob: AlignmentJob | null;
  startJob: (job: AlignmentJob) => void;
  updateJob: (bookId: string, progressMsg: string, progressMin?: number, totalMin?: number, status?: 'processing' | 'paused') => void;
  pauseJob: (bookId: string) => Promise<void>;
  resumeJob: (bookId: string) => Promise<void>;
  completeJob: (bookId: string) => void;
  failJob: (bookId: string, errorMsg: string) => void;
  clearJob: (bookId: string) => void;
}

const AlignmentContext = createContext<AlignmentContextType | null>(null);

function loadJobsFromStorage(): JobMap {
  try {
    const saved = localStorage.getItem('alignmentJobs');
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveJobsToStorage(jobs: JobMap) {
  try {
    localStorage.setItem('alignmentJobs', JSON.stringify(jobs));
  } catch {
    // storage quota exceeded — ignore
  }
}

export function AlignmentProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobMap>(loadJobsFromStorage);

  // Persist to localStorage on every change
  useEffect(() => {
    saveJobsToStorage(jobs);
  }, [jobs]);

  // Derive the most-recently-started active job for backward-compat banner
  const activeJob: AlignmentJob | null = (() => {
    const active = Object.values(jobs).filter(
      (j) => j.status === 'processing' || j.status === 'paused' || j.status === 'uploading'
    );
    return active.length > 0 ? active[active.length - 1] : null;
  })();

  const getJob = useCallback((bookId: string): AlignmentJob | null => {
    return jobs[bookId] ?? null;
  }, [jobs]);

  const startJob = (job: AlignmentJob) => {
    setJobs((prev) => ({ ...prev, [job.bookId]: job }));
  };

  const updateJob = (
    bookId: string,
    progressMsg: string,
    progressMin?: number,
    totalMin?: number,
    status?: 'processing' | 'paused' | 'queued'
  ) => {
    setJobs((prev) => {
      const existing = prev[bookId];
      if (!existing) return prev;
      const next: AlignmentJob = {
        ...existing,
        progressMsg,
        progressMin: progressMin ?? existing.progressMin,
        totalMin: totalMin ?? existing.totalMin,
        status: status ?? existing.status,
      };
      // Skip re-render if nothing changed
      if (
        next.progressMsg === existing.progressMsg &&
        next.status === existing.status &&
        next.progressMin === existing.progressMin
      ) {
        return prev;
      }
      return { ...prev, [bookId]: next };
    });
  };

  const pauseJob = async (bookId: string) => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      await fetchWithAuth(`${API_URL}/pause/${bookId}`, { method: 'POST' });
      setJobs((prev) =>
        prev[bookId] ? { ...prev, [bookId]: { ...prev[bookId], status: 'paused' } } : prev
      );
    } catch (e) {
      console.error('Failed to pause', e);
    }
  };

  const resumeJob = async (bookId: string) => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      await fetchWithAuth(`${API_URL}/resume/${bookId}`, { method: 'POST' });
      setJobs((prev) =>
        prev[bookId] ? { ...prev, [bookId]: { ...prev[bookId], status: 'processing' } } : prev
      );
    } catch (e) {
      console.error('Failed to resume', e);
    }
  };

  const completeJob = (bookId: string) => {
    setJobs((prev) =>
      prev[bookId]
        ? {
            ...prev,
            [bookId]: {
              ...prev[bookId],
              status: 'complete',
              progressMsg: 'Sync map generated successfully!',
            },
          }
        : prev
    );
  };

  const failJob = (bookId: string, errorMsg: string) => {
    setJobs((prev) =>
      prev[bookId]
        ? { ...prev, [bookId]: { ...prev[bookId], status: 'error', progressMsg: errorMsg } }
        : prev
    );
  };

  const clearJob = (bookId: string) => {
    setJobs((prev) => {
      const next = { ...prev };
      delete next[bookId];
      return next;
    });
  };

  // Polling loop — polls ALL currently-processing jobs
  useEffect(() => {
    const activeBookIds = Object.values(jobs)
      .filter((j) => j.status === 'processing' || j.status === 'queued')
      .map((j) => j.bookId);

    if (activeBookIds.length === 0) return;

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

    const pollInterval = setInterval(async () => {
      await Promise.all(
        activeBookIds.map(async (bookId) => {
          try {
            const statusRes = await fetchWithAuth(`${API_URL}/status/${bookId}`);
            if (statusRes.ok) {
              const data = await statusRes.json();

              if (data.sync_map && data.sync_map.length > 0) {
                await updateSyncMap(bookId, data.sync_map);
              }

              if (data.status === 'Processed Book') {
                if (data.sync_map) {
                  completeJob(bookId);
                } else {
                  failJob(bookId, 'Alignment finished but no sync map was returned.');
                }
              } else if (data.status.startsWith('Error')) {
                failJob(bookId, data.status);
              } else if (data.status.startsWith('Processing|')) {
                const parts = data.status.split('|');
                const pMin = parseFloat(parts[1]);
                const tMin = parseFloat(parts[2]);
                const pDisplay = Math.floor(pMin);
                const tDisplay = Math.floor(tMin);
                updateJob(bookId, `Processing (${pDisplay}m / ${tDisplay}m)`, pMin, tMin, 'processing');
              } else if (data.status === 'Paused') {
                updateJob(bookId, 'Paused', undefined, undefined, 'paused');
              } else if (data.status.startsWith('Queued')) {
                updateJob(bookId, data.status, undefined, undefined, 'queued');
              } else {
                updateJob(bookId, data.status);
              }
            } else if (statusRes.status === 404) {
              failJob(bookId, 'Alignment job lost (server restarted)');
            }
          } catch (e) {
            console.error(`Polling error for ${bookId}:`, e);
          }
        })
      );
    }, 2000);

    return () => clearInterval(pollInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(Object.values(jobs).filter(j => j.status === 'processing' || j.status === 'queued').map(j => j.bookId))]);

  return (
    <AlignmentContext.Provider
      value={{ jobs, getJob, activeJob, startJob, updateJob, pauseJob, resumeJob, completeJob, failJob, clearJob }}
    >
      {children}
    </AlignmentContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAlignment() {
  const ctx = useContext(AlignmentContext);
  if (!ctx) throw new Error('useAlignment must be used within AlignmentProvider');
  return ctx;
}
