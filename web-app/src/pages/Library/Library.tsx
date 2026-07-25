import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus } from 'lucide-react';
import { getBooks, deleteBook, type BookMeta } from '../../storage/db';
import { BookCard } from './BookCard';

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

  const handleDelete = async (bookId: string) => {
    if (window.confirm("Are you sure you want to delete this book?")) {
      await deleteBook(bookId);
      setBooks(books.filter(b => b.id !== bookId));
    }
  };

  const handleUpdateMeta = (bookId: string, title: string, author: string) => {
    setBooks(books.map(b => b.id === bookId ? { ...b, title, author } : b));
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
  );
}
