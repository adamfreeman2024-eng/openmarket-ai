# Deploy OpenMarket.ai

## Option A — Vercel (fast preview)

```bash
cd openmarket-ai
npx vercel
# set env in dashboard:
# ALLOW_DEV_FAKE_SETTLEMENT=false   # production
# HEDERA_OPERATOR_ID / KEY
# NEXT_PUBLIC_SITE_URL=https://your-app.vercel.app
# PLATFORM_FEE_BPS=200
# OM_DATA_DIR=/tmp/openmarket-data   # note: ephemeral on serverless — use Postgres next
```

**Warning:** File store is **not** ideal on serverless multi-instance. Use for demo only, then Postgres.

## Option B — Hostinger VPS / Node (recommended for durable file store)

```bash
git clone https://github.com/adamfreeman2024-eng/openmarket-ai.git
cd openmarket-ai
cp .env.example .env.local
# edit env — ALLOW_DEV_FAKE_SETTLEMENT=false in prod
npm ci
npm run build
# pm2
npx pm2 start npm --name openmarket -- start
# nginx proxy → localhost:3000
```

Set `OM_DATA_DIR=/var/lib/openmarket` and ensure write permissions.

## Option C — Docker (later)

```dockerfile
# forthcoming — Node 20 alpine, volume for /data
```

## Smoke after deploy

```bash
curl -s https://YOUR_HOST/api/v1/health | jq .
curl -s https://YOUR_HOST/.well-known/openmarket.json | jq .
BASE_URL=https://YOUR_HOST npm run smoke
```

## Domain

Point `openmarket.ai` (or subdomain) DNS → host.  
Update `NEXT_PUBLIC_SITE_URL` to the public URL so market card links are correct.
