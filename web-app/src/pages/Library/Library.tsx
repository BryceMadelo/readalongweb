import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, Search, Library as LibraryIcon, Compass, Clock, X } from 'lucide-react';
import { getBooks, deleteBook, type BookMeta } from '../../storage/db';
import { BookCard } from './BookCard';
import { useAlignment } from '../../context/AlignmentContext';

export default function Library() {
  const { activeJob } = useAlignment();
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('All Books');
  const [showToast, setShowToast] = useState(true);

  const filters = ['All Books', 'In Progress', 'To Read', 'Completed', 'Favorites'];

  useEffect(() => {
    if (activeJob?.status === 'processing') setShowToast(true);
  }, [activeJob?.status]);

  useEffect(() => {
    async function loadBooks() {
      try {
        const loadedBooks = await getBooks();
        setBooks(loadedBooks.sort((a, b) => b.dateAdded - a.dateAdded));
      } catch (e) {
        console.error("Failed to load books:", e);
      } finally {
        setIsLoading(false);
      }
    }
    loadBooks();
  }, []);

  const handleDelete = async (bookId: string) => {
    if (window.confirm("Are you sure you want to delete this book?")) {
      await deleteBook(bookId);
      setBooks(books.filter(b => b.id !== bookId));
    }
  };

  const handleUpdateMeta = (bookId: string, title: string, author: string) => {
    setBooks(books.map(b => b.id === bookId ? { ...b, title, author } : b));
  };

  const filteredBooks = books.filter(b => {
    if (activeFilter === 'All Books') return true;
    if (activeFilter === 'In Progress') return b.progress && b.progress > 0;
    if (activeFilter === 'To Read') return !b.progress;
    // other filters as placeholder
    return true;
  });

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <aside style={{ width: '260px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-secondary)', padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '3rem' }}>
          <div style={{ width: '32px', height: '32px', background: 'var(--accent-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BookOpen size={20} style={{ color: 'white' }} />
          </div>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.5px' }}>ReadAlong</span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
          <a href="#" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'var(--accent-primary)', color: 'white', textDecoration: 'none', fontWeight: 500 }}>
            <LibraryIcon size={20} /> My Library
          </a>
          <a href="#" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', color: 'var(--text-secondary)', textDecoration: 'none', fontWeight: 500 }}>
            <Compass size={20} /> Discover
          </a>
          <a href="#" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', color: 'var(--text-secondary)', textDecoration: 'none', fontWeight: 500 }}>
            <Clock size={20} /> Recent Activities
          </a>
        </nav>

        {/* User Profile Card Pinned at Bottom */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '1rem', marginTop: 'auto' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-light), var(--accent-primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
            A
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Alex Reader</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Premium Member</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* Top Search & Actions */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--glass-bg)', backdropFilter: 'blur(12px)', zIndex: 10 }}>
          <div style={{ position: 'relative', width: '400px', maxWidth: '100%' }}>
            <Search size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search your library..."
              style={{ width: '100%', padding: '0.75rem 1rem 0.75rem 3rem', borderRadius: '24px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', fontSize: '0.95rem' }}
            />
          </div>
          <Link to="/import" className="btn btn-primary" style={{ textDecoration: 'none', borderRadius: '24px' }}>
            <Plus size={20} /> Add Book
          </Link>
        </header>

        {/* Library Grid Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

            <div style={{ marginBottom: '2rem' }}>
              <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>My Library</h1>
              <p style={{ color: 'var(--text-secondary)' }}>Pick up where you left off</p>
            </div>

            {/* Filter Pills */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
              {filters.map(filter => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  style={{
                    padding: '0.5rem 1rem', borderRadius: '24px', border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem',
                    backgroundColor: activeFilter === filter ? 'var(--text-primary)' : 'var(--bg-secondary)',
                    color: activeFilter === filter ? 'var(--bg-primary)' : 'var(--text-secondary)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {filter}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>Loading your collection...</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '2rem' }}>

                {/* Persistent Add Book Tile */}
                <Link to="/import" style={{ textDecoration: 'none' }}>
                  <div style={{
                    height: '100%', minHeight: '360px', borderRadius: '16px', border: '2px dashed var(--border-color)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '2rem', textAlign: 'center', cursor: 'pointer', color: 'var(--text-secondary)',
                    transition: 'all 0.2s ease', backgroundColor: 'var(--bg-secondary)'
                  }} onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'} onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-color)'}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                      <Plus size={24} style={{ color: 'var(--text-primary)' }} />
                    </div>
                    <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Add a new book</h3>
                    <p style={{ fontSize: '0.85rem' }}>Upload your EPUB and MP3 files to start synchronizing</p>
                  </div>
                </Link>

                {filteredBooks.map(book => (
                  <BookCard
                    key={book.id}
                    book={book}
                    onDelete={handleDelete}
                    onUpdate={handleUpdateMeta}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Global Toast for Alignment Progress */}
      {activeJob?.status === 'processing' && showToast && (() => {
        const title = books.find(b => b.id === activeJob.bookId)?.title || 'Unknown Book';
        const pMin = activeJob.progressMin || 0;
        const tMin = activeJob.totalMin || 0;
        const pct = tMin > 0 ? (pMin / tMin) * 100 : 0;

        return (
          <div style={{
            position: 'fixed', bottom: '2rem', right: '2rem', width: '320px',
            backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
            borderRadius: '12px', padding: '1rem', boxShadow: 'var(--card-shadow)', zIndex: 100
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Aligning "{title}"</div>
              <button onClick={() => setShowToast(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={{ height: '4px', background: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--accent-primary)', width: `${pct}%`, transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              <span>{Math.floor(pMin)}m / {Math.floor(tMin)}m</span>
              <span>{Math.round(pct)}%</span>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
