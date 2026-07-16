# Public / VPS deploy checklist

## Current VPS smoke (this Hostinger box)

```bash
cd /root/projects/openmarket-ai
npm run build
ALLOW_DEV_FAKE_SETTLEMENT=true NEXT_PUBLIC_SITE_URL=http://YOUR_IP:3010 \
  npm run start -- -H 0.0.0.0 -p 3010
```

Open firewall (if ufw):

```bash
ufw allow 3010/tcp
# or 80/443 with nginx
```

## Domain (openmarket.ai)

1. DNS A record → VPS public IP  
2. Install nginx + certbot  
3. Copy `deploy/nginx.openmarket.conf` → sites-enabled  
4. `certbot --nginx -d openmarket.ai -d www.openmarket.ai`  
5. Env:

```bash
NEXT_PUBLIC_SITE_URL=https://openmarket.ai
ALLOW_DEV_FAKE_SETTLEMENT=false
STRICT_SETTLEMENT=true
HEDERA_OPERATOR_ID=0.0.x
USDC_TOKEN_ID=0.0.x   # when ready
```

6. `bash deploy/vps-start.sh`

## Health

```bash
curl -s https://openmarket.ai/api/v1/health | jq .
curl -s https://openmarket.ai/.well-known/openmarket.json | jq .
```

## Agent discovery after public

- `https://openmarket.ai/llms.txt`
- `https://openmarket.ai/openapi.json`
- Submit market card to agent registries / GitHub topic `openmarket-agent`
