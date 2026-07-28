use axum::{
    Json,
    extract::{State, Path as AxumPath, Extension},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Serialize)]
pub struct ProgressResponse {
    pub progress_ms: u64,
}

#[derive(Deserialize)]
pub struct ProgressRequest {
    pub progress_ms: u64,
}

pub async fn get_progress(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    match db_lock.get_reading_progress(&user_id.0, &book_id) {
        Ok(Some(ms)) => (StatusCode::OK, Json(ProgressResponse { progress_ms: ms })).into_response(),
        Ok(None) => (StatusCode::OK, Json(ProgressResponse { progress_ms: 0 })).into_response(),
        Err(e) => {
            tracing::error!("Failed to get progress: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response()
        }
    }
}

pub async fn update_progress(
    Extension(user_id): Extension<crate::auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
    Json(payload): Json<ProgressRequest>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    if let Err(e) = db_lock.save_reading_progress(&user_id.0, &book_id, payload.progress_ms) {
        tracing::error!("Failed to save progress: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
    }
    (StatusCode::OK, "Progress saved").into_response()
}
