import { beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '@/lib/db/client';
import { createUser } from '@/lib/db/repositories/users';
import { ingestResume, getResume, setPrimaryResume } from '@/lib/resume/service';
import { createJob, getJob, getJobSkills, compareResumeToJob } from '@/lib/job/service';
import { startInterview, submitAnswer, pauseInterview, resumeInterview, endInterview } from '@/lib/interview/engine';
import { evaluateInterview, getReport } from '@/lib/interview/evaluation';
import { getDashboard, getInterviewView, listInterviews } from '@/lib/interview/history';
import { consumeQuota, getUsage } from '@/lib/billing/entitlements';
import { interviewCostUsd } from '@/lib/ai/usage';
import { AppError } from '@/lib/security/errors';
import { truncateAll } from './setup';

const CV_TEXT = `Maria Torres
Senior Data Engineer

EXPERIENCE
Senior Data Engineer - Northwind Bank, 2021 - Present
- Built a streaming ingestion pipeline with Kafka and Spark processing 40 million events per day
- Reduced nightly ETL runtime from 3 hours to 25 minutes by repartitioning on event_date
- Led a team of 4 engineers

Data Analyst - Bright Retail, 2018 - 2021
- Developed Power BI dashboards used by 200 stakeholders
- Wrote complex SQL against PostgreSQL

EDUCATION
BSc in Computer Science - University of Valencia, 2014 - 2018

SKILLS
Python, SQL, Spark, Kafka, Airflow, Power BI, AWS, Docker`;

const JOB_TEXT = `Senior Data Engineer
We need a Senior Data Engineer to own our analytics platform.
Responsibilities
- You will design and build batch and streaming data pipelines
- Own data quality across the warehouse
Required
- 5+ years of experience with Python and SQL
- Strong experience with Spark and Airflow
- Excellent communication skills
Nice to have
- Experience with dbt
- Power BI exposure`;

const STRONG_ANSWER =
  'I owned our Airflow deployment. The nightly ETL was a single DAG taking 3 hours, so I split it ' +
  'into 12 task groups with per-task retries because a single failure was re-running everything. ' +
  'Moving the scheduler to a Celery executor with 6 workers brought the run to 25 minutes. The ' +
  'trade-off was operational complexity, so I added SLA alerts rather than relying on someone ' +
  'watching the UI.';

async function makeUser(prefix: string) {
  return createUser({ email: `${prefix}-${Date.now()}-${Math.random()}@test.local`, password: 'strong-password-9' });
}

function cvBytes(): Uint8Array {
  return new TextEncoder().encode(CV_TEXT);
}

describe('resume ingestion', () => {
  beforeEach(async () => { await truncateAll(); });

  it('extracts structured facts and stores their normalised projection', async () => {
    const user = await makeUser('cv');
    const resume = await ingestResume({ userId: user.id, fileName: 'cv.txt', bytes: cvBytes() });

    expect(resume.status).toBe('ready');
    expect(resume.analysis?.skills.length).toBeGreaterThan(4);
    expect(resume.analysis?.probeTargets.length).toBeGreaterThan(0);

    // The relational projection is what makes skill coverage queryable.
    const skills = await query('SELECT skill_key FROM candidate_skills WHERE resume_id = $1', [resume.id]);
    expect(skills.length).toBe(resume.analysis?.skills.length);

    const experiences = await query('SELECT id FROM candidate_experiences WHERE resume_id = $1', [resume.id]);
    expect(experiences.length).toBeGreaterThan(0);
  });

  it('reuses an identical upload instead of paying to analyse it twice', async () => {
    const user = await makeUser('dupe');
    const first = await ingestResume({ userId: user.id, fileName: 'cv.txt', bytes: cvBytes() });
    const second = await ingestResume({ userId: user.id, fileName: 'cv-copy.txt', bytes: cvBytes() });
    expect(second.id).toBe(first.id);
  });

  it('keeps at most one primary CV', async () => {
    const user = await makeUser('primary');
    const a = await ingestResume({ userId: user.id, fileName: 'a.txt', bytes: cvBytes() });
    const b = await ingestResume({
      userId: user.id, fileName: 'b.txt',
      bytes: new TextEncoder().encode(`${CV_TEXT}\nExtra line to change the hash.`),
    });
    await setPrimaryResume(user.id, b.id);

    const primaries = await query('SELECT id FROM resumes WHERE user_id = $1 AND is_primary', [user.id]);
    expect(primaries).toHaveLength(1);
    expect(await getResume(user.id, a.id)).toBeTruthy();
  });

  it('refuses to promote a CV belonging to someone else', async () => {
    const owner = await makeUser('owner');
    const stranger = await makeUser('stranger');
    const resume = await ingestResume({ userId: owner.id, fileName: 'cv.txt', bytes: cvBytes() });

    await expect(setPrimaryResume(stranger.id, resume.id)).rejects.toThrow();
    await expect(getResume(stranger.id, resume.id)).rejects.toThrow();
  });
});

describe('job analysis', () => {
  beforeEach(async () => { await truncateAll(); });

  it('produces a weighted skill matrix that separates required from preferred', async () => {
    const user = await makeUser('job');
    const job = await createJob({ userId: user.id, title: 'Senior Data Engineer', description: JOB_TEXT });

    expect(job.status).toBe('ready');
    const skills = await getJobSkills(user.id, job.id);

    const required = skills.filter((skill) => skill.requirement === 'required');
    const preferred = skills.filter((skill) => skill.requirement === 'preferred');
    expect(required.length).toBeGreaterThan(0);
    expect(preferred.length).toBeGreaterThan(0);

    // dbt appears under "Nice to have" and must not be marked required.
    expect(skills.find((skill) => skill.skill_label === 'dbt')?.requirement).toBe('preferred');
    // Weights are ordered so the planner can allocate by them.
    expect(Number.parseFloat(required[0]?.weight ?? '0')).toBeGreaterThan(
      Number.parseFloat(preferred[0]?.weight ?? '1'),
    );
  });

  it('compares CV claims against job requirements', async () => {
    const user = await makeUser('fit');
    const resume = await ingestResume({ userId: user.id, fileName: 'cv.txt', bytes: cvBytes() });
    const job = await createJob({ userId: user.id, title: 'Senior Data Engineer', description: JOB_TEXT });

    const fit = await compareResumeToJob(user.id, job.id, resume.id);
    expect(fit.length).toBeGreaterThan(0);
    // Python is on the CV and required by the job.
    expect(fit.find((row) => row.skill_label === 'Python')?.claimed).toBe(true);
    // dbt is required-ish by the job but absent from the CV.
    expect(fit.find((row) => row.skill_label === 'dbt')?.claimed).toBe(false);
  });

  it('hides another user\'s job', async () => {
    const owner = await makeUser('jobowner');
    const stranger = await makeUser('jobstranger');
    const job = await createJob({ userId: owner.id, title: 'Role', description: JOB_TEXT });
    await expect(getJob(stranger.id, job.id)).rejects.toThrow();
    expect(await getJobSkills(stranger.id, job.id)).toHaveLength(0);
  });
});

describe('the full interview lifecycle', () => {
  beforeEach(async () => { await truncateAll(); });

  it('runs from start to report and keeps grading off the wire', async () => {
    const user = await makeUser('flow');
    const resume = await ingestResume({ userId: user.id, fileName: 'cv.txt', bytes: cvBytes() });
    const job = await createJob({ userId: user.id, title: 'Senior Data Engineer', description: JOB_TEXT });

    let turn = await startInterview({
      userId: user.id, roleTitle: 'Senior Data Engineer', interviewType: 'technical',
      difficulty: 'medium', plannedQuestions: 5, jobId: job.id, resumeId: resume.id,
    });

    expect(turn.position).toBe(1);
    expect(turn.question.length).toBeGreaterThan(10);

    const seen = new Set<string>([turn.question]);
    let guard = 0;

    while (guard < 10) {
      guard += 1;
      const result = await submitAnswer({
        userId: user.id,
        interviewId: turn.interviewId,
        questionId: turn.questionId,
        answerText: STRONG_ANSWER,
        responseSeconds: 60,
      });

      // Nothing in the response may carry a grade.
      const serialised = JSON.stringify(result);
      for (const forbidden of ['answerScore', 'relevance', 'correctness', 'evaluationCriteria', 'expectedCompetency']) {
        expect(serialised).not.toContain(forbidden);
      }

      if (result.isComplete || !result.next) break;
      // No question is ever asked twice.
      expect(seen.has(result.next.question)).toBe(false);
      seen.add(result.next.question);
      turn = result.next;
    }

    const interviewId = turn.interviewId;
    // Grades exist server-side even though the client never saw them.
    const answers = await query<{ answer_score: number }>(
      'SELECT answer_score FROM interview_answers WHERE interview_id = $1',
      [interviewId],
    );
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((answer) => answer.answer_score !== null)).toBe(true);

    await query(`UPDATE interviews SET status = 'evaluating' WHERE id = $1`, [interviewId]);
    const { report, learningPlan } = await evaluateInterview(user.id, interviewId);

    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
    expect(report.questionAnalysis.length).toBe(answers.length);
    expect(learningPlan.weeks.length).toBeGreaterThan(0);

    // The whole report is written atomically.
    const evaluation = await queryOne<{ id: string }>('SELECT id FROM evaluations WHERE interview_id = $1', [interviewId]);
    expect(evaluation).not.toBeNull();
    const skillScores = await query('SELECT id FROM skill_scores WHERE evaluation_id = $1', [evaluation?.id]);
    const plans = await query('SELECT id FROM learning_plans WHERE evaluation_id = $1', [evaluation?.id]);
    expect(skillScores.length).toBeGreaterThan(0);
    expect(plans).toHaveLength(1);

    const interview = await queryOne<{ status: string; duration_seconds: number }>(
      'SELECT status, duration_seconds FROM interviews WHERE id = $1', [interviewId],
    );
    expect(interview?.status).toBe('completed');
    expect(interview?.duration_seconds).not.toBeNull();
  });

  it('generates a report once and returns the stored one afterwards', async () => {
    const user = await makeUser('idem');
    const turn = await startInterview({
      userId: user.id, roleTitle: 'Engineer', interviewType: 'technical',
      difficulty: 'easy', plannedQuestions: 3,
    });
    await submitAnswer({
      userId: user.id, interviewId: turn.interviewId, questionId: turn.questionId,
      answerText: STRONG_ANSWER,
    });
    await endInterview(user.id, turn.interviewId);

    const first = await evaluateInterview(user.id, turn.interviewId);
    const second = await evaluateInterview(user.id, turn.interviewId);

    expect(second.evaluationId).toBe(first.evaluationId);
    expect(second.report.overallScore).toBe(first.report.overallScore);
    const evaluations = await query('SELECT id FROM evaluations WHERE interview_id = $1', [turn.interviewId]);
    expect(evaluations).toHaveLength(1);
  });

  it('refuses a second answer to the same question', async () => {
    const user = await makeUser('double');
    const turn = await startInterview({
      userId: user.id, roleTitle: 'Engineer', interviewType: 'technical',
      difficulty: 'medium', plannedQuestions: 5,
    });
    await submitAnswer({
      userId: user.id, interviewId: turn.interviewId, questionId: turn.questionId, answerText: STRONG_ANSWER,
    });
    await expect(
      submitAnswer({
        userId: user.id, interviewId: turn.interviewId, questionId: turn.questionId, answerText: 'again',
      }),
    ).rejects.toThrow(/already been answered/i);
  });

  it('excludes paused time from the recorded duration', async () => {
    const user = await makeUser('pause');
    const turn = await startInterview({
      userId: user.id, roleTitle: 'Engineer', interviewType: 'technical',
      difficulty: 'medium', plannedQuestions: 4,
    });

    await pauseInterview(user.id, turn.interviewId);
    // Answering while paused is refused.
    await expect(
      submitAnswer({
        userId: user.id, interviewId: turn.interviewId, questionId: turn.questionId, answerText: 'hi',
      }),
    ).rejects.toThrow(/paused/i);

    // Simulate two minutes of pause.
    await query(`UPDATE interviews SET paused_at = now() - interval '2 minutes' WHERE id = $1`, [turn.interviewId]);
    await resumeInterview(user.id, turn.interviewId);

    const row = await queryOne<{ paused_seconds: number; status: string }>(
      'SELECT paused_seconds, status FROM interviews WHERE id = $1', [turn.interviewId],
    );
    expect(row?.status).toBe('in_progress');
    expect(row?.paused_seconds).toBeGreaterThanOrEqual(115);
  });

  it('records the cost of every AI call against the interview', async () => {
    const user = await makeUser('cost');
    const turn = await startInterview({
      userId: user.id, roleTitle: 'Engineer', interviewType: 'technical',
      difficulty: 'medium', plannedQuestions: 3,
    });
    await submitAnswer({
      userId: user.id, interviewId: turn.interviewId, questionId: turn.questionId, answerText: STRONG_ANSWER,
    });

    const events = await query<{ task: string; provider: string }>(
      'SELECT task, provider FROM ai_usage_events WHERE interview_id = $1', [turn.interviewId],
    );
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.map((event) => event.task)).toContain('interview_plan');
    expect(events.map((event) => event.task)).toContain('answer_analysis');
    // The offline engine spends nothing, and the ledger says so honestly.
    expect(await interviewCostUsd(turn.interviewId)).toBe(0);
  });
});

describe('cross-user isolation', () => {
  beforeEach(async () => { await truncateAll(); });

  it('hides an interview, its room view and its report from another user', async () => {
    const owner = await makeUser('iso-owner');
    const stranger = await makeUser('iso-stranger');

    const turn = await startInterview({
      userId: owner.id, roleTitle: 'Engineer', interviewType: 'technical',
      difficulty: 'medium', plannedQuestions: 3,
    });
    await submitAnswer({
      userId: owner.id, interviewId: turn.interviewId, questionId: turn.questionId, answerText: STRONG_ANSWER,
    });
    await endInterview(owner.id, turn.interviewId);
    await evaluateInterview(owner.id, turn.interviewId);

    expect(await getInterviewView(stranger.id, turn.interviewId)).toBeNull();
    expect(await getReport(stranger.id, turn.interviewId)).toBeNull();
    expect(await listInterviews(stranger.id)).toHaveLength(0);

    // And the owner still sees everything.
    expect(await getReport(owner.id, turn.interviewId)).not.toBeNull();
    expect(await listInterviews(owner.id)).toHaveLength(1);
  });

  it('refuses to answer a question inside someone else\'s interview', async () => {
    const owner = await makeUser('ans-owner');
    const stranger = await makeUser('ans-stranger');
    const turn = await startInterview({
      userId: owner.id, roleTitle: 'Engineer', interviewType: 'technical',
      difficulty: 'medium', plannedQuestions: 3,
    });

    await expect(
      submitAnswer({
        userId: stranger.id, interviewId: turn.interviewId, questionId: turn.questionId, answerText: 'mine now',
      }),
    ).rejects.toThrow();
  });
});

describe('plan quotas', () => {
  beforeEach(async () => { await truncateAll(); });

  it('refuses once the monthly allowance is spent', async () => {
    const user = await makeUser('quota');
    // The free plan allows three interviews.
    for (let i = 0; i < 3; i += 1) {
      await consumeQuota(user.id, 'free', 'interviews');
    }
    await expect(consumeQuota(user.id, 'free', 'interviews')).rejects.toThrow(AppError);

    const usage = await getUsage(user.id, 'free');
    const interviews = usage.find((entry) => entry.metric === 'interviews');
    // A refused request must not have burned a unit.
    expect(interviews?.used).toBe(3);
    expect(interviews?.remaining).toBe(0);
  });

  it('does not count usage for an unlimited plan', async () => {
    const user = await makeUser('unlimited');
    for (let i = 0; i < 20; i += 1) {
      await consumeQuota(user.id, 'premium', 'interviews');
    }
    const usage = await getUsage(user.id, 'premium');
    expect(usage.find((entry) => entry.metric === 'interviews')?.limit).toBeNull();
  });

  it('refuses a feature the plan excludes outright', async () => {
    const user = await makeUser('voice');
    await expect(consumeQuota(user.id, 'free', 'voice_interviews')).rejects.toThrow(/not included/i);
  });

  it('counts concurrent consumption exactly once each', async () => {
    const user = await makeUser('race');
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => consumeQuota(user.id, 'free', 'interviews')),
    );
    // Three succeed, three are refused — no more and no fewer.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
  });
});

describe('dashboard aggregation', () => {
  beforeEach(async () => { await truncateAll(); });

  it('summarises completed interviews and tracks progression', async () => {
    const user = await makeUser('dash');
    for (let run = 0; run < 2; run += 1) {
      const turn = await startInterview({
        userId: user.id, roleTitle: 'Engineer', interviewType: 'technical',
        difficulty: 'medium', plannedQuestions: 3,
      });
      await submitAnswer({
        userId: user.id, interviewId: turn.interviewId, questionId: turn.questionId, answerText: STRONG_ANSWER,
      });
      await endInterview(user.id, turn.interviewId);
      await evaluateInterview(user.id, turn.interviewId);
    }

    const dashboard = await getDashboard(user.id);
    expect(dashboard.totals.interviewsCompleted).toBe(2);
    expect(dashboard.progression).toHaveLength(2);
    expect(dashboard.totals.latestScore).not.toBeNull();
    expect(dashboard.totals.scoreDelta).not.toBeNull();
    expect(dashboard.skills.length).toBeGreaterThan(0);
  });

  it('returns an empty but valid dashboard for a new account', async () => {
    const user = await makeUser('empty');
    const dashboard = await getDashboard(user.id);

    expect(dashboard.totals.interviewsCompleted).toBe(0);
    expect(dashboard.totals.averageScore).toBeNull();
    expect(dashboard.progression).toEqual([]);
    expect(dashboard.strongestSkill).toBeNull();
  });
});
