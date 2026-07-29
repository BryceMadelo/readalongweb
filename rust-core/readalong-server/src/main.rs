use axum::{
    routing::{get, post, put},
    Router,
    middleware,
    extract::{State, Path as AxumPath, Extension},
    response::IntoResponse,
    http::{StatusCode, header},
    Json,
};
use serde::Serialize;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use axum::body::Body;

mod import;
mod transcribe;
mod align;
mod db;
mod auth;
mod progress;
mod queue;

#[derive(Clone)]
pub struct AppState {
    pub db: std::sync::Arc<std::sync::Mutex<db::LibraryDb>>,
    pub queue: std::sync::Arc<queue::JobQueue>,
    pub alignment_lock: std::sync::Arc<std::sync::Mutex<()>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookMeta {
    pub id: String,
    pub title: String,
    pub author: String,
    pub date_added: i64,
    pub progress: f64,
    pub is_favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
    pub has_audio: bool,
}

async fn handle_get_books(
    Extension(user_id): Extension<auth::UserId>,
    State(app_state): State<AppState>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    match db_lock.get_books_for_user(&user_id.0) {
        Ok(books) => (StatusCode::OK, Json(books)).into_response(),
        Err(e) => {
            tracing::error!("Failed to get books: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response()
        }
    }
}

async fn handle_download_epub(
    Extension(user_id): Extension<auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
    req: axum::extract::Request,
) -> impl IntoResponse {
    let epub_path_str = {
        let db_lock = app_state.db.lock().unwrap();
        match db_lock.get_book_paths(&user_id.0, &book_id) {
            Ok((epub, _)) => epub,
            Err(_) => return (StatusCode::NOT_FOUND, "Book not found").into_response(),
        }
    };

    match tower::ServiceExt::oneshot(tower_http::services::ServeFile::new(&epub_path_str), req).await {
        Ok(res) => res.into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Error serving file").into_response(),
    }
}

async fn handle_download_audio(
    Extension(user_id): Extension<auth::UserId>,
    State(app_state): State<AppState>,
    AxumPath(book_id): AxumPath<String>,
    req: axum::extract::Request,
) -> impl IntoResponse {
    let audio_path_str = {
        let db_lock = app_state.db.lock().unwrap();
        match db_lock.get_book_paths(&user_id.0, &book_id) {
            Ok((_, audio)) => audio,
            Err(_) => return (StatusCode::NOT_FOUND, "Book not found").into_response(),
        }
    };

    if audio_path_str.is_empty() {
        return (StatusCode::NOT_FOUND, "No audio file for this book").into_response();
    }

    match tower::ServiceExt::oneshot(tower_http::services::ServeFile::new(&audio_path_str), req).await {
        Ok(res) => res.into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Error serving file").into_response(),
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let db_path_str = std::env::var("DB_PATH").unwrap_or_else(|_| "readalong_server.db".to_string());
    let db_path = std::path::Path::new(&db_path_str);

    let data_dir = db_path.parent().unwrap_or(std::path::Path::new("."));
    let tmp_dir = data_dir.join("tmp_uploads");
    if !tmp_dir.exists() {
        std::fs::create_dir_all(&tmp_dir).expect("Failed to create tmp_uploads directory");
    }

    unsafe {
        std::env::set_var("DATA_DIR", data_dir.to_str().unwrap_or("."));
    }

    let db = std::sync::Arc::new(std::sync::Mutex::new(
        db::LibraryDb::new(db_path).expect("Failed to initialize database")
    ));

    let queue = queue::JobQueue::new(db.clone());

    let state = AppState {
        db: db.clone(),
        queue,
        alignment_lock: std::sync::Arc::new(std::sync::Mutex::new(())),
    };

    let auth_routes = Router::new()
        .route("/signup", post(auth::handle_signup))
        .route("/login", post(auth::handle_login))
        .route("/me", get(auth::handle_me).layer(middleware::from_fn(auth::auth_middleware)))
        .route("/update_profile", put(auth::handle_update_profile).layer(middleware::from_fn(auth::auth_middleware)));

    let protected_api_routes = Router::new()
        .route("/books", get(handle_get_books))
        .route("/books/:book_id", axum::routing::delete(import::handle_delete_book))
        .route("/books/:book_id/epub", get(handle_download_epub))
        .route("/books/:book_id/audio", get(handle_download_audio))
        .route("/import", post(import::handle_import))
        .route("/add_audio/:book_id", post(import::handle_add_audio))
        .route("/status/:book_id", get(import::handle_status))
        .route("/sync_map/:book_id", get(import::handle_get_sync_map).post(import::handle_update_sync_map))
        .route("/pause/:book_id", post(import::handle_pause))
        .route("/resume/:book_id", post(import::handle_resume))
        .route("/edit/:book_id", post(import::handle_edit))
        .route("/progress/:book_id", get(progress::get_progress).post(progress::update_progress))
        .route("/books/:book_id/favorite", post(import::handle_favorite))
        .route("/books/:book_id/cover", post(import::handle_upload_cover).get(import::handle_get_cover))
        .layer(middleware::from_fn(auth::auth_middleware));

    let app = Router::new()
        .route("/", get(|| async { "ReadAlong Server is running" }))
        .nest("/api/auth", auth_routes)
        .nest("/api", protected_api_routes)
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(axum::middleware::map_response(|mut res: axum::response::Response| async {
            res.headers_mut().insert(
                axum::http::header::HeaderName::from_static("cross-origin-resource-policy"),
                axum::http::header::HeaderValue::from_static("cross-origin"),
            );
            res
        }))
        .layer(axum::extract::DefaultBodyLimit::max(4 * 1024 * 1024 * 1024));

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
