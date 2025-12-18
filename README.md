# 🌸 Blossom-server

blossom-server is a Typescript implementation of a [Blossom Server](https://github.com/hzrd149/blossom/blob/master/Server.md)

## Supported BUDs

- [x] BUD-01
- [x] BUD-02
- [ ] ~~BUD~03~~ N/A
- [x] BUD-04
- [x] BUD-05
- [x] BUD-06
- [ ] BUD-08

## Running with npx

This app is also packaged as an npm module which you can easily run

```sh
# copy the example config
wget https://raw.githubusercontent.com/hzrd149/blossom-server/master/config.example.yml -O config.yml
# run using npx
npx @nostria/media-server
```

## Running with docker

An example config file can be found [here](./config.example.yml)

```sh
# create data volume
docker volume create blossom_data
# run container
docker run -v blossom_data:/app/data -v $(pwd)/config.yml:/app/config.yml -p 3000:3000 ghcr.io/hzrd149/blossom-server:master
```

You can also run it using docker compose with the [`docker-compose.yml`](./docker-compose.yml) file

## Running from source

This project uses [pnpm](https://pnpm.io/) to manage dependencies. It needs to be installed first in order to build the app

Next clone the repo, install the dependencies, and build

```sh
git clone https://github.com/hzrd149/blossom-server.git
cd blossom-server
pnpm install
cd admin && pnpm install && cd ../
pnpm build
```

Next copy the config and modify it

```sh
cp config.example.yml config.yml
nano config.yml
```

And finally start the app

```sh
pnpm start
# or
node .
```

Once the server is running you can open `http://localhost:3000` to access the server

## FFmpeg Requirements

The media optimization features (video transcoding, format conversion) require FFmpeg to be installed.

### Docker

When running with Docker, FFmpeg 8.0.1 is built from source and included in the image with the following codecs:
- **Video**: libx264, libx265, libvpx (VP8/VP9)
- **Audio**: opus, mp3 (lame), vorbis, AAC (fdk-aac)

### Running from source

When running from source, you need to install FFmpeg separately:

**Windows:**
Download from [FFmpeg Builds](https://github.com/BtbN/FFmpeg-Builds/releases) and add to PATH.

**macOS:**
```sh
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**
```sh
sudo apt install ffmpeg
```

**Linux (Alpine):**
```sh
apk add ffmpeg
```

For security-critical deployments, FFmpeg 8.0.1 or later is recommended as it includes important security fixes.
