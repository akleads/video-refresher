FROM node:22-slim

# Install FFmpeg (needed for Phase 7, install now to verify Docker works)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set TMPDIR to volume path (avoid /tmp RAM disk on Fly.io)
ENV TMPDIR=/data/tmp

WORKDIR /app

# Copy package files and install dependencies
COPY server/package.json server/package-lock.json ./
RUN npm ci --production

# Copy server code
COPY server/ .

# Verify FFmpeg is accessible
RUN ffmpeg -version > /dev/null 2>&1

EXPOSE 8080

CMD ["node", "index.js"]
