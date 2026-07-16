# Postgres dual-write

When `DATABASE_URL` is set, OpenMarket:

1. Loads state from Postgres `om_kv` table if present (preferred over empty local)
2. Dual-writes every persist to **file** + **Postgres**

```bash
# .env.local
DATABASE_URL=postgres://user:pass@host:5432/openmarket

# optional: apply full relational schema later
psql $DATABASE_URL -f docs/schema.sql
```

The blob key is `openmarket_state_v1` in `om_kv` (auto-created).

File store remains default (no DATABASE_URL) — ideal for single-node VPS.
