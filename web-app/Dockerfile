# Stage 1: Build Frontend
FROM node:20 AS frontend-builder
WORKDIR /app
COPY rust-core/readalong-wasm/pkg ./rust-core/readalong-wasm/pkg
COPY web-app/package*.json ./web-app/
WORKDIR /app/web-app
RUN npm install
COPY web-app/ ./
RUN npx vite build

# Stage 2: Build Backend
FROM nvidia/cuda:12.2.2-devel-ubuntu22.04 as backend-builder

ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    cmake \
    build-essential \
    clang \
    wget \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app
COPY rust-core/ ./rust-core/

# Build the server crate with CUDA feature enabled
RUN cargo build --release --bin readalong-server --manifest-path rust-core/Cargo.toml --features cuda

# Download the whisper model during build to embed it in the image
RUN mkdir -p /models && \
    wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin -O /models/ggml-small.en.bin

# Stage 3: Runtime
FROM nvidia/cuda:12.2.2-runtime-ubuntu22.04

# Install runtime dependencies (ffmpeg, openssl, etc)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary and model
COPY --from=backend-builder /app/rust-core/target/release/readalong-server /app/readalong-server
COPY --from=backend-builder /models /models

# Copy the frontend build to /web-app/dist because rust server serves from ../web-app/dist
COPY --from=frontend-builder /app/web-app/dist /web-app/dist

# Create a volume for the database and uploads
VOLUME /app/data
ENV DB_PATH=/app/data/readalong_server.db

# Expose the API port
EXPOSE 3000

# Run the server
CMD ["./readalong-server"]