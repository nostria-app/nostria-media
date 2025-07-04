# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm i -g pnpm

WORKDIR /app
COPY . .

FROM base AS node-gyp
# Install required packages for node-gyp
RUN apk add --no-cache python3 make g++ py3-pip

FROM node-gyp AS prod-deps
# Install ffmpeg with comprehensive codec support for video transcoding
# This includes libvpx for VP8/VP9 support and other essential codecs
RUN apk add --no-cache \
    ffmpeg \
    ffmpeg-libs \
    libvpx \
    x264-libs \
    x265-libs \
    opus \
    vorbis-tools \
    lame
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM prod-deps AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN --mount=type=cache,id=pnpm,target=/pnpm/store cd admin && pnpm install --frozen-lockfile
RUN pnpm build
RUN cd admin && pnpm build

FROM base AS main
# Install ffmpeg with comprehensive codec support for video transcoding in the final image
# This includes libvpx for VP8/VP9 support and other essential codecs
RUN apk add --no-cache \
    ffmpeg \
    ffmpeg-libs \
    libvpx \
    x264-libs \
    x265-libs \
    opus \
    vorbis-tools \
    lame
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build ./app/build ./build
COPY --from=build ./app/admin/dist ./admin/dist

COPY ./public ./public

VOLUME [ "/app/data" ]
EXPOSE 3000

ENV DEBUG="blossom-server,blossom-server:*"

ENTRYPOINT [ "node", "." ]
