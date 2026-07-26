use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};

pub async fn auth_middleware(req: Request, next: Next) -> Result<Response, StatusCode> {
    // Get token (main.rs already ensured it is set on startup)
    let expected_token = std::env::var("API_TOKEN").expect("API_TOKEN must be set");

    // Check Authorization header
    let auth_header = req.headers().get(axum::http::header::AUTHORIZATION)
        .and_then(|val| val.to_str().ok());

    match auth_header {
        Some(header) if header == format!("Bearer {}", expected_token) => {
            Ok(next.run(req).await)
        }
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}
