use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use crate::AppState;

#[derive(Serialize)]
pub struct ProgressResponse {
    pub progress_ms: Option<u64>,
}

#[derive(Deserialize)]
pub struct ProgressUpdate {
    pub progress_ms: u64,
}

pub async fn get_progress(
    State(state): State<AppState>,
    Path(book_id): Path<String>,
) -> Result<Json<ProgressResponse>, StatusCode> {
    let db_lock = state.db.lock().unwrap();
    // Default user for now as we prep multi-user
    match db_lock.get_reading_progress("default_user", &book_id) {
        Ok(progress_ms) => Ok(Json(ProgressResponse { progress_ms })),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

pub async fn update_progress(
    State(state): State<AppState>,
    Path(book_id): Path<String>,
    Json(payload): Json<ProgressUpdate>,
) -> Result<StatusCode, StatusCode> {
    let db_lock = state.db.lock().unwrap();
    // Default user for now as we prep multi-user
    match db_lock.save_reading_progress("default_user", &book_id, payload.progress_ms) {
        Ok(_) => Ok(StatusCode::OK),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}
