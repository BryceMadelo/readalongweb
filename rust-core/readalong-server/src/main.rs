use axum::{
    Json, Router,
    extract::{Extension, Path as AxumPath, State},
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{get, post, put},
};
use serde::Serialize;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

use tower_governor::{
    GovernorLayer, governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor,
};

mod align;
mod auth;
mod db;
mod import;
mod progress;
mod queue;
mod transcribe;

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

    match tower::ServiceExt::oneshot(tower_http::services::ServeFile::new(&epub_path_str), req)
        .await
    {
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

    match tower::ServiceExt::oneshot(tower_http::services::ServeFile::new(&audio_path_str), req)
        .await
    {
        Ok(res) => res.into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Error serving file").into_response(),
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let db_path_str =
        std::env::var("DB_PATH").unwrap_or_else(|_| "readalong_server.db".to_string());
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
        db::LibraryDb::new(db_path).expect("Failed to initialize database"),
    ));

    let queue = queue::JobQueue::new(db.clone());

    let state = AppState {
        db: db.clone(),
        queue,
        alignment_lock: std::sync::Arc::new(std::sync::Mutex::new(())),
    };

    // Rate limiting configuration for auth routes (e.g., login, signup)
    // Limits to 5 requests per second per IP, burst size of 10.
    // We use SmartIpKeyExtractor to get the IP from X-Forwarded-For or CF-Connecting-IP
    // when running behind a proxy like Cloudflare Tunnel.
    let governor_conf = std::sync::Arc::new(
        GovernorConfigBuilder::default()
            .per_second(5)
            .burst_size(10)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .unwrap(),
    );

    let auth_routes = Router::new()
        .route("/signup", post(auth::handle_signup))
        .route("/login", post(auth::handle_login))
        .layer(tower_governor::GovernorLayer {
            config: governor_conf,
        })
        .route(
            "/me",
            get(auth::handle_me).layer(middleware::from_fn(auth::auth_middleware)),
        )
        .route(
            "/update_profile",
            put(auth::handle_update_profile).layer(middleware::from_fn(auth::auth_middleware)),
        );

    let protected_api_routes = Router::new()
        .route("/books", get(handle_get_books))
        .route(
            "/books/:book_id",
            axum::routing::delete(import::handle_delete_book),
        )
        .route("/books/:book_id/epub", get(handle_download_epub))
        .route("/books/:book_id/audio", get(handle_download_audio))
        .route("/books/:book_id/content", get(import::handle_get_content))
        .route(
            "/books/:book_id/resource/*asset_path",
            get(import::handle_get_resource),
        )
        .route("/import", post(import::handle_import))
        .route("/add_audio/:book_id", post(import::handle_add_audio))
        .route("/status/:book_id", get(import::handle_status))
        .route(
            "/sync_map/:book_id",
            get(import::handle_get_sync_map).post(import::handle_update_sync_map),
        )
        .route("/pause/:book_id", post(import::handle_pause))
        .route("/resume/:book_id", post(import::handle_resume))
        .route("/edit/:book_id", post(import::handle_edit))
        .route(
            "/progress/:book_id",
            get(progress::get_progress).post(progress::update_progress),
        )
        .route("/books/:book_id/favorite", post(import::handle_favorite))
        .route(
            "/books/:book_id/cover",
            post(import::handle_upload_cover).get(import::handle_get_cover),
        )
        .layer(middleware::from_fn(auth::auth_middleware));

    let mut allowed_origins = vec![
        "http://localhost:5173"
            .parse::<axum::http::HeaderValue>()
            .unwrap(),
        "http://localhost:3000"
            .parse::<axum::http::HeaderValue>()
            .unwrap(),
        "http://127.0.0.1:5173"
            .parse::<axum::http::HeaderValue>()
            .unwrap(),
        "http://127.0.0.1:3000"
            .parse::<axum::http::HeaderValue>()
            .unwrap(),
    ];

    if let Ok(domains) = std::env::var("APP_DOMAIN") {
        for domain in domains.split(',') {
            let domain = domain.trim();
            if !domain.is_empty() {
                // Determine if we need to add a scheme
                let origin_str = if domain.starts_with("http://") || domain.starts_with("https://")
                {
                    domain.to_string()
                } else {
                    format!("https://{}", domain)
                };

                if let Ok(header_value) = origin_str.parse::<axum::http::HeaderValue>() {
                    allowed_origins.push(header_value);
                }
            }
        }
    }

    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    let api_router = Router::new()
        .nest("/auth", auth_routes)
        .merge(protected_api_routes);

    let app = Router::new()
        .nest("/api", api_router)
        .fallback_service(
            tower_http::services::ServeDir::new("../web-app/dist").fallback(
                tower_http::services::ServeFile::new("../web-app/dist/index.html"),
            ),
        )
        .with_state(state)
        .layer(cors)
        .layer(axum::middleware::map_response(
            |mut res: axum::response::Response| async {
                res.headers_mut().insert(
                    axum::http::header::HeaderName::from_static("cross-origin-resource-policy"),
                    axum::http::header::HeaderValue::from_static("cross-origin"),
                );
                res
            },
        ))
        .layer(axum::extract::DefaultBodyLimit::max(4 * 1024 * 1024 * 1024));

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
