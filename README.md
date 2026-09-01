# TalentOS

**AI Recruitment Operating System** — practice interviews with an AI that follows the thread of
your answers, then returns an evidence-based evaluation, a skill-gap analysis and a plan to close
the gaps.

TalentOS is not a chatbot with an interview prompt. It is a server-side state machine that reads
your CV and a real job description, plans which skills to probe, decides after every answer whether
to clarify, ask for an example, go deeper or move on, and calibrates difficulty as it goes. Scores
never reach the browser while an interview is running.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Database](#database)
- [AI providers](#ai-providers)
- [Offline heuristic mode](#offline-heuristic-mode)
- [Testing](#testing)
- [Deployment](#deployment)
- [Production checklist](#production-checklist)
- [Security](#security)
- [Cost control](#cost-control)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

---

## What it does

1. **Upload a CV** (PDF, DOCX or text). It is parsed into structured facts — skills, roles,
   projects, dates — plus the specific claims worth testing in an interview.
2. **Paste a job description.** It becomes a weighted skill matrix: every requirement graded
   `required` / `preferred` / `nice_to_have` and scored for importance.
3. **Run an interview.** Six formats (behavioral, technical, HR, case study, system design, mixed)
   and four difficulty levels. The engine allocates a question budget across the job's skills, then
   adapts turn by turn.
4. **Get an evaluation.** Six independently scored dimensions, per-skill breakdown with the evidence
   behind each score, question-by-question analysis, and a week-by-week improvement plan.
5. **Track progress.** Every interview is scored against the same rubric, so the trend line means
   something.

---

## Architecture

```
Browser (Next.js App Router, React 19)
   │  fetch, session cookie
   ▼
API routes  ──►  publicRoute / authedRoute wrappers
   │              auth · rate limit · Zod validation · error shaping
   ▼
Service layer  ──►  resume · job · interview engine · evaluation · billing
   │
   ├──►  AIProvider  ──►  Anthropic │ OpenAI │ Gemini │ offline heuristic
   │                       (schema-constrained, Zod-validated)
   │
   └──►  Repository layer  ──►  PostgreSQL
                                 every query scoped by user_id
```

### The interview engine

The engine is a state machine, not a conversation. Per turn:

```
answer ─► Answer Analyzer ─► State Manager ─► Follow-up Decision
                                                    │
       next question ◄─ Question Generator ◄─ Difficulty Controller
```

| Component | Responsibility | File |
|---|---|---|
| Interview Plan | Allocates the question budget across the job's skills by weight | `src/lib/ai/heuristic/plan.ts` |
| Question Generator | Chooses the next question from the state, never a fixed list | `src/lib/interview/engine.ts` |
| Answer Analyzer | Scores nine dimensions per answer | `src/lib/interview/engine.ts` |
| Follow-up Decision | clarify / example / deepen / test_concept / move_on | `src/lib/interview/state.ts` |
| Difficulty Controller | Calibrates on a two-answer average, one step at a time | `src/lib/interview/difficulty.ts` |
| State Manager | Coverage, follow-up depth, asked questions, running scores | `src/lib/interview/state.ts` |
| Final Evaluation | Rolls the turn-by-turn evidence into the report | `src/lib/interview/evaluation.ts` |

Two invariants hold throughout:

1. **Grading never crosses the wire mid-interview.** The answer endpoint returns the next question
   and progress — nothing else. A candidate with devtools open learns nothing about their score.
2. **Nothing the client sends decides anything.** Position, difficulty and skill targeting are all
   derived from persisted server state.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19 | One deployable for UI and API |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | |
| Database | PostgreSQL 14+ via `pg` | Portable: Supabase, Neon, RDS or local |
| Migrations | Hand-written SQL, checksummed runner | No ORM to fight; the schema is the source of truth |
| Auth | scrypt + opaque session tokens | No vendor lock-in; revocable sessions |
| Validation | Zod 4 | One schema drives AI output *and* runtime validation |
| AI | Anthropic SDK; OpenAI and Gemini over REST | Provider-agnostic behind one interface |
| Styling | Tailwind CSS v4 with CSS custom properties | Theme tokens in one place |
| Charts | Hand-written inline SVG | No chart dependency; full control of theming and a11y |
| Tests | Vitest (unit + API) and Playwright (E2E) | |

---

## Local development

**Prerequisites:** Node 20.9+, PostgreSQL 14+.

```bash
git clone <repo> && cd TalentOS
npm install
cp .env.example .env.local          # then edit DATABASE_URL and AUTH_SECRET

createdb talentos
npm run db:migrate
npm run db:seed                     # optional demo account with two interviews

npm run dev                         # http://localhost:3000
```

The seed creates `demo@talentos.dev` / `demo-password-2026` with a CV, a job and two scored
interviews, so the dashboard has something to render.

Without an AI key the app runs in [offline heuristic mode](#offline-heuristic-mode) and says so.

---

## Environment variables

Every variable is documented in [`.env.example`](.env.example). The ones that matter:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Any PostgreSQL 14+. On Supabase use the **pooled** string (port 6543). |
| `DATABASE_SSL` | managed DBs | `require` for Supabase / Neon / RDS, `disable` locally. |
| `DATABASE_POOL_MAX` | no | Default 5. Keep low on serverless — each instance opens its own pool. |
| `AUTH_SECRET` | production | 32+ random bytes. Rotating it invalidates every session. |
| `AUTH_SESSION_TTL_DAYS` | no | Default 30. |
| `ADMIN_EMAILS` | no | Comma-separated. These accounts get `admin` on registration. |
| `AI_PROVIDER` | no | `anthropic` (default) / `openai` / `gemini` / `none`. |
| `ANTHROPIC_API_KEY` etc. | per provider | Server-side only; never exposed to the browser. |
| `AI_MAX_COST_PER_INTERVIEW_USD` | no | Default 1.50. Over budget, an interview winds down to evaluation. |
| `UPLOAD_MAX_BYTES` | no | Default 5 MB. |
| `RATE_LIMIT_BACKEND` | no | `postgres` (default) or `memory`. Use `postgres` on serverless. |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

---

## Database

26 tables, 4 reporting views, 78 indexes. Migrations live in `db/migrations` and are applied in
filename order, once each, inside a transaction:

```bash
npm run db:migrate
```

The runner records a checksum per migration, so editing one that has already been applied is an
error rather than silent drift. **Migrations are immutable — add a new one instead.**

| Migration | Contents |
|---|---|
| `0001_core` | users, auth_identities, sessions, profiles |
| `0002_documents` | resumes, candidate skills/experience/projects/education, jobs, job_skills |
| `0003_interviews` | interviews, questions, answers, evaluations, skill_scores, recommendations, learning_plans |
| `0004_platform` | ai_usage_events, usage_counters, rate_limits, analytics_events, error_log, reporting views |
| `0005_rls` | Row-level security policies (defence in depth) |

### Reporting views

`analytics_interview_funnel`, `analytics_skill_gaps`, `analytics_ai_cost` and
`analytics_cost_per_interview` are stable contracts for the admin dashboard and for any BI tool
(Power BI, Metabase) pointed at the same database. None of them expose question or answer text.

### Supabase

Works as-is. Use the pooled connection string, set `DATABASE_SSL=require`, and run
`npm run db:migrate` against it. Migration `0005` adds RLS policies, which matter if you also expose
these tables through PostgREST — the application itself connects as the owner and enforces
authorization in the repository layer.

---

## AI providers

Nothing above `src/lib/ai/types.ts` knows which provider is configured. Switching is one variable.

```
AI_PROVIDER=anthropic   ANTHROPIC_API_KEY=sk-ant-…
AI_PROVIDER=openai      OPENAI_API_KEY=sk-…
AI_PROVIDER=gemini      GEMINI_API_KEY=…
```

Each task asks for a *tier*, not a model, and `src/lib/ai/models.ts` maps tiers to models:

| Task | Tier | Anthropic default |
|---|---|---|
| Resume / job analysis, planning, questions, answer analysis | `standard` | `claude-sonnet-5` |
| Follow-up decision | `fast` | `claude-haiku-4-5` |
| **Final evaluation** | `reasoning` | `claude-opus-5` |

The rule: anything that produces a number a candidate is judged on runs on the reasoning tier.
Override per tier with `AI_MODEL_REASONING` / `AI_MODEL_STANDARD` / `AI_MODEL_FAST`.

Every call is schema-constrained (`output_config.format` on Anthropic, `response_format` on OpenAI,
`responseSchema` on Gemini) from a JSON Schema generated by `z.toJSONSchema`, then validated against
that same Zod schema before anything is written. Malformed output is retried once with the
validation errors fed back, then degrades.

---

## Offline heuristic mode

With no API key configured, TalentOS runs a deterministic local engine instead of failing. It is
**not** a mock: it performs real analysis — section-aware CV parsing, a requirement-aware job skill
matrix, and answer scoring from measurable signals (technical vocabulary density, concrete
specifics, explicit reasoning connectives, hedging, STAR completeness, ownership language).

What it cannot do is judge whether a claim is **true**. It measures the shape of an answer, not its
truth. The product says so: a banner in the sidebar, a note on every report, and
`engine.mode: "offline_heuristic"` from `/api/health`.

It exists so the product runs end to end in development and CI without a key, and so a provider
outage degrades an interview instead of ending it.

---

## Testing

```bash
npm run typecheck                     # tsc --noEmit, strict
npm test                              # 97 unit + API tests
npm run test:unit                     # pure logic, no I/O
npm run test:api                      # against a real PostgreSQL database
npm run test:e2e                      # Playwright, 9 critical flows
npm run verify                        # typecheck + tests
```

API tests need a disposable database — they drop and recreate the `public` schema:

```bash
createdb talentos_test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/talentos_test npm run test:api
```

E2E tests start the app themselves, or point at a running one:

```bash
E2E_BASE_URL=http://localhost:3000 \
E2E_DATABASE_URL=$DATABASE_URL \
npm run test:e2e
```

What is covered: registration and password policy, login and session revocation, atomic rate
limiting and quota consumption under concurrency, CV and job analysis, a complete interview from
first question to report, cross-user isolation, report idempotency, cost ledger accuracy, and the
mobile layout.

---

## Deployment

Recommended: **Vercel** (app + API) + **Supabase** or **Neon** (PostgreSQL).

### 1. Database

Create the database, then apply migrations from your machine:

```bash
DATABASE_URL='postgresql://…' DATABASE_SSL=require npm run db:migrate
```

### 2. Vercel

```bash
npm i -g vercel
vercel link
vercel env add DATABASE_URL production      # pooled connection string
vercel env add DATABASE_SSL production      # require
vercel env add AUTH_SECRET production       # 32+ random bytes
vercel env add APP_URL production           # https://your-domain
vercel env add AI_PROVIDER production
vercel env add ANTHROPIC_API_KEY production
vercel --prod
```

`vercel.json` already raises `maxDuration` for the routes that call an LLM — interview turns and
report generation exceed the default budget.

### 3. Verify

```bash
curl https://your-domain/api/health
```

A healthy deployment reports `status: "ok"`, `database.ok: true`, and the engine mode. If it says
`offline_heuristic` in production, the API key did not reach the runtime.

### Other platforms

Any Node 20+ host works: `npm ci && npm run build && npm start`. The app writes nothing to disk and
holds no in-process state beyond a connection pool, so it scales horizontally. Set
`RATE_LIMIT_BACKEND=postgres` so limits are shared across instances.

---

## Production checklist

- [ ] `AUTH_SECRET` is 32+ random bytes and not the development default
- [ ] `DATABASE_URL` uses a pooled connection; `DATABASE_POOL_MAX` ≤ 5 on serverless
- [ ] `DATABASE_SSL=require`
- [ ] `APP_URL` is the real HTTPS origin
- [ ] An AI provider key is set — `/api/health` must not report `offline_heuristic`
- [ ] `AI_MAX_COST_PER_INTERVIEW_USD` set to a figure you are willing to pay per interview
- [ ] `RATE_LIMIT_BACKEND=postgres`
- [ ] `ADMIN_EMAILS` contains only accounts that should see the admin dashboard
- [ ] Migrations applied (`npm run db:migrate`)
- [ ] `npm run verify` passes against the release commit
- [ ] Database backups enabled

---

## Security

| Concern | How it is handled |
|---|---|
| Passwords | scrypt, N=2^16, r=8, p=1, per-password salt. Format is self-describing so cost can be raised later. |
| Sessions | Opaque random tokens; only the SHA-256 is stored. httpOnly, Secure in production, SameSite=Lax. |
| Suspension | Enforced on every request, not at next login. |
| Authorization | Every query is scoped by `user_id` in the repository layer. A resource id alone grants nothing. |
| Admin | Role from an environment allowlist, never from client input. Admins see usage and health, never candidate CVs, questions or answers. |
| Uploads | Validated by magic bytes, not extension or client MIME type. Size capped before buffering. Only extracted text is retained. |
| Rate limiting | Fixed-window, atomic per bucket, shared across instances via PostgreSQL. |
| Input | Every request body parsed through a Zod schema. |
| Errors | One normaliser decides what a client learns. Stack traces, SQL and provider messages never leave the server. |
| Headers | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, restrictive Permissions-Policy. |
| Secrets | Server-side only. No `NEXT_PUBLIC_` variable carries one. |
| Scoring | Computed and stored server-side. The client never sends or sees a score mid-interview. |

Report a vulnerability privately rather than by opening an issue.

---

## Cost control

Every AI call — successful, failed or degraded — writes a row to `ai_usage_events` with token
counts, computed USD cost and latency. That makes cost per interview a query, not an estimate:

```sql
SELECT * FROM analytics_cost_per_interview ORDER BY cost_usd DESC LIMIT 20;
SELECT day, provider, model, calls, cost_usd FROM analytics_ai_cost ORDER BY day DESC;
```

Levers in use: task→tier model routing, prompt caching on the stable system prefix, compact context
renderers that send only decision-relevant fields, structured outputs (no re-asking for
reformatting), a per-interview budget ceiling, and per-plan quotas.

---

## Troubleshooting

**`/api/health` reports `offline_heuristic` in production** — the provider key did not reach the
runtime. Confirm the variable is set for the *production* environment and redeploy; Vercel does not
apply new env vars to existing deployments.

**`Migration X has changed since it was applied`** — an already-applied migration was edited. Revert
it and add a new migration instead.

**`connect ETIMEDOUT` / connection limit reached** — using the direct database connection on
serverless. Switch to the pooled string and lower `DATABASE_POOL_MAX`.

**"Almost no text could be read from that file"** — the PDF is a scan. There is no OCR step; export
a text-based PDF.

**Interview turns time out** — an LLM turn exceeds the default serverless budget. `vercel.json` sets
`maxDuration` for those routes; a different host needs the equivalent.

**Rate limited during development** — `DELETE FROM rate_limits;` or set `RATE_LIMIT_BACKEND=memory`
and restart.

---

## Project layout

```
db/migrations/          Forward-only SQL migrations
docs/                   Architecture, API, prompt and deployment references
scripts/                migrate.ts, seed.ts
src/
  app/
    (marketing)/        Landing page
    (auth)/             Login and registration
    (app)/              Authenticated area — guard lives in the layout
    api/                23 route handlers
  components/
    ui/                 Primitives, theme
    charts/             Inline-SVG line, radar, bar, sparkline
    marketing/ app/ interview/
  lib/
    ai/                 Provider abstraction, models, prompts, taxonomy
      heuristic/        The offline engine
      providers/        anthropic · openai · gemini · heuristic
    interview/          engine · state · difficulty · evaluation · history
    resume/ job/        Extraction and analysis services
    db/                 Client, migration runner, repositories
    auth/ security/     Passwords, sessions, rate limits, errors, route wrappers
    billing/ analytics/ voice/ schemas/
tests/
  unit/ api/ e2e/
```

**Rule of thumb:** business logic lives in `src/lib`. Components render; they do not decide.

---

## Licence

Not yet licensed for redistribution. Add a `LICENSE` file before publishing.
