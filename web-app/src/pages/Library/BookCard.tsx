import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Star, Trash2, Edit2, Play, Pause, CheckCircle, Lock, Clock, FileAudio } from 'lucide-react';
import { useAlignment } from '../../context/AlignmentContext';
import { type BookMeta, updateBookMeta, toggleFavorite, saveBook, getBookData, addHistory } from '../../storage/db';
import { fetchWithAuth, getApiToken } from '../../utils/api';

interface BookCardProps {
  book: BookMeta;
  onDelete: (id: string) => void;
  onUpdate: (id: string, title: string, author: string) => void;
  onFavoriteChange: (id: string, isFav: boolean) => void;
}

export function BookCard({ book, onDelete, onUpdate, onFavoriteChange }: BookCardProps) {
  const { getJob, pauseJob, resumeJob, startJob } = useAlignment();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(book.title);
  const [editAuthor, setEditAuthor] = useState(book.author);

  
  // Use state for favorite to update instantly
  const [isFavorite, setIsFavorite] = useState(book.isFavorite || false);

  const job = getJob(book.id);
  const isAligningThis = !!job && job.status !== 'complete' && job.status !== 'error';
  const isPaused = isAligningThis && job?.status === 'paused';
  const pMin = job?.progressMin ?? 0;
  const tMin = job?.totalMin ?? 0;

  const pDisplay = pMin.toFixed(1);
  const tDisplay = tMin.toFixed(1);
  
  // Ready to read if: it's fully aligned/text-only (not aligning) OR it is aligning but has processed at least 10 minutes
  const isReadyToRead = !isAligningThis || (isAligningThis && pMin >= 10);

  const estimatedDuration = book.durationMs || (job ? job.totalMin * 60000 : undefined);
  const readingProgressPct = estimatedDuration ? Math.min(100, Math.round((book.progress / estimatedDuration) * 100)) : 0;
  const audioSyncPct = tMin > 0 ? Math.min(100, Math.round((pMin / tMin) * 100)) : (isAligningThis ? 0 : 100);

  const isBookCompleted = readingProgressPct >= 95;
  const hasAudio = book.hasAudio || !!book.durationMs || !!job;

  const handleSaveEdit = async () => {
    setIsEditing(false);
    if (editTitle !== book.title || editAuthor !== book.author) {
      await updateBookMeta(book.id, editTitle, editAuthor);
      
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      try {
        await fetchWithAuth(`${API_URL}/edit/${book.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: editTitle, author: editAuthor })
        });
      } catch (e) {
        console.error("Failed to update remote title", e);
      }
      
      onUpdate(book.id, editTitle, editAuthor);
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newFav = await toggleFavorite(book.id);
    setIsFavorite(newFav);
    
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
    try {
      await fetchWithAuth(`${API_URL}/books/${book.id}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_favorite: newFav })
      });
    } catch (e) {
      console.error("Failed to update remote favorite", e);
    }
    
    onFavoriteChange(book.id, newFav);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete(book.id);
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    

    try {
      // 1. Send to server
      const formData = new FormData();
      formData.append('audio', file);
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      const res = await fetchWithAuth(`${API_URL}/add_audio/${book.id}`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        alert("Failed to upload audio to server.");
        return;
      }
      
      // 2. Save locally and start job
      const bookData = await getBookData(book.id);
      await saveBook(
        bookData.meta,
        bookData.paragraphs,
        file,
        [],
        bookData.images
      );
      
      startJob({ bookId: book.id, bookTitle: book.title, progressMsg: 'Aligning text and audio...', status: 'processing' });
      await addHistory('align', `Added audio to ${book.title}`, book.id);
      
      alert("Audio added and alignment started!");
      
    } catch (err) {
      console.error(err);
      alert("Error uploading audio.");
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        
        {/* Cover Image Area */}
        <div style={{ 
          backgroundColor: 'var(--bg-tertiary)', 
          height: '240px', 
          borderRadius: '12px', 
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          background: book.coverImage 
            ? `url(${book.coverImage.startsWith('/api') ? `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/books/${book.id}/cover?token=${getApiToken()}` : book.coverImage}) center/cover` 
            : 'linear-gradient(135deg, var(--accent-light), var(--accent-primary))'
        }}>
          {!book.coverImage && <BookOpen size={48} style={{ color: 'white', opacity: 0.8 }} />}
          
          {/* Favorite Star Button - Top Left */}
          <button
            onClick={handleToggleFavorite}
            style={{
              position: 'absolute', top: '12px', left: '12px',
              background: 'var(--glass-bg)', backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%',
              width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isFavorite ? '#F59E0B' : 'white', cursor: 'pointer', zIndex: 5,
              transition: 'all 0.2s ease'
            }}
          >
            <Star size={16} fill={isFavorite ? '#F59E0B' : 'none'} />
          </button>
        </div>

        {/* Toolbar below image */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); fileInputRef.current?.click(); }}
              style={{ background: 'var(--bg-tertiary)', border: 'none', borderRadius: '8px', padding: '6px', cursor: 'pointer', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Add or Change Audio"
            >
              <FileAudio size={16} />
            </button>
            <input type="file" ref={fileInputRef} onChange={handleAudioUpload} onClick={e => e.stopPropagation()} accept="audio/mpeg, audio/mp3, audio/m4a" style={{ display: 'none' }} />
          </div>

          {/* Edit Button */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsEditing(true); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
            >
              <Edit2 size={16} />
            </button>
          </div>
        </div>

        {/* Title and Author */}
        <div style={{ marginBottom: '1rem' }}>
          {isEditing ? (
            <div onClick={e => e.preventDefault()}>
              <input 
                type="text" 
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                style={{ width: '100%', marginBottom: '4px', padding: '4px', fontSize: '1.1rem' }}
                autoFocus
              />
              <input 
                type="text" 
                value={editAuthor}
                onChange={e => setEditAuthor(e.target.value)}
                style={{ width: '100%', padding: '4px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}
              />
              <button onClick={handleSaveEdit} className="btn btn-primary" style={{ marginTop: '8px', padding: '4px 8px', fontSize: '0.8rem' }}>Save</button>
            </div>
          ) : (
            <>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {book.title}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{book.author}</p>
            </>
          )}
        </div>

        {/* Status Area */}
        <div style={{ backgroundColor: 'var(--bg-tertiary)', borderRadius: '12px', padding: '1rem', marginBottom: '1rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {hasAudio && !isAligningThis && (
             <div style={{ display: 'flex', justifyContent: 'center', background: 'var(--accent-light)', color: 'var(--accent-primary)', padding: '4px 8px', borderRadius: '16px', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '1px' }}>
               <CheckCircle size={12} style={{ marginRight: '4px' }} /> FULLY ALIGNED
             </div>
          )}

          {/* Reading Progress */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>
              <span>Reading Progress</span>
              <span style={{ color: 'var(--accent-primary)' }}>{readingProgressPct}%</span>
            </div>
            <div style={{ height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--accent-primary)', width: `${readingProgressPct}%` }} />
            </div>
          </div>

          {/* Audio Sync Progress */}
          {isAligningThis && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={14} style={{ color: 'var(--accent-primary)' }} />
                  {isPaused ? 'Audio Paused' : 'Audio Sync'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{audioSyncPct}%</span>
                  <button 
                    onClick={(e) => { 
                      e.preventDefault(); 
                      e.stopPropagation();
                      if (isPaused) resumeJob(book.id); else pauseJob(book.id);
                    }}
                    style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary)', display: 'flex' }}
                  >
                    {isPaused ? <Play size={14} /> : <Pause size={14} />}
                  </button>
                </div>
              </div>
              <div style={{ height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden', marginBottom: '0.5rem' }}>
                <div style={{ height: '100%', background: 'var(--text-secondary)', width: `${audioSyncPct}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <span>{pDisplay}m / {tDisplay}m</span>
                {isReadyToRead ? (
                  <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                     Unlocked
                  </span>
                ) : (
                   <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                     <Lock size={12} /> Locked
                   </span>
                )}
              </div>
            </div>
          )}
          
          {/* Completed Text */}
          {(!isAligningThis && isBookCompleted) && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600 }}>
                <span>Completed</span>
                <span style={{ color: 'var(--success)' }}><CheckCircle size={14} /></span>
              </div>
            </div>
          )}
        </div>
        
        {/* Action Button */}
        <div style={{ marginTop: 'auto', display: 'flex', gap: '8px' }}>
          {isReadyToRead ? (
            <button onClick={() => navigate(`/reader/${book.id}`)} style={{ flex: 1, padding: '0.875rem', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 600, cursor: 'pointer' }}>
              <BookOpen size={18} /> Open Reader
            </button>
          ) : (
            <button disabled style={{ flex: 1, padding: '0.875rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: 'none', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 600, cursor: 'not-allowed' }}>
              <Lock size={18} /> Reader Locked
            </button>
          )}
          
          <button 
            onClick={handleDelete}
            style={{ 
              width: '48px', 
              background: 'var(--bg-tertiary)', 
              color: 'var(--danger)', 
              border: 'none', 
              borderRadius: '8px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              cursor: 'pointer',
              transition: 'background 0.2s ease'
            }}
            onMouseOver={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
            onMouseOut={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
            title="Delete Book"
          >
            <Trash2 size={18} />
          </button>
        </div>

      </div>
  );
}
