FROM rust:1.80-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    cmake \
    build-essential \
    clang \
    wget \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the entire workspace
COPY Cargo.toml Cargo.lock ./
COPY rust-core ./rust-core

# Build the server crate
RUN cargo build --release --bin readalong-server --manifest-path rust-core/Cargo.toml

# Download the whisper model during build to embed it in the image
RUN mkdir -p /models && \
    wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin -O /models/ggml-small.en.bin

FROM debian:bookworm-slim

# Install runtime dependencies (ffmpeg, openssl, etc)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary and model
COPY --from=builder /app/rust-core/target/release/readalong-server /app/readalong-server
COPY --from=builder /models /models

# Create a volume for the database and uploads
VOLUME /app/data
ENV DB_PATH=/app/data/readalong_server.db

# Expose the API port
EXPOSE 3000

# Run the server
CMD ["./readalong-server"]
