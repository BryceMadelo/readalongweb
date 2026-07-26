use readalong_core::sync::SyncPoint;
use rusqlite::{params, Connection, Result};
use std::path::Path;

pub struct LibraryDb {
    conn: Connection,
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
            "CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                epub_path TEXT NOT NULL,
                audio_path TEXT NOT NULL,
                date_added INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'Unknown',
                user_id TEXT NOT NULL DEFAULT 'default_user'
            )",
            [],
        )?;

        // Try to add the column if the table already exists (for backwards compatibility)
        let _ = self.conn.execute("ALTER TABLE books ADD COLUMN status TEXT NOT NULL DEFAULT 'Unknown'", []);
        let _ = self.conn.execute("ALTER TABLE books ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default_user'", []);

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

        // Default user for now, prepares for real user_id
        let user_id = "default_user";

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

    pub fn update_book_meta(&self, book_id: &str, title: &str, author: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET title = ?2, author = ?3 WHERE id = ?1",
            params![book_id, title, author],
        )?;
        Ok(())
    }

    pub fn save_sync_map(&self, book_id: &str, points: &[SyncPoint]) -> Result<()> {
        let json = serde_json::to_string(points).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })?;

        // Default user for now, prepares for real user_id
        let user_id = "default_user";

        self.conn.execute(
            "INSERT INTO sync_maps (book_id, points_json, user_id)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(book_id) DO UPDATE SET
             points_json=excluded.points_json, user_id=excluded.user_id",
            params![book_id, json, user_id],
        )?;

        Ok(())
    }

    pub fn get_sync_map(&self, book_id: &str) -> Result<Vec<SyncPoint>> {
        let mut stmt = self.conn.prepare("SELECT points_json FROM sync_maps WHERE book_id = ?1")?;
        let json: String = stmt.query_row(params![book_id], |row| row.get(0))?;

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

    pub fn get_book_paths(&self, book_id: &str) -> Result<(String, String)> {
        let mut stmt = self.conn.prepare("SELECT epub_path, audio_path FROM books WHERE id = ?1")?;
        let paths = stmt.query_row(params![book_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        Ok(paths)
    }
}
