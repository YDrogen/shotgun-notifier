# syntax=docker/dockerfile:1

FROM oven/bun:slim

# Install system dependencies required for Playwright + Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm-dev \
    libxkbcommon-dev \
    libgbm-dev \
    libasound-dev \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    libgtk-3-0 \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libu2f-udev \
    libvulkan1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install tini for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files first for layer caching
COPY package.json bun.lock ./

# Install Node.js dependencies
RUN bun install --frozen-lockfile

# Install Playwright browsers (Chromium only) with system deps
ENV PLAYWRIGHT_BROWSERS_PATH=0
RUN bunx playwright install chromium

# Copy source code
COPY . .

# Use tini as init system to properly forward SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["bun", "run", "src/index.ts", "--config", "/app/config.json"]
