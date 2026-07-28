use axum::{
    extract::{Request, State, Extension},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use uuid::Uuid;

use crate::AppState;

const JWT_SECRET: &str = "SUPER_SECRET_CHANGE_ME_IN_PROD";

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
}

#[derive(Clone)]
pub struct UserId(pub String);

pub async fn auth_middleware(mut req: Request, next: Next) -> Result<Response, StatusCode> {
    let auth_header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|val| val.to_str().ok());

    if let Some(auth_header) = auth_header {
        if let Some(token) = auth_header.strip_prefix("Bearer ") {
            let mut validation = Validation::default();
            validation.validate_exp = true;
            match decode::<Claims>(
                token,
                &DecodingKey::from_secret(JWT_SECRET.as_bytes()),
                &validation,
            ) {
                Ok(token_data) => {
                    req.extensions_mut().insert(UserId(token_data.claims.sub));
                    return Ok(next.run(req).await);
                }
                Err(_) => return Err(StatusCode::UNAUTHORIZED),
            }
        }
    }
    
    Err(StatusCode::UNAUTHORIZED)
}

#[derive(Deserialize)]
pub struct AuthRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserDto,
}

#[derive(Serialize)]
pub struct UserDto {
    pub id: String,
    pub email: String,
}

pub async fn handle_signup(
    State(app_state): State<AppState>,
    Json(payload): Json<AuthRequest>,
) -> impl IntoResponse {
    let hash = match bcrypt::hash(&payload.password, bcrypt::DEFAULT_COST) {
        Ok(h) => h,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to hash password").into_response(),
    };

    let user_id = Uuid::new_v4().to_string();
    let db_lock = app_state.db.lock().unwrap();

    // Check if user exists
    if db_lock.get_user_by_email(&payload.email).unwrap_or(None).is_some() {
        return (StatusCode::BAD_REQUEST, "Email already in use").into_response();
    }

    match db_lock.create_user(&user_id, &payload.email, &hash) {
        Ok(_) => {
            let claims = Claims {
                sub: user_id.clone(),
                exp: (chrono::Utc::now() + chrono::Duration::days(30)).timestamp() as usize,
            };
            let token = encode(&Header::default(), &claims, &EncodingKey::from_secret(JWT_SECRET.as_bytes())).unwrap();
            
            (StatusCode::OK, Json(AuthResponse {
                token,
                user: UserDto { id: user_id, email: payload.email }
            })).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to create user: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response()
        }
    }
}

pub async fn handle_login(
    State(app_state): State<AppState>,
    Json(payload): Json<AuthRequest>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    
    let user = match db_lock.get_user_by_email(&payload.email) {
        Ok(Some(u)) => u,
        Ok(None) => return (StatusCode::UNAUTHORIZED, "Invalid email or password").into_response(),
        Err(e) => {
            tracing::error!("Database error: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
        }
    };

    if !bcrypt::verify(&payload.password, &user.password_hash).unwrap_or(false) {
        return (StatusCode::UNAUTHORIZED, "Invalid email or password").into_response();
    }

    let claims = Claims {
        sub: user.id.clone(),
        exp: (chrono::Utc::now() + chrono::Duration::days(30)).timestamp() as usize,
    };
    let token = encode(&Header::default(), &claims, &EncodingKey::from_secret(JWT_SECRET.as_bytes())).unwrap();

    (StatusCode::OK, Json(AuthResponse {
        token,
        user: UserDto { id: user.id, email: user.email }
    })).into_response()
}

pub async fn handle_me(
    Extension(user_id): Extension<UserId>,
    State(app_state): State<AppState>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    match db_lock.get_user_by_id(&user_id.0) {
        Ok(Some(u)) => (StatusCode::OK, Json(UserDto { id: u.id, email: u.email })).into_response(),
        _ => (StatusCode::UNAUTHORIZED, "User not found").into_response(),
    }
}

#[derive(Deserialize)]
pub struct UpdateProfileRequest {
    pub email: Option<String>,
    pub current_password: Option<String>,
    pub new_password: Option<String>,
}

pub async fn handle_update_profile(
    Extension(user_id): Extension<UserId>,
    State(app_state): State<AppState>,
    Json(payload): Json<UpdateProfileRequest>,
) -> impl IntoResponse {
    let db_lock = app_state.db.lock().unwrap();
    let user = match db_lock.get_user_by_id(&user_id.0) {
        Ok(Some(u)) => u,
        _ => return (StatusCode::UNAUTHORIZED, "User not found").into_response(),
    };

    if let Some(new_email) = payload.email {
        if new_email != user.email {
            if db_lock.get_user_by_email(&new_email).unwrap_or(None).is_some() {
                return (StatusCode::BAD_REQUEST, "Email already in use").into_response();
            }
            if let Err(e) = db_lock.update_user_email(&user.id, &new_email) {
                tracing::error!("Failed to update email: {}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update email").into_response();
            }
        }
    }

    if let (Some(current_pwd), Some(new_pwd)) = (payload.current_password, payload.new_password) {
        if !bcrypt::verify(&current_pwd, &user.password_hash).unwrap_or(false) {
            return (StatusCode::BAD_REQUEST, "Incorrect current password").into_response();
        }
        let hash = match bcrypt::hash(&new_pwd, bcrypt::DEFAULT_COST) {
            Ok(h) => h,
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to hash password").into_response(),
        };
        if let Err(e) = db_lock.update_user_password(&user.id, &hash) {
            tracing::error!("Failed to update password: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to update password").into_response();
        }
    }

    (StatusCode::OK, "Profile updated").into_response()
}
