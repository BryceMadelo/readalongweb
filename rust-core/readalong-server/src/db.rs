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
        Ok(db)
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
                status TEXT NOT NULL DEFAULT 'Unknown'
            )",
            [],
        )?;

        // Try to add the column if the table already exists (for backwards compatibility)
        let _ = self.conn.execute("ALTER TABLE books ADD COLUMN status TEXT NOT NULL DEFAULT 'Unknown'", []);

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_maps (
                book_id TEXT PRIMARY KEY,
                points_json TEXT NOT NULL
            )",
            [],
        )?;

        Ok(())
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

        self.conn.execute(
            "INSERT INTO books (id, title, author, epub_path, audio_path, date_added, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
             title=excluded.title, author=excluded.author, epub_path=excluded.epub_path, audio_path=excluded.audio_path, status=excluded.status",
            params![id, title, author, epub_path, audio_path, now, status],
        )?;

        Ok(())
    }

    pub fn save_sync_map(&self, book_id: &str, points: &[SyncPoint]) -> Result<()> {
        let json = serde_json::to_string(points).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })?;

        self.conn.execute(
            "INSERT INTO sync_maps (book_id, points_json)
             VALUES (?1, ?2)
             ON CONFLICT(book_id) DO UPDATE SET
             points_json=excluded.points_json",
            params![book_id, json],
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
}
