use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use crate::db::LibraryDb;
use tokio::sync::Notify;

pub struct JobQueue {
    pub jobs: Mutex<VecDeque<String>>,
    pub notify: Notify,
    pub db: Arc<Mutex<LibraryDb>>,
}

impl JobQueue {
    pub fn new(db: Arc<Mutex<LibraryDb>>) -> Arc<Self> {
        let queue = Arc::new(Self {
            jobs: Mutex::new(VecDeque::new()),
            notify: Notify::new(),
            db: db.clone(),
        });

        let worker_queue = queue.clone();
        tokio::spawn(async move {
            worker_queue.worker_loop().await;
        });

        queue
    }

    pub fn add_job(&self, book_id: String) {
        let mut jobs = self.jobs.lock().unwrap();
        if !jobs.contains(&book_id) {
            jobs.push_back(book_id.clone());
            let pos = jobs.len();
            if let Ok(db_lock) = self.db.lock() {
                let _ = db_lock.update_book_status(&book_id, &format!("Queued (Position: {})", pos));
            }
            self.notify.notify_one();
        }
    }

    pub fn remove_job(&self, book_id: &str) -> bool {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(pos) = jobs.iter().position(|id| id == book_id) {
            jobs.remove(pos);
            self.update_queued_statuses(&jobs);
            return true;
        }
        false
    }

    fn update_queued_statuses(&self, jobs: &VecDeque<String>) {
        if let Ok(db_lock) = self.db.lock() {
            for (i, id) in jobs.iter().enumerate() {
                let _ = db_lock.update_book_status(id, &format!("Queued (Position: {})", i + 1));
            }
        }
    }

    pub fn get_position(&self, book_id: &str) -> Option<usize> {
        let jobs = self.jobs.lock().unwrap();
        jobs.iter().position(|id| id == book_id).map(|p| p + 1)
    }

    async fn worker_loop(&self) {
        loop {
            let next_job = {
                let mut jobs = self.jobs.lock().unwrap();
                jobs.pop_front()
            };

            if let Some(book_id) = next_job {
                {
                    let jobs = self.jobs.lock().unwrap();
                    self.update_queued_statuses(&jobs);
                }

                // Signal that this job is now starting processing
                if let Ok(db_lock) = self.db.lock() {
                    let _ = db_lock.update_book_status(&book_id, "Processing|0|0");
                }

                // Wait for the actual work to complete by monitoring the status.
                // The actual processing task is spawned in import.rs and runs concurrently.
                // This worker just holds the "lock" for one job at a time.
                let mut is_done = false;
                while !is_done {
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    if let Ok(db_lock) = self.db.lock() {
                        if let Ok(status) = db_lock.get_book_status(&book_id) {
                            if status == "Processed Book" || status.starts_with("Error") || status == "Paused" {
                                is_done = true;
                            }
                        } else {
                            // Book deleted?
                            is_done = true;
                        }
                    }
                }
            } else {
                self.notify.notified().await;
            }
        }
    }
}
