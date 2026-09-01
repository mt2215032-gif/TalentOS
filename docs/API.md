# API reference

All endpoints live under `/api`. Every response uses one envelope:

```jsonc
// success
{ "data": { /* … */ } }

// failure
{ "error": { "code": "validation_failed", "message": "…", "fields": { "email": "…" } } }
```

`fields` appears only for field-level validation errors and is safe to render next to a form input.

**Authentication** is a `talentos_session` cookie, set on register and login. It is httpOnly, so it
cannot be read from JavaScript; browsers attach it automatically.

**Error codes** map to HTTP status:

| Code | Status | Meaning |
|---|---|---|
| `bad_request` | 400 | Malformed request |
| `unauthorized` | 401 | Not signed in, or bad credentials |
| `quota_exceeded` | 402 | Plan limit reached |
| `forbidden` | 403 | Signed in, not allowed |
| `not_found` | 404 | Does not exist, or is not yours |
| `conflict` | 409 | State does not permit this |
| `payload_too_large` | 413 | Upload over `UPLOAD_MAX_BYTES` |
| `unsupported_media_type` | 415 | Not a PDF, DOCX or text file |
| `validation_failed` | 422 | Body failed schema validation |
| `rate_limited` | 429 | Includes `Retry-After` |
| `ai_unavailable` | 503 | Provider failed and could not degrade |
| `internal_error` | 500 | Generic; detail is logged, never returned |

---

## Authentication

### `POST /api/auth/register`
Rate limit: 20/hour per IP.

```jsonc
{ "email": "you@example.com", "password": "at-least-10-chars", "fullName": "Optional" }
```
→ `201 { "data": { "user": { "id", "email", "role", "plan" } } }`

Password policy: 10+ characters, at least 5 distinct characters, letters plus a number or symbol,
not on the common-password list.

### `POST /api/auth/login`
Rate limit: 8 per 5 minutes.

```jsonc
{ "email": "you@example.com", "password": "…" }
```
→ `200 { "data": { "user": { … } } }`

The response is identical for an unknown email, a wrong password and a suspended account, and a
hash is verified even when the email is unknown so timing does not distinguish them either.

### `POST /api/auth/logout` → `{ "data": { "signedOut": true } }`

### `GET /api/auth/session`
→ `{ "data": { "user": …|null, "profile": …, "usage": [ … ] } }`. Returns `user: null` when signed
out rather than 401, so the client can bootstrap without treating it as an error.

### `POST /api/auth/password`
```jsonc
{ "currentPassword": "…", "newPassword": "…" }
```
Revokes every other session, then re-issues one for the current browser.

---

## Profile

### `GET /api/profile`
→ profile, plan usage and AI cost summary.

### `PATCH /api/profile`
Partial update — only keys present are written, so a partial form cannot blank untouched fields.

```jsonc
{ "fullName": "…", "headline": "…", "targetRole": "…", "seniority": "senior", "yearsExperience": 7 }
```

---

## Resumes

### `GET /api/resumes`
→ list with `status`, `isPrimary`, `skillCount`. Full analysis is omitted from the list view.

### `POST /api/resumes`
`multipart/form-data` with a `file` field. Rate limit: 12/hour. Consumes one `resume_analyses`
quota unit.

Accepts PDF, DOCX and plain text, identified by magic bytes rather than by extension or the
client-supplied MIME type. Only extracted text is retained; the binary is never stored.

→ `201 { "data": { "resume": { "id", "status", "isPrimary", "analysis": { … } } } }`

The `analysis` is a `CandidateAnalysis`: skills, experiences, projects, education, certifications,
`probeTargets` (claims worth testing) and `redFlags`.

### `GET /api/resumes/:id` · `PATCH /api/resumes/:id` (make primary) · `DELETE /api/resumes/:id`

---

## Jobs

### `GET /api/jobs` · `POST /api/jobs`

```jsonc
{ "title": "Senior Data Engineer", "company": "Optional", "description": "full posting text…" }
```
Description must be at least 80 characters. Rate limit: 30/hour.

### `GET /api/jobs/:id`
→ the job, its **skill matrix**, and `fit` — which required skills your primary CV claims.

```jsonc
{
  "data": {
    "job": { … },
    "skills": [
      { "label": "Python", "requirement": "required", "importance": "critical", "weight": 1.0 },
      { "label": "dbt", "requirement": "preferred", "importance": "medium", "weight": 0.3 }
    ],
    "fit": [ { "label": "Python", "claimedOnCv": true } ]
  }
}
```

`claimedOnCv` means the skill appears on the CV — not that it has been demonstrated. That is what
the interview establishes.

### `DELETE /api/jobs/:id`

---

## Interviews

### `GET /api/interviews` → history with scores and verdicts.

### `POST /api/interviews`
Rate limit: 20/hour. Consumes one `interviews` quota unit. `maxDuration: 120`.

```jsonc
{
  "roleTitle": "Senior Data Engineer",
  "interviewType": "technical",     // behavioral|technical|hr|case_study|system_design|mixed
  "difficulty": "medium",           // easy|medium|hard|expert
  "questionCount": 8,               // 3–20
  "jobId": "uuid|null",
  "resumeId": "uuid|null"
}
```
→ `201 { "data": { "turn": { "interviewId", "questionId", "position", "question", "category", "skillLabel", "difficulty", "plannedQuestions" } } }`

Planning and the first question happen together, so the room is never empty.

### `GET /api/interviews/:id`
The room's view: interview metadata, the pending question, and answered turns.

**Deliberately excluded:** engine state, grading criteria, expected competencies and per-answer
scores. A candidate reading this response learns nothing about how they are being graded.

### `POST /api/interviews/:id/answer`
Rate limit: 240/hour. Consumes one `ai_questions` unit. `maxDuration: 120`.

```jsonc
{ "questionId": "uuid", "answerText": "…", "responseSeconds": 74, "transcriptSource": "text" }
```

`answerText` may be empty — skipping is a legitimate action and is scored as one.

→ `{ "data": { "next": { … }|null, "isComplete": false, "answeredCount": 3, "plannedQuestions": 8 } }`

Note `next.questionId` — this is an interview *turn*, not a question row. Answering the same
question twice returns `409`.

### `POST /api/interviews/:id/pause` · `/resume` · `/end`

Pausing blocks answers; paused time is excluded from the recorded duration. `end` moves the
interview to `evaluating` and still produces a report from what was gathered.

### `GET /api/interviews/:id/report`
→ the saved report, or `{ "data": { "report": null } }` if not generated yet.

### `POST /api/interviews/:id/report`
Rate limit: 30/hour. `maxDuration: 180`. **Idempotent** — a second call returns the stored report
rather than paying to regenerate it.

```jsonc
{
  "data": {
    "report": {
      "overallScore": 74,
      "dimensions": { "technicalKnowledge": 78, "problemSolving": 71, "communication": 80,
                      "practicalExperience": 76, "criticalThinking": 69, "roleFit": 73 },
      "verdict": "hire",
      "evidenceConfidence": "medium",
      "summary": "…",
      "strengths": [ { "title", "detail" } ],
      "weaknesses": [ { "title", "detail" } ],
      "skillScores": [ { "skillLabel", "score", "level", "evidenceCount", "evidence", "feedback", "isGap" } ],
      "skillGaps": [ { "skillLabel", "severity", "detail" } ],
      "questionAnalysis": [ { "position", "score", "whatWasGood", "whatWasMissing",
                              "idealAnswerCharacteristics": [], "howToImprove" } ]
    },
    "learningPlan": { "title", "objective", "totalWeeks", "weeks": [ … ], "recommendations": [ … ] }
  }
}
```

`evidenceConfidence` is `low` when few answers carried enough detail to assess. Treat the score as
provisional when it is.

---

## Analytics

### `GET /api/dashboard`
Totals, progression, per-skill scores, recent interviews, recommendations, plan usage.

### `GET /api/analytics`
Requires a plan with `advancedAnalytics` (Pro and above), else `402`. Adds per-type breakdown,
skill history and AI cost.

---

## Admin

Both require `role = "admin"`, granted only via the `ADMIN_EMAILS` allowlist. A non-admin receives
the same `403` a stranger does, so the surface is not discoverable by probing.

### `GET /api/admin/overview`
Users, interview funnel, AI cost and failure rate, popular types, common skill gaps, recent errors,
and 30 days of daily activity.

### `GET /api/admin/users?limit=50&offset=0`
Account metadata and aggregate scores. **No CVs, questions or answers** — administrators have no
business reading candidate interview content.

---

## Public

### `GET /api/health`
Unauthenticated. Exposes no secrets and no user data.

```jsonc
{
  "status": "ok",
  "environment": "production",
  "database": { "ok": true, "latencyMs": 6 },
  "engine": { "provider": "anthropic", "isLlm": true, "mode": "llm" }
}
```

`503` when the database is unreachable. `mode: "offline_heuristic"` means no AI provider is
configured — in production that is a misconfiguration.

### `GET /api/plans`
The plan catalogue used by the pricing page.
