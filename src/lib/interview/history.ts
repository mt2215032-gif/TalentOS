import { query, queryOne } from '@/lib/db/client';
import type { Difficulty, InterviewStatus, InterviewType, Verdict } from '@/lib/schemas/domain';

/**
 * Read models for history, dashboard and the interview room.
 *
 * These are the shapes the UI consumes. They are separate from the engine's
 * records on purpose: the engine's view includes grading state, and none of it
 * belongs in a response.
 */

export interface InterviewSummary {
  id: string;
  roleTitle: string;
  interviewType: InterviewType;
  difficulty: Difficulty;
  status: InterviewStatus;
  askedCount: number;
  answeredCount: number;
  plannedQuestions: number;
  createdAt: Date;
  completedAt: Date | null;
  durationSeconds: number | null;
  overallScore: number | null;
  verdict: Verdict | null;
  engineProvider: string;
}

export async function listInterviews(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<InterviewSummary[]> {
  const rows = await query<{
    id: string;
    role_title: string;
    interview_type: InterviewType;
    difficulty: Difficulty;
    status: InterviewStatus;
    asked_count: number;
    answered_count: number;
    planned_questions: number;
    created_at: Date;
    completed_at: Date | null;
    duration_seconds: number | null;
    overall_score: number | null;
    verdict: Verdict | null;
    engine_provider: string;
  }>(
    `SELECT i.id, i.role_title, i.interview_type, i.difficulty, i.status,
            i.asked_count, i.answered_count, i.planned_questions, i.created_at,
            i.completed_at, i.duration_seconds, i.engine_provider,
            e.overall_score, e.verdict
       FROM interviews i
       LEFT JOIN evaluations e ON e.interview_id = i.id
      WHERE i.user_id = $1
      ORDER BY i.created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, Math.min(limit, 100), Math.max(offset, 0)],
  );

  return rows.map((row) => ({
    id: row.id,
    roleTitle: row.role_title,
    interviewType: row.interview_type,
    difficulty: row.difficulty,
    status: row.status,
    askedCount: row.asked_count,
    answeredCount: row.answered_count,
    plannedQuestions: row.planned_questions,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    durationSeconds: row.duration_seconds,
    overallScore: row.overall_score,
    verdict: row.verdict,
    engineProvider: row.engine_provider,
  }));
}

export interface InterviewRoomView {
  interview: {
    id: string;
    roleTitle: string;
    interviewType: InterviewType;
    difficulty: Difficulty;
    currentDifficulty: Difficulty;
    status: InterviewStatus;
    askedCount: number;
    answeredCount: number;
    plannedQuestions: number;
    engineProvider: string;
  };
  /** The question awaiting an answer, or null when there is none. */
  currentQuestion: {
    id: string;
    position: number;
    question: string;
    category: string;
    skillLabel: string | null;
    difficulty: Difficulty;
  } | null;
  /** Answered turns, shown as the interview's visible history. */
  history: Array<{
    position: number;
    question: string;
    skillLabel: string | null;
    answer: string;
  }>;
}

/**
 * Build the interview room's view.
 *
 * Notably absent: evaluation_criteria, expected_competency, answer scores and
 * engine state. A candidate who opened devtools would learn nothing about how
 * they are being graded.
 */
export async function getInterviewView(
  userId: string,
  interviewId: string,
): Promise<InterviewRoomView | null> {
  const interview = await queryOne<{
    id: string;
    role_title: string;
    interview_type: InterviewType;
    difficulty: Difficulty;
    current_difficulty: Difficulty;
    status: InterviewStatus;
    asked_count: number;
    answered_count: number;
    planned_questions: number;
    engine_provider: string;
  }>(
    `SELECT id, role_title, interview_type, difficulty, current_difficulty, status,
            asked_count, answered_count, planned_questions, engine_provider
       FROM interviews WHERE id = $1 AND user_id = $2`,
    [interviewId, userId],
  );
  if (!interview) return null;

  const rows = await query<{
    id: string;
    position: number;
    question: string;
    category: string;
    skill_label: string | null;
    difficulty: Difficulty;
    answer_text: string | null;
  }>(
    `SELECT q.id, q.position, q.question, q.category, q.skill_label, q.difficulty,
            a.answer_text
       FROM interview_questions q
       LEFT JOIN interview_answers a ON a.question_id = q.id
      WHERE q.interview_id = $1 AND q.user_id = $2
      ORDER BY q.position ASC`,
    [interviewId, userId],
  );

  const pending = rows.find((row) => row.answer_text === null) ?? null;

  return {
    interview: {
      id: interview.id,
      roleTitle: interview.role_title,
      interviewType: interview.interview_type,
      difficulty: interview.difficulty,
      currentDifficulty: interview.current_difficulty,
      status: interview.status,
      askedCount: interview.asked_count,
      answeredCount: interview.answered_count,
      plannedQuestions: interview.planned_questions,
      engineProvider: interview.engine_provider,
    },
    currentQuestion: pending
      ? {
          id: pending.id,
          position: pending.position,
          question: pending.question,
          category: pending.category,
          skillLabel: pending.skill_label,
          difficulty: pending.difficulty,
        }
      : null,
    history: rows
      .filter((row): row is typeof row & { answer_text: string } => row.answer_text !== null)
      .map((row) => ({
        position: row.position,
        question: row.question,
        skillLabel: row.skill_label,
        answer: row.answer_text,
      })),
  };
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export interface SkillTrendPoint {
  skillLabel: string;
  score: number;
  level: string;
  isGap: boolean;
  observations: number;
}

export interface DashboardData {
  totals: {
    interviewsCompleted: number;
    interviewsStarted: number;
    averageScore: number | null;
    bestScore: number | null;
    latestScore: number | null;
    /** Change between the two most recent completed interviews. */
    scoreDelta: number | null;
    totalPracticeSeconds: number;
  };
  progression: Array<{
    interviewId: string;
    date: Date;
    roleTitle: string;
    interviewType: InterviewType;
    difficulty: Difficulty;
    score: number;
  }>;
  /** Latest score per skill, weakest first. */
  skills: SkillTrendPoint[];
  strongestSkill: SkillTrendPoint | null;
  weakestSkill: SkillTrendPoint | null;
  recentInterviews: InterviewSummary[];
  /** Highest-priority open recommendations across recent reports. */
  recommendations: Array<{
    title: string;
    detail: string | null;
    kind: string;
    priority: number;
    skillKey: string | null;
  }>;
}

export async function getDashboard(userId: string): Promise<DashboardData> {
  const [totalsRow, progression, skills, recentInterviews, recommendations] = await Promise.all([
    queryOne<{
      completed: string;
      started: string;
      avg_score: string | null;
      best_score: number | null;
      practice_seconds: string | null;
    }>(
      `SELECT count(*) FILTER (WHERE i.status = 'completed')::text AS completed,
              count(*)::text                                       AS started,
              round(avg(e.overall_score), 1)::text                 AS avg_score,
              max(e.overall_score)                                 AS best_score,
              coalesce(sum(i.duration_seconds), 0)::text           AS practice_seconds
         FROM interviews i
         LEFT JOIN evaluations e ON e.interview_id = i.id
        WHERE i.user_id = $1`,
      [userId],
    ),
    query<{
      interview_id: string;
      created_at: Date;
      role_title: string;
      interview_type: InterviewType;
      difficulty: Difficulty;
      overall_score: number;
    }>(
      `SELECT e.interview_id, i.created_at, i.role_title, i.interview_type,
              i.difficulty, e.overall_score
         FROM evaluations e
         JOIN interviews i ON i.id = e.interview_id
        WHERE e.user_id = $1
        ORDER BY i.created_at ASC
        LIMIT 50`,
      [userId],
    ),
    // DISTINCT ON gives the most recent score per skill, which is what a
    // progress view should show — not an average dragged down by early attempts.
    query<{
      skill_label: string;
      score: number;
      level: string;
      is_gap: boolean;
      observations: string;
    }>(
      `SELECT DISTINCT ON (s.skill_key)
              s.skill_label, s.score, s.level, s.is_gap,
              (SELECT count(*)::text FROM skill_scores s2
                WHERE s2.user_id = s.user_id AND s2.skill_key = s.skill_key) AS observations
         FROM skill_scores s
        WHERE s.user_id = $1
        ORDER BY s.skill_key, s.created_at DESC`,
      [userId],
    ),
    listInterviews(userId, 5, 0),
    query<{
      title: string;
      detail: string | null;
      kind: string;
      priority: number;
      skill_key: string | null;
    }>(
      // Deduplicated by title and ordered by urgency. Ordering by evaluation
      // date first interleaves two reports' priorities, so the list reads
      // 1, 2, 2, 3, 3, 1 — which is not a priority order to a user.
      `SELECT DISTINCT ON (r.title) r.title, r.detail, r.kind, r.priority, r.skill_key
         FROM recommendations r
         JOIN evaluations e ON e.id = r.evaluation_id
        WHERE r.user_id = $1
        ORDER BY r.title, e.created_at DESC`,
      [userId],
    ),
  ]);

  const scores = progression.map((point) => point.overall_score);
  const latestScore = scores.length > 0 ? (scores[scores.length - 1] ?? null) : null;
  const previousScore = scores.length > 1 ? (scores[scores.length - 2] ?? null) : null;

  const skillPoints: SkillTrendPoint[] = skills
    .map((skill) => ({
      skillLabel: skill.skill_label,
      score: skill.score,
      level: skill.level,
      isGap: skill.is_gap,
      observations: Number.parseInt(skill.observations, 10),
    }))
    .sort((a, b) => a.score - b.score);

  // A skill never actually tested is not a "weakest skill" — it is untested.
  const evidenced = skillPoints.filter((skill) => skill.score > 0);

  return {
    totals: {
      interviewsCompleted: Number.parseInt(totalsRow?.completed ?? '0', 10),
      interviewsStarted: Number.parseInt(totalsRow?.started ?? '0', 10),
      averageScore: totalsRow?.avg_score ? Number.parseFloat(totalsRow.avg_score) : null,
      bestScore: totalsRow?.best_score ?? null,
      latestScore,
      scoreDelta:
        latestScore !== null && previousScore !== null ? latestScore - previousScore : null,
      totalPracticeSeconds: Number.parseInt(totalsRow?.practice_seconds ?? '0', 10),
    },
    progression: progression.map((point) => ({
      interviewId: point.interview_id,
      date: point.created_at,
      roleTitle: point.role_title,
      interviewType: point.interview_type,
      difficulty: point.difficulty,
      score: point.overall_score,
    })),
    skills: skillPoints,
    strongestSkill: evidenced.length > 0 ? (evidenced[evidenced.length - 1] ?? null) : null,
    weakestSkill: evidenced[0] ?? null,
    recentInterviews,
    // DISTINCT ON requires ordering by the distinct key, so the priority sort
    // happens here rather than in SQL.
    recommendations: recommendations
      .map((recommendation) => ({
        title: recommendation.title,
        detail: recommendation.detail,
        kind: recommendation.kind,
        priority: recommendation.priority,
        skillKey: recommendation.skill_key,
      }))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 6),
  };
}
