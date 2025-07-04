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
# Install ffmpeg for video transcoding
RUN apk add --no-cache ffmpeg
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM prod-deps AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN --mount=type=cache,id=pnpm,target=/pnpm/store cd admin && pnpm install --frozen-lockfile
RUN pnpm build
RUN cd admin && pnpm build

FROM base AS main
# Install ffmpeg for video transcoding in the final image
RUN apk add --no-cache ffmpeg
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build ./app/build ./build
COPY --from=build ./app/admin/dist ./admin/dist

COPY ./public ./public

VOLUME [ "/app/data" ]
EXPOSE 3000

ENV DEBUG="blossom-server,blossom-server:*"

ENTRYPOINT [ "node", "." ]
