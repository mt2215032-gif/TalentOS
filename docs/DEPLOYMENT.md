# Deployment

## Vercel + Supabase (recommended)

### 1. Database

Create a Supabase project, then apply migrations from your machine — Vercel's build step should not
run them, because a failed migration must not be able to take a deployment down with it.

```bash
export DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres'
export DATABASE_SSL=require
npm run db:migrate
```

Use the **pooled** connection string (port 6543). The direct connection (5432) exhausts its
connection limit under serverless, where each instance opens its own pool.

Neon, RDS or any PostgreSQL 14+ works identically — nothing in the schema is Supabase-specific.

### 2. Environment

```bash
vercel link

vercel env add DATABASE_URL production        # pooled string
vercel env add DATABASE_SSL production        # require
vercel env add DATABASE_POOL_MAX production   # 5
vercel env add AUTH_SECRET production         # node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
vercel env add APP_URL production             # https://your-domain
vercel env add AI_PROVIDER production         # anthropic
vercel env add ANTHROPIC_API_KEY production
vercel env add RATE_LIMIT_BACKEND production  # postgres
vercel env add ADMIN_EMAILS production        # you@example.com
vercel env add AI_MAX_COST_PER_INTERVIEW_USD production
```

Repeat for `preview` if you want preview deployments working — point them at a **separate**
database, since previews should never write to production data.

### 3. Deploy

```bash
vercel --prod
```

`vercel.json` raises `maxDuration` for the routes that call an LLM. Interview turns and report
generation exceed the default budget; without this they time out mid-interview.

### 4. Verify

```bash
curl https://your-domain/api/health
```

Expect `status: "ok"`, `database.ok: true`, and `engine.mode: "llm"`.

If it reports `offline_heuristic`, the provider key did not reach the runtime. Vercel does not apply
new environment variables to existing deployments — redeploy after adding them.

Then walk one real flow: register, upload a CV, add a job, run three questions, generate the report.

---

## Other platforms

Any Node 20+ host works. The app writes nothing to disk and holds no in-process state beyond a
connection pool, so it scales horizontally.

```bash
npm ci
npm run build
npm start                      # binds PORT, default 3000
```

Set `RATE_LIMIT_BACKEND=postgres` so limits are shared across instances — the in-memory limiter lets
a caller multiply their allowance by the number of instances.

### Docker

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/db ./db
COPY package.json next.config.ts ./
EXPOSE 3000
CMD ["npm", "start"]
```

`db/` is copied because the migration runner reads those files at runtime.

---

## Migrations in CI

Run migrations as a deploy step *before* traffic reaches the new build:

```yaml
- run: npm ci
- run: npm run db:migrate
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    DATABASE_SSL: require
```

The runner is idempotent and safe to run concurrently — each migration is applied inside a
transaction and recorded with a checksum. Editing an already-applied migration is a hard error
rather than silent drift, so always add a new one.

---

## Operations

### Health

`GET /api/health` — unauthenticated, exposes no secrets. `503` when the database is unreachable.
Point your platform's health check at it.

### Monitoring

The admin dashboard (`/admin`, for `ADMIN_EMAILS` accounts) shows database latency, AI failure rate
and latency, cost per interview, the interview funnel and recent errors.

Direct queries:

```sql
-- Spend by day, provider and model
SELECT * FROM analytics_ai_cost ORDER BY day DESC LIMIT 30;

-- Most expensive interviews
SELECT * FROM analytics_cost_per_interview ORDER BY cost_usd DESC LIMIT 20;

-- Completion funnel
SELECT * FROM analytics_interview_funnel ORDER BY day DESC;

-- Recent failures
SELECT created_at, scope, code, left(message, 200) FROM error_log ORDER BY created_at DESC LIMIT 50;
```

### Housekeeping

Two tables grow unboundedly. Schedule a weekly job:

```sql
DELETE FROM rate_limits WHERE expires_at < now();
DELETE FROM sessions    WHERE expires_at < now() - interval '7 days';
DELETE FROM error_log   WHERE created_at  < now() - interval '90 days';
DELETE FROM analytics_events WHERE created_at < now() - interval '365 days';
```

### Rotating `AUTH_SECRET`

Rotating it invalidates every active session — users are signed out. Session tokens are random and
hashed rather than signed, so the secret is only used for IP hashing; rotating it also breaks
continuity of rate-limit buckets, which self-heal within one window.

### Scaling

- **Database connections** are the first limit. Use the pooled string and keep `DATABASE_POOL_MAX`
  at 5 or below.
- **AI latency** dominates request time. Interview turns take seconds; the UI shows progress and the
  `maxDuration` settings account for it.
- **Cost** scales linearly with interviews. Watch `analytics_cost_per_interview` and adjust
  `AI_MAX_COST_PER_INTERVIEW_USD` and per-plan quotas together.

---

## Rollback

```bash
vercel rollback
```

The schema is forward-only. If a release needs a schema change that an older build cannot tolerate,
deploy the migration and the code in two steps: first a migration the current build still works
against, then the build that requires it.
