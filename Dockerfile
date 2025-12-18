# syntax=docker/dockerfile:1

# ============================================================================
# FFmpeg 8.0.1 Build Stage
# Builds ffmpeg from source with security fixes and comprehensive codec support
# ============================================================================
FROM alpine:3.21 AS ffmpeg-builder

# FFmpeg version with important security fixes
ENV FFMPEG_VERSION=8.0.1

# Install build dependencies
RUN apk add --no-cache \
    build-base \
    pkgconf \
    nasm \
    yasm \
    curl \
    tar \
    xz \
    # Codec development libraries
    x264-dev \
    x265-dev \
    libvpx-dev \
    opus-dev \
    lame-dev \
    libvorbis-dev \
    libtheora-dev \
    # Additional dependencies
    freetype-dev \
    fdk-aac-dev \
    # SSL/TLS support
    openssl-dev \
    # Other useful libraries
    zlib-dev

# Download and extract FFmpeg source
WORKDIR /tmp
RUN curl -fsSL https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz -o ffmpeg.tar.xz && \
    tar -xf ffmpeg.tar.xz && \
    rm ffmpeg.tar.xz

# Configure and build FFmpeg
WORKDIR /tmp/ffmpeg-${FFMPEG_VERSION}
RUN ./configure \
    --prefix=/usr/local \
    --enable-gpl \
    --enable-nonfree \
    --enable-version3 \
    --enable-small \
    --enable-libx264 \
    --enable-libx265 \
    --enable-libvpx \
    --enable-libopus \
    --enable-libmp3lame \
    --enable-libvorbis \
    --enable-libtheora \
    --enable-libfdk-aac \
    --enable-openssl \
    --disable-debug \
    --disable-doc \
    --disable-ffplay \
    --disable-static \
    --enable-shared && \
    make -j$(nproc) && \
    make install

# ============================================================================
# Node.js Base Stage
# ============================================================================
FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm i -g pnpm

WORKDIR /app
COPY . .

# ============================================================================
# Node-gyp Build Stage
# ============================================================================
FROM base AS node-gyp
# Install required packages for node-gyp
RUN apk add --no-cache python3 make g++ py3-pip

# ============================================================================
# Production Dependencies Stage
# ============================================================================
FROM node-gyp AS prod-deps
# Install runtime libraries needed for ffmpeg (shared libraries only)
RUN apk add --no-cache \
    x264-libs \
    x265-libs \
    libvpx \
    opus \
    lame-libs \
    libvorbis \
    libtheora \
    fdk-aac \
    openssl \
    freetype \
    zlib

# Copy built ffmpeg binaries and libraries from builder
COPY --from=ffmpeg-builder /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-builder /usr/local/bin/ffprobe /usr/local/bin/ffprobe
COPY --from=ffmpeg-builder /usr/local/lib/libav* /usr/local/lib/
COPY --from=ffmpeg-builder /usr/local/lib/libsw* /usr/local/lib/
COPY --from=ffmpeg-builder /usr/local/lib/libpostproc* /usr/local/lib/

# Update library cache
RUN ldconfig /usr/local/lib || true

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

# ============================================================================
# Build Stage
# ============================================================================
FROM prod-deps AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN --mount=type=cache,id=pnpm,target=/pnpm/store cd admin && pnpm install --frozen-lockfile
RUN pnpm build
RUN cd admin && pnpm build

# ============================================================================
# Final Production Image
# ============================================================================
FROM base AS main

# Install runtime libraries needed for ffmpeg 8.0.1 (shared libraries only)
RUN apk add --no-cache \
    x264-libs \
    x265-libs \
    libvpx \
    opus \
    lame-libs \
    libvorbis \
    libtheora \
    fdk-aac \
    openssl \
    freetype \
    zlib

# Copy built ffmpeg 8.0.1 binaries and libraries from builder
COPY --from=ffmpeg-builder /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-builder /usr/local/bin/ffprobe /usr/local/bin/ffprobe
COPY --from=ffmpeg-builder /usr/local/lib/libav* /usr/local/lib/
COPY --from=ffmpeg-builder /usr/local/lib/libsw* /usr/local/lib/
COPY --from=ffmpeg-builder /usr/local/lib/libpostproc* /usr/local/lib/

# Update library cache
RUN ldconfig /usr/local/lib || true

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build ./app/build ./build
COPY --from=build ./app/admin/dist ./admin/dist

COPY ./public ./public

VOLUME [ "/app/data" ]
EXPOSE 3000

ENV DEBUG="blossom-server,blossom-server:*"

ENTRYPOINT [ "node", "." ]
