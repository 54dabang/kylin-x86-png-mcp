FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=7003 \
    HOST=0.0.0.0 \
    CHARTS_DIR=/app/charts \
    npm_config_build_from_source=true \
    npm_config_foreground_scripts=true

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      librsvg2-bin \
      fontconfig \
      fonts-wqy-microhei \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV IMAGE_TTL_HOURS=24 \
    CLEANUP_INTERVAL_MINUTES=60

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/charts \
    && node scripts/smoke-render.js \
    && rm -f /app/charts/smoke_bar_chart_*.svg /app/charts/smoke_bar_chart_*.png

EXPOSE 7003
CMD ["node", "src/index.js", "--transport", "sse", "--port", "7003"]
