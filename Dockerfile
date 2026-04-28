# ============================================================
# Trading Signal Bot — VPS Docker Image
# Node 20 base, production-ready with health checks
# ============================================================

FROM node:20-slim

# Install system deps for Playwright + PM2
RUN apt-get update && apt-get install -y \
    libnss3 libatk-bridge2.0-0 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pm2

# Create app directory
WORKDIR /app

# Copy dependency manifests first (for layer caching)
COPY package.json ./

# Install dependencies (clean install for production)
RUN npm install --production

# Install Playwright browsers
RUN npx playwright install chromium

# Copy application code
COPY api/ ./api/
COPY lib/ ./lib/
COPY crawler/ ./crawler/
COPY workers/ ./workers/
COPY supabase/ ./supabase/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY server.js ./
COPY ecosystem.config.cjs ./
COPY vercel.json ./

# Expose the application port
EXPOSE 3000

# Health check every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/debug').then(r => { if (!r.ok) throw new Error('unhealthy'); process.exit(0); }).catch(() => process.exit(1))"

# Start with PM2 in no-daemon mode so Docker stays alive
CMD ["pm2-runtime", "ecosystem.config.cjs"]
