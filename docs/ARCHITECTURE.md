# Architecture

## Principles

1. **Business logic lives in `src/lib`.** Components render; they do not decide. Every rule that
   matters is testable without a browser.
2. **The server owns the truth.** Scores, difficulty, position and skill targeting are derived from
   persisted state. Nothing the client sends decides anything.
3. **Model output is data, not instructions.** Every AI response is parsed and validated against a
   schema before it is written.
4. **Authorization is structural.** Every repository function takes the acting user's id. There is
   no ambient "current user" in the data layer, so a query cannot forget to scope itself.
5. **Degrade rather than fail.** A provider outage moves an interview to the offline engine; it does
   not strand a candidate mid-question.

---

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│ app/           Pages and route handlers. Thin.              │
├─────────────────────────────────────────────────────────────┤
│ security/api   publicRoute / authedRoute                    │
│                auth · rate limit · validation · errors      │
├─────────────────────────────────────────────────────────────┤
│ Services       resume · job · interview · evaluation        │
│                billing · analytics                          │
├─────────────────────────────────────────────────────────────┤
│ lib/ai         AIProvider abstraction, prompts, taxonomy    │
├─────────────────────────────────────────────────────────────┤
│ db/            Client, migrations, repositories             │
└─────────────────────────────────────────────────────────────┘
```

A route handler's job is to declare what it needs and call one service. The wrappers in
`security/api.ts` make authentication, rate limiting, body validation and error shaping structural
rather than remembered per endpoint:

```ts
export const POST = authedRoute(
  { schema: StartInterviewSchema, rateLimit: 'interviewStart' },
  async ({ body, user }) => { /* … */ },
);
```

---

## The interview engine

### Per-turn flow

```
POST /answer
   │
   ├─► Answer Analyzer      nine dimensions, strengths, gaps, CV consistency
   ├─► persist              interview_answers, including the hidden scores
   ├─► State Manager        record answer, update skill coverage
   ├─► Follow-up Decision   clarify | example | deepen | test_concept | move_on
   ├─► Difficulty Ctrl      two-answer average, one step, bounded
   ├─► budget check         over the ceiling → wind down to evaluation
   └─► Question Generator   next question from state, never a list
          │
          └─► response: { next, isComplete, answeredCount }   ← no grading
```

### State

`interviews.state` is a validated JSON document (`InterviewStateSchema`) holding skill coverage,
covered categories, difficulty history, the pending follow-up, follow-up depth, answer scores and
every question asked verbatim. It never leaves the server.

It is validated on read. A document written by an older build is rebuilt rather than trusted — losing
adaptive context is recoverable; a crash mid-interview is not.

### Difficulty

Bounded to one step either side of the chosen level, so an interview booked as "easy" cannot become
an expert interview. Decisions use a two-answer average rather than the last answer, so one bad
answer does not swing the whole interview.

### Anti-repetition

Three layers: the prompt instructs against it; `ensureNotRepeated` rewords a duplicate at the engine
level; and the offline generator searches (skill × frame) pairs, then role-level frames, then
questions built from what the interview has already covered. Verified by a test that draws 20
questions from a single skill and asserts zero duplicates.

---

## AI provider abstraction

```ts
interface AIProvider {
  readonly name: string;
  readonly isLlm: boolean;                   // false for the offline engine
  modelFor(tier: ModelTier): string;
  generateStructured<T extends z.ZodType>(r: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>>;
}
```

Only structured generation is exposed. The platform never asks a model for prose it then has to
parse — every call has a schema, which is what keeps malformed output out of the database.

`generate()` in `src/lib/ai/index.ts` is the single call site. It owns retry-on-invalid-output,
degradation to the offline engine, and writing the cost ledger. Because there is exactly one path,
cost tracking and error handling are guaranteed rather than remembered.

### Offline engine

`HeuristicProvider` dispatches on `request.task` and consumes typed `context` rather than parsing its
own prompt. LLM providers ignore `context` and work from the rendered prompt; the engine above has
one call site regardless of which is configured.

It validates its own output against the same Zod contract, so a bug in it fails loudly instead of
writing a bad row.

---

## Data model

26 tables. The shape worth knowing:

- **`interviews`** carries queryable columns *and* `plan` / `state` JSON. Normalised for analytics,
  document-shaped for the engine.
- **`interview_answers`** stores the nine hidden dimensions as columns plus the full analysis as
  JSON. Columns make aggregation cheap; the document preserves everything.
- **`resumes.analysis`** holds the whole `CandidateAnalysis`; `candidate_skills` and friends hold its
  normalised projection. The document is what the engine consumes; the rows are what SQL can query.
- **`ai_usage_events`** is the cost ledger — one row per call, including failures.
- **`analytics_*` views** are stable contracts for the admin dashboard and external BI, and expose no
  candidate content.

### Why the duplication

Storing the analysis twice is deliberate. The engine needs the exact object it was given; analytics
needs rows it can `GROUP BY`. Deriving one from the other at read time would either make the engine
reassemble documents from joins, or make skill-gap queries parse JSON across every row.

---

## Request lifecycle

```
Browser
  │  fetch with session cookie
  ▼
Next.js route handler
  │
  ├─ authedRoute: resolve session (SHA-256 lookup, expiry, revocation, account status)
  ├─ rate limit (atomic upsert keyed by identity + route + window)
  ├─ Zod parse of the body
  │
  ▼
Service — takes user.id explicitly
  │
  ├─ quota check (atomic increment; refused requests give the unit back)
  ├─ AI call via generate() → cost ledger row
  ▼
Repository — every query scoped by user_id
  │
  ▼
PostgreSQL
```

Anything thrown lands in `normalizeError`, the one place that decides what a client is allowed to
learn about a failure.

---

## Frontend

Server components fetch; client components handle interaction. The authenticated area's guard lives
in `(app)/layout.tsx`, so every page beneath it is protected by construction — an unauthenticated
visitor is redirected before any page component runs.

`useHydrated()` gates submit controls until React has attached its handlers. Without it, a
server-rendered form looks interactive before hydration and a fast submit performs a native GET,
navigating away and silently discarding everything typed.

Charts are hand-written inline SVG. Their mark colours are validated for colour-vision separation and
contrast, and are kept as separate tokens from text colours because the two have different rules.

---

## Extension points

| To add | Do this |
|---|---|
| An AI provider | Implement `AIProvider`, register it in `getProvider()` |
| An interview type | Add to `InterviewTypeSchema`, the DB CHECK constraint, question frames, `GENERAL_COMPETENCIES` |
| Voice | Implement `SpeechToTextProvider` / `TextToSpeechProvider`. `interview_answers.transcript_source` already records the channel and the engine is agnostic. |
| OAuth | `auth_identities` exists with a `(provider, provider_account_id)` unique key |
| A plan | Add to `PLANS` — limits are data, not code branches |
| Payments | Wire a provider to `users.plan`; the entitlement layer needs no change |
