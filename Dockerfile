# syntax=docker/dockerfile:1

# ============================================================================
# FFmpeg Static Binary Stage
# Downloads pre-built static FFmpeg snapshot binaries from martin-riedl.de
# ============================================================================
FROM debian:bookworm-slim AS ffmpeg-downloader

# Download static FFmpeg snapshot build from martin-riedl.de
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates && \
    mkdir -p /tmp/ffmpeg && \
    curl -fsSL https://ffmpeg.martin-riedl.de/redirect/latest/linux/amd64/snapshot/ffmpeg.zip -o /tmp/ffmpeg.zip && \
    curl -fsSL https://ffmpeg.martin-riedl.de/redirect/latest/linux/amd64/snapshot/ffprobe.zip -o /tmp/ffprobe.zip && \
    unzip /tmp/ffmpeg.zip -d /tmp/ffmpeg && \
    unzip /tmp/ffprobe.zip -d /tmp/ffmpeg && \
    mv /tmp/ffmpeg/ffmpeg /usr/local/bin/ffmpeg && \
    mv /tmp/ffmpeg/ffprobe /usr/local/bin/ffprobe && \
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe && \
    rm -rf /tmp/ffmpeg /tmp/*.zip && \
    # Verify it works
    /usr/local/bin/ffmpeg -version

# ============================================================================
# Node.js Base Stage (Debian-based for glibc compatibility)
# ============================================================================
FROM node:22-slim AS base

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
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# ============================================================================
# Production Dependencies Stage
# ============================================================================
FROM node-gyp AS prod-deps

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

# Copy FFmpeg binaries
COPY --from=ffmpeg-downloader /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-downloader /usr/local/bin/ffprobe /usr/local/bin/ffprobe

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build ./app/build ./build
COPY --from=build ./app/admin/dist ./admin/dist

COPY ./public ./public

VOLUME [ "/app/data" ]
EXPOSE 3000

ENV DEBUG="blossom-server,blossom-server:*"

ENTRYPOINT [ "node", "." ]
