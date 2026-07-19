# OpenMarket.ai — production-hardened container
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
RUN npm install -D vitest

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV OM_DATA_DIR=/data
ENV PORT=3000

# Security: non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Install only production deps
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/contracts ./contracts

RUN mkdir -p /data && chown -R nextjs:nodejs /data /app

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

# Health check: hit /api/v1/health every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
