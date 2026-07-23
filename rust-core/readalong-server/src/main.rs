use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

mod import;
mod transcribe;
mod align;
mod db;

#[tokio::main]
async fn main() {
    // Initialize standard tracing/logging
    tracing_subscriber::fmt::init();

    let db_path_str = std::env::var("DB_PATH").unwrap_or_else(|_| "readalong_server.db".to_string());
    let db_path = std::path::Path::new(&db_path_str);

    // Create a temporary directory for uploads if it doesn't exist, relative to db path to use mounted volume
    let data_dir = db_path.parent().unwrap_or(std::path::Path::new("."));
    let tmp_dir = data_dir.join("tmp_uploads");
    if !tmp_dir.exists() {
        std::fs::create_dir_all(&tmp_dir).expect("Failed to create tmp_uploads directory");
    }

    // Pass the data_dir via environment so import.rs knows where to save
    unsafe {
        std::env::set_var("DATA_DIR", data_dir.to_str().unwrap_or("."));
    }

    let db = std::sync::Arc::new(std::sync::Mutex::new(
        db::LibraryDb::new(db_path).expect("Failed to initialize database")
    ));

    let app = Router::new()
        .route("/", get(|| async { "ReadAlong Server is running" }))
        .route("/import", post(import::handle_import))
        .route("/status/:book_id", get(import::handle_status))
        .route("/sync_map/:book_id", post(import::handle_update_sync_map))
        .with_state(db.clone())
        .layer(CorsLayer::permissive())
        .layer(axum::extract::DefaultBodyLimit::max(4 * 1024 * 1024 * 1024)); // 4GB limit

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
