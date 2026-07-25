import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Clock, Trash2, Edit2, Play, Pause, CheckCircle } from 'lucide-react';
import { useAlignment } from '../../context/AlignmentContext';
import { type BookMeta, updateBookMeta } from '../../storage/db';

interface BookCardProps {
  book: BookMeta;
  onDelete: (id: string) => void;
  onUpdate: (id: string, title: string, author: string) => void;
}

export function BookCard({ book, onDelete, onUpdate }: BookCardProps) {
  const { activeJob, pauseJob, resumeJob } = useAlignment();
  
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(book.title);
  const [editAuthor, setEditAuthor] = useState(book.author);

  const isAligningThis = activeJob?.bookId === book.id && activeJob?.status !== 'complete' && activeJob?.status !== 'failed';
  const isPaused = isAligningThis && activeJob?.status === 'paused';
  const pMin = isAligningThis ? (activeJob?.progressMin || 0) : 0;
  const tMin = isAligningThis ? (activeJob?.totalMin || 0) : 0;
  
  // Use buckets for UI display like 10m/700m if it's aligning
  const pBucket = Math.floor(pMin / 10) * 10;
  const tBucket = Math.floor(tMin / 10) * 10;
  const isReadyToRead = !isAligningThis || pMin >= 10; // Must be completed, or if aligning, have > 10m

  const handleSaveEdit = async () => {
    setIsEditing(false);
    if (editTitle !== book.title || editAuthor !== book.author) {
      await updateBookMeta(book.id, editTitle, editAuthor);
      onUpdate(book.id, editTitle, editAuthor);
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (isEditing) {
      e.preventDefault();
      return;
    }
    if (!isReadyToRead) {
      e.preventDefault();
      alert("Please wait for at least 10 minutes of audio to be aligned before opening the reader.");
    }
  };

  return (
    <Link to={`/reader/${book.id}`} onClick={handleCardClick} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
        <div style={{ 
          backgroundColor: 'var(--bg-tertiary)', 
          height: '200px', 
          borderRadius: '8px', 
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: book.coverImage ? `url(${book.coverImage}) center/cover` : 'linear-gradient(135deg, var(--accent-light), var(--accent-primary))'
        }}>
          {!book.coverImage && <BookOpen size={48} style={{ color: 'white', opacity: 0.8 }} />}
          
          {/* Top Right Status Badge */}
          {!isAligningThis && (
            <div style={{ position: 'absolute', top: '10px', right: '10px', background: 'var(--accent-primary)', color: 'white', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>
              READY
            </div>
          )}
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, marginRight: '1rem' }}>
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
                <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {book.title}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>{book.author}</p>
              </>
            )}
          </div>
          {!isEditing && (
            <button 
              onClick={(e) => { e.preventDefault(); setIsEditing(true); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <Edit2 size={16} />
            </button>
          )}
        </div>

        {/* Alignment Progress Block */}
        {isAligningThis ? (
          <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', fontWeight: 600 }}>
                <Clock size={16} style={{ color: 'var(--accent-primary)' }} />
                {isPaused ? 'Paused...' : 'Aligning...'}
              </div>
              <button 
                onClick={(e) => { e.preventDefault(); isPaused ? resumeJob() : pauseJob(); }}
                style={{ background: 'var(--bg-secondary)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--accent-primary)' }}
              >
                {isPaused ? <Play size={16} /> : <Pause size={16} />}
              </button>
            </div>
            
            <div style={{ height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
               <div style={{ height: '100%', background: 'var(--accent-primary)', width: `${tMin > 0 ? (pMin / tMin) * 100 : 0}%`, transition: 'width 0.3s ease' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              <span>{pBucket}m / {tBucket}m</span>
              {isReadyToRead ? (
                <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle size={12} /> Unlocked
                </span>
              ) : (
                 <span>Locked (&lt;10m)</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', border: '1px solid var(--border-color)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
             {book.progress && book.progress > 0 ? (
               <>
                 <div style={{ height: '6px', background: 'var(--success)', borderRadius: '3px', width: '100%', marginRight: '1rem' }} />
                 <span style={{ fontSize: '0.8rem', color: 'var(--success)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                   At {new Date(book.progress).toISOString().substr(11, 8).replace(/^00:/, '')}
                 </span>
               </>
             ) : (
               <>
                 <div style={{ height: '6px', background: 'var(--accent-primary)', borderRadius: '3px', width: '50%', marginRight: '1rem' }} />
                 <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>Fully Aligned</span>
               </>
             )}
          </div>
        )}
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          <button 
            disabled={!isReadyToRead}
            style={{ flex: 1, padding: '0.75rem', background: isReadyToRead ? 'var(--accent-primary)' : 'var(--bg-tertiary)', color: isReadyToRead ? 'white' : 'var(--text-secondary)', border: 'none', borderRadius: '8px', cursor: isReadyToRead ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 600, marginRight: '8px' }}
          >
            <BookOpen size={18} /> Open Reader
          </button>
          
          <button 
            onClick={(e) => { e.preventDefault(); onDelete(book.id); }}
            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem' }}
            title="Delete Book"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </Link>
  );
}
