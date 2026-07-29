use readalong_core::sync::SyncPoint;
use rusqlite::{params, Connection, Result};
use std::path::Path;

pub struct LibraryDb {
    conn: Connection,
}

#[derive(Debug)]
pub struct User {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub created_at: i64,
}

impl LibraryDb {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.init_schema()?;
        db.cleanup_orphaned_jobs()?;
        Ok(db)
    }

    fn cleanup_orphaned_jobs(&self) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET status = 'Error: Server restarted during alignment' WHERE status LIKE 'Processing%' OR status = 'Paused'",
            [],
        )?;
        Ok(())
    }

    fn init_schema(&self) -> Result<()> {
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                epub_path TEXT NOT NULL,
                audio_path TEXT NOT NULL,
                date_added INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'Unknown',
                user_id TEXT NOT NULL DEFAULT 'default_user',
                is_favorite INTEGER NOT NULL DEFAULT 0,
                cover_image_path TEXT
            )",
            [],
        )?;

        let _ = self.conn.execute("ALTER TABLE books ADD COLUMN status TEXT NOT NULL DEFAULT 'Unknown'", []);
        let _ = self.conn.execute("ALTER TABLE books ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default_user'", []);
        let _ = self.conn.execute("ALTER TABLE books ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0", []);
        let _ = self.conn.execute("ALTER TABLE books ADD COLUMN cover_image_path TEXT", []);

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_maps (
                book_id TEXT PRIMARY KEY,
                points_json TEXT NOT NULL,
                user_id TEXT NOT NULL DEFAULT 'default_user'
            )",
            [],
        )?;

        let _ = self.conn.execute("ALTER TABLE sync_maps ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default_user'", []);

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS reading_progress (
                user_id TEXT NOT NULL,
                book_id TEXT NOT NULL,
                progress_ms INTEGER NOT NULL,
                PRIMARY KEY (user_id, book_id)
            )",
            [],
        )?;

        Ok(())
    }

    pub fn create_user(&self, id: &str, email: &str, password_hash: &str) -> Result<bool> {
        let count: i64 = self.conn.query_row("SELECT count(*) FROM users", [], |row| row.get(0))?;
        let is_first_user = count == 0;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.conn.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, email, password_hash, now],
        )?;

        if is_first_user {
            self.conn.execute("UPDATE books SET user_id = ?1 WHERE user_id = 'default_user'", params![id])?;
            self.conn.execute("UPDATE sync_maps SET user_id = ?1 WHERE user_id = 'default_user'", params![id])?;
            self.conn.execute("UPDATE reading_progress SET user_id = ?1 WHERE user_id = 'default_user'", params![id])?;
        }

        Ok(is_first_user)
    }

    pub fn get_user_by_email(&self, email: &str) -> Result<Option<User>> {
        let mut stmt = self.conn.prepare("SELECT id, email, password_hash, created_at FROM users WHERE email = ?1")?;
        let mut rows = stmt.query(params![email])?;
        
        if let Some(row) = rows.next()? {
            Ok(Some(User {
                id: row.get(0)?,
                email: row.get(1)?,
                password_hash: row.get(2)?,
                created_at: row.get(3)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_user_by_id(&self, id: &str) -> Result<Option<User>> {
        let mut stmt = self.conn.prepare("SELECT id, email, password_hash, created_at FROM users WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        
        if let Some(row) = rows.next()? {
            Ok(Some(User {
                id: row.get(0)?,
                email: row.get(1)?,
                password_hash: row.get(2)?,
                created_at: row.get(3)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn update_user_password(&self, user_id: &str, new_hash: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE users SET password_hash = ?2 WHERE id = ?1",
            params![user_id, new_hash],
        )?;
        Ok(())
    }

    pub fn update_user_email(&self, user_id: &str, new_email: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE users SET email = ?2 WHERE id = ?1",
            params![user_id, new_email],
        )?;
        Ok(())
    }

    pub fn save_reading_progress(&self, user_id: &str, book_id: &str, progress_ms: u64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO reading_progress (user_id, book_id, progress_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(user_id, book_id) DO UPDATE SET
             progress_ms=excluded.progress_ms",
            params![user_id, book_id, progress_ms],
        )?;
        Ok(())
    }

    pub fn get_reading_progress(&self, user_id: &str, book_id: &str) -> Result<Option<u64>> {
        let mut stmt = self.conn.prepare(
            "SELECT progress_ms FROM reading_progress WHERE user_id = ?1 AND book_id = ?2"
        )?;
        let result: Result<u64> = stmt.query_row(params![user_id, book_id], |row| row.get(0));

        match result {
            Ok(p) => Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn insert_book(
        &self,
        id: &str,
        user_id: &str,
        title: &str,
        author: &str,
        epub_path: &str,
        audio_path: &str,
        status: &str,
    ) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.conn.execute(
            "INSERT INTO books (id, title, author, epub_path, audio_path, date_added, status, user_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
             title=excluded.title, author=excluded.author, epub_path=excluded.epub_path, audio_path=excluded.audio_path, status=excluded.status, user_id=excluded.user_id",
            params![id, title, author, epub_path, audio_path, now, status, user_id],
        )?;

        Ok(())
    }

    pub fn update_book_status(&self, book_id: &str, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET status = ?2 WHERE id = ?1",
            params![book_id, status],
        )?;
        Ok(())
    }

    pub fn update_book_meta(&self, user_id: &str, book_id: &str, title: &str, author: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET title = ?2, author = ?3 WHERE id = ?1 AND user_id = ?4",
            params![book_id, title, author, user_id],
        )?;
        Ok(())
    }

    pub fn set_favorite(&self, user_id: &str, book_id: &str, is_favorite: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET is_favorite = ?2 WHERE id = ?1 AND user_id = ?3",
            params![book_id, if is_favorite { 1 } else { 0 }, user_id],
        )?;
        Ok(())
    }

    pub fn set_cover_image(&self, user_id: &str, book_id: &str, cover_path: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET cover_image_path = ?2 WHERE id = ?1 AND user_id = ?3",
            params![book_id, cover_path, user_id],
        )?;
        Ok(())
    }
    
    pub fn get_cover_image(&self, user_id: &str, book_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT cover_image_path FROM books WHERE id = ?1 AND user_id = ?2")?;
        let cover_path: Option<String> = stmt.query_row(params![book_id, user_id], |row| row.get(0)).unwrap_or(None);
        Ok(cover_path)
    }

    pub fn save_sync_map(&self, user_id: &str, book_id: &str, points: &[SyncPoint]) -> Result<()> {
        let json = serde_json::to_string(points).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })?;

        self.conn.execute(
            "INSERT INTO sync_maps (book_id, points_json, user_id)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(book_id) DO UPDATE SET
             points_json=excluded.points_json, user_id=excluded.user_id",
            params![book_id, json, user_id],
        )?;

        Ok(())
    }

    pub fn get_sync_map(&self, user_id: &str, book_id: &str) -> Result<Vec<SyncPoint>> {
        let mut stmt = self.conn.prepare("SELECT points_json FROM sync_maps WHERE book_id = ?1 AND user_id = ?2")?;
        let json: String = stmt.query_row(params![book_id, user_id], |row| row.get(0))?;

        let points: Vec<SyncPoint> = serde_json::from_str(&json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?;

        Ok(points)
    }

    pub fn get_book_status(&self, book_id: &str) -> Result<String> {
        let mut stmt = self.conn.prepare("SELECT status FROM books WHERE id = ?1")?;
        let status: String = stmt.query_row(params![book_id], |row| row.get(0))?;
        Ok(status)
    }

    pub fn get_book_paths(&self, user_id: &str, book_id: &str) -> Result<(String, String)> {
        let mut stmt = self.conn.prepare("SELECT epub_path, audio_path FROM books WHERE id = ?1 AND user_id = ?2")?;
        let paths = stmt.query_row(params![book_id, user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        Ok(paths)
    }

    pub fn delete_book(&self, user_id: &str, book_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM books WHERE id = ?1 AND user_id = ?2", params![book_id, user_id])?;
        self.conn.execute("DELETE FROM sync_maps WHERE book_id = ?1 AND user_id = ?2", params![book_id, user_id])?;
        self.conn.execute("DELETE FROM reading_progress WHERE book_id = ?1 AND user_id = ?2", params![book_id, user_id])?;
        Ok(())
    }

    pub fn get_books_for_user(&self, user_id: &str) -> Result<Vec<crate::BookMeta>> {
        let mut stmt = self.conn.prepare("SELECT id, title, author, date_added, is_favorite, cover_image_path FROM books WHERE user_id = ?1 ORDER BY date_added DESC")?;
        let rows = stmt.query_map(params![user_id], |row| {
            let cover_path: Option<String> = row.get(5)?;
            // Just return a boolean-like presence or URL if path exists.
            let cover_image = cover_path.map(|_| "/api/books/".to_string() + &row.get::<_, String>(0).unwrap() + "/cover");
            Ok(crate::BookMeta {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                date_added: row.get(3)?,
                progress: 0.0, // We can populate this later or join it
                is_favorite: row.get::<_, i32>(4)? > 0,
                cover_image,
                duration_ms: None,
                has_audio: false,
            })
        })?;
        
        let mut books = Vec::new();
        for r in rows {
            if let Ok(b) = r {
                books.push(b);
            }
        }
        
        // Also fetch progress and sync details for each book
        for book in &mut books {
            if let Ok(Some(p)) = self.get_reading_progress(user_id, &book.id) {
                book.progress = p as f64;
            }
            
            // Try to find the total duration and check if it has audio by reading the sync_map
            if let Ok(points) = self.get_sync_map(user_id, &book.id) {
                if !points.is_empty() {
                    book.has_audio = true;
                    if let Some(last) = points.last() {
                        let ms = last.timestamp_ms;
                        book.duration_ms = Some(ms as f64);
                    }
                }
            } else {
                book.has_audio = false;
            }
        }
        
        Ok(books)
    }
}

