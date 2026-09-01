/**
 * Development seed: `npm run db:seed`
 *
 * Creates one demo account with a CV, a job description and two completed
 * interviews, so the dashboard, charts and reports have something real to
 * render while developing.
 *
 * It refuses to run against a production database — seeded accounts with known
 * passwords have no business in one.
 */
import { config } from '@/lib/config';
import { closePool, query } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrate';
import { createUser, findUserByEmail } from '@/lib/db/repositories/users';
import { ingestResume } from '@/lib/resume/service';
import { createJob } from '@/lib/job/service';
import { startInterview, submitAnswer, endInterview } from '@/lib/interview/engine';
import { evaluateInterview } from '@/lib/interview/evaluation';

const DEMO_EMAIL = 'demo@talentos.dev';
const DEMO_PASSWORD = 'demo-password-2026';

const CV = `Maria Torres
Senior Data Engineer

PROFESSIONAL SUMMARY
Data engineer with seven years building analytics platforms for fintech.

EXPERIENCE
Senior Data Engineer - Northwind Bank, 2021 - Present
- Built a streaming ingestion pipeline with Kafka and Spark processing 40 million events per day
- Reduced nightly ETL runtime from 3 hours to 25 minutes by repartitioning on event_date
- Led a team of 4 engineers and mentored two juniors

Data Analyst - Bright Retail, 2018 - 2021
- Developed Power BI dashboards used by 200 stakeholders
- Wrote complex SQL against PostgreSQL for finance reporting

PROJECTS
Churn Prediction Service
- Built a churn model in Python with scikit-learn, evaluated with cross validation, deployed on AWS

EDUCATION
BSc in Computer Science - University of Valencia, 2014 - 2018

SKILLS
Python, SQL, Spark, Kafka, Airflow, Power BI, AWS, Docker`;

const JOB = `Senior Data Engineer
We are looking for a Senior Data Engineer to own our analytics platform.

Responsibilities
- You will design and build batch and streaming data pipelines
- Own data quality and lead the migration to a modern warehouse
- Collaborate with analysts and product teams

Required
- 5+ years of experience with Python and SQL
- Strong experience with Spark and Airflow
- Excellent communication skills

Nice to have
- Experience with dbt
- Power BI or Tableau exposure`;

/** Answers of deliberately mixed quality, so the reports are not uniform. */
const ANSWERS = [
  'I owned our Airflow deployment at Northwind. The nightly ETL was one DAG taking 3 hours, so I split it into 12 task groups with per-task retries, because a single failure re-ran everything. Moving to a Celery executor with 6 workers brought the run to 25 minutes. The trade-off was operational complexity, so I added SLA alerts rather than relying on someone watching the UI.',
  'I think we used it sometimes for reports.',
  'For the finance report I replaced a correlated subquery with a window function. The original scanned the fact table once per row, 200 million rows, taking 40 seconds. The window function does one pass and finishes in 2 seconds. I verified the results matched with an EXCEPT query before shipping.',
  'When our Kafka consumer lag spiked I checked consumer group offsets first rather than guessing. The lag was on one partition, which pointed at a hot key: we partitioned by customer_id and one enterprise customer was 40% of volume. I moved to a composite key of customer and event type.',
  'Not something I have done much of.',
  'We disagreed about adopting dbt. I thought it added a layer we did not need; my colleague argued it made transformations testable. I asked him to prototype one model, and the test coverage convinced me. We adopted it, and I was wrong about the overhead.',
];

async function main(): Promise<void> {
  if (config.isProduction) {
    throw new Error('Refusing to seed a production database.');
  }

  await runMigrations();

  const existing = await findUserByEmail(DEMO_EMAIL);
  if (existing) {
    console.log(`Demo account already exists (${DEMO_EMAIL}). Nothing to do.`);
    return;
  }

  const user = await createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    fullName: 'Maria Torres',
  });
  console.log(`Created ${DEMO_EMAIL}`);

  const resume = await ingestResume({
    userId: user.id,
    fileName: 'maria-torres-cv.txt',
    bytes: new TextEncoder().encode(CV),
  });
  console.log(`Analysed CV: ${resume.analysis?.skills.length ?? 0} skills`);

  const job = await createJob({
    userId: user.id,
    title: 'Senior Data Engineer',
    company: 'Northwind',
    description: JOB,
  });
  console.log(`Analysed job: ${job.analysis?.skills.length ?? 0} skills in the matrix`);

  // Two interviews at rising difficulty, so the progression chart has a shape.
  for (const [index, difficulty] of (['medium', 'hard'] as const).entries()) {
    let turn = await startInterview({
      userId: user.id,
      roleTitle: 'Senior Data Engineer',
      interviewType: 'technical',
      difficulty,
      plannedQuestions: 6,
      jobId: job.id,
      resumeId: resume.id,
    });

    for (let step = 0; step < ANSWERS.length; step += 1) {
      const result = await submitAnswer({
        userId: user.id,
        interviewId: turn.interviewId,
        questionId: turn.questionId,
        // The second run answers better, so the score improves.
        answerText: index === 1 && step === 1 ? ANSWERS[0]! : ANSWERS[step]!,
        responseSeconds: 60 + step * 5,
      });
      if (result.isComplete || !result.next) break;
      turn = result.next;
    }

    await endInterview(user.id, turn.interviewId).catch(() => {});
    const { report } = await evaluateInterview(user.id, turn.interviewId);
    console.log(`Interview ${index + 1} (${difficulty}): scored ${report.overallScore}/100`);
  }

  const rows = await query<{ count: string }>(
    'SELECT count(*)::text AS count FROM interviews WHERE user_id = $1',
    [user.id],
  );
  const count = rows[0]?.count ?? '0';
  console.log(`\nDone. Sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD} — ${count} interviews seeded.`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
