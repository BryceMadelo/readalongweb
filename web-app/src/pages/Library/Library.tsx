import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, Clock, Trash2 } from 'lucide-react';
import { getBooks, deleteBook, type BookMeta } from '../../storage/db';

export default function Library() {
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

  const handleDelete = async (e: React.MouseEvent, bookId: string) => {
    e.preventDefault(); // Prevent navigating to the reader
    if (window.confirm("Are you sure you want to delete this book?")) {
      await deleteBook(bookId);
      setBooks(books.filter(b => b.id !== bookId));
    }
  };

  return (
    <div className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div>
          <h1>My Library</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Pick up where you left off</p>
        </div>
        <Link to="/import" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          <Plus size={20} />
          Add Book
        </Link>
      </header>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>Loading your collection...</div>
      ) : books.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem', marginTop: '2rem' }}>
          <BookOpen size={48} style={{ color: 'var(--text-secondary)', marginBottom: '1rem', opacity: 0.5 }} />
          <h3>Your library is empty</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Import an EPUB and audio file to get started.</p>
          <Link to="/import" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Import your first book
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '2rem' }}>
          {books.map(book => (
            <Link to={`/reader/${book.id}`} key={book.id} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                </div>
                
                <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {book.title}
                </h3>
                
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Clock size={16} />
                    <span>Added {new Date(book.dateAdded).toLocaleDateString()}</span>
                  </div>
                  <button 
                    onClick={(e) => handleDelete(e, book.id)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.25rem' }}
                    title="Delete Book"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
