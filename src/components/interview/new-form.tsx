'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import {
  Badge, Button, Card, ErrorNote, Field, inputClass,
} from '@/components/ui/primitives';
import { DIFFICULTY_LABELS, INTERVIEW_TYPE_LABELS } from '@/lib/schemas/domain';
import type { Difficulty, InterviewType } from '@/lib/schemas/domain';

interface Props {
  jobs: Array<{ id: string; title: string; company: string | null }>;
  resumes: Array<{ id: string; fileName: string; isPrimary: boolean }>;
  /** null means unlimited on this plan. */
  remaining: number | null;
}

const TYPE_HINTS: Record<InterviewType, string> = {
  behavioral: 'Communication, teamwork, conflict and ownership.',
  technical: 'Depth in the technologies the role actually needs.',
  hr: 'Motivation, background and fit — a screening call.',
  case_study: 'An ambiguous problem, judged on how you structure it.',
  system_design: 'Constraints, components and the first bottleneck.',
  mixed: 'Moves between technical depth and behavioural evidence.',
};

const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  easy: 'Fundamentals, gently paced.',
  medium: 'A realistic mid-level bar.',
  hard: 'Senior expectations, less benefit of the doubt.',
  expert: 'Staff level. Assumes depth and pushes hard.',
};

export function NewInterviewForm({ jobs, resumes, remaining }: Props) {
  const router = useRouter();

  const primaryResume = resumes.find((resume) => resume.isPrimary) ?? resumes[0];
  const [roleTitle, setRoleTitle] = useState('');
  const [interviewType, setInterviewType] = useState<InterviewType>('technical');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [questionCount, setQuestionCount] = useState(8);
  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? '');
  const [resumeId, setResumeId] = useState<string>(primaryResume?.id ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const outOfQuota = remaining !== null && remaining <= 0;

  // Selecting a job with no role title typed is the common case, so the job's
  // title fills the field rather than making the user retype it.
  function onJobChange(value: string): void {
    setJobId(value);
    const job = jobs.find((entry) => entry.id === value);
    if (job && roleTitle.trim() === '') setRoleTitle(job.title);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await api.post<{ turn: { interviewId: string } }>('/api/interviews', {
        roleTitle: roleTitle.trim(),
        interviewType,
        difficulty,
        questionCount,
        jobId: jobId || null,
        resumeId: resumeId || null,
      });
      router.push(`/interviews/${result.turn.interviewId}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fields);
        setError(caught.message);
      } else {
        setError('Could not start the interview. Please try again.');
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {outOfQuota ? (
        <Card className="border-[var(--warning)]/40 bg-[var(--warning-soft)]">
          <p className="text-[13px] font-medium text-[var(--warning)]">
            You have used every interview in your plan this month.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--warning)]">
            Your quota resets at the start of next month.
          </p>
        </Card>
      ) : null}

      <Card>
        <Field
          label="Role you are interviewing for"
          htmlFor="roleTitle"
          error={fieldErrors['roleTitle']}
          hint="This shapes every question, so be specific."
        >
          <input
            id="roleTitle"
            value={roleTitle}
            onChange={(event) => setRoleTitle(event.target.value)}
            className={inputClass}
            placeholder="Senior Data Engineer"
            required
            maxLength={160}
          />
        </Field>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-3 text-[13px] font-medium text-[var(--text)]">Interview type</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(INTERVIEW_TYPE_LABELS) as InterviewType[]).map((type) => (
              <label
                key={type}
                className={`flex cursor-pointer gap-3 rounded-[var(--radius-control)] border p-3 transition ${
                  interviewType === type
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                <input
                  type="radio"
                  name="interviewType"
                  value={type}
                  checked={interviewType === type}
                  onChange={() => setInterviewType(type)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-[var(--text)]">
                    {INTERVIEW_TYPE_LABELS[type]}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                    {TYPE_HINTS[type]}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-3 text-[13px] font-medium text-[var(--text)]">Difficulty</legend>
          <div className="grid gap-2 sm:grid-cols-4">
            {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((level) => (
              <label
                key={level}
                className={`cursor-pointer rounded-[var(--radius-control)] border p-3 text-center transition ${
                  difficulty === level
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                <input
                  type="radio"
                  name="difficulty"
                  value={level}
                  checked={difficulty === level}
                  onChange={() => setDifficulty(level)}
                  className="sr-only"
                />
                <span className="block text-[13px] font-medium text-[var(--text)]">
                  {DIFFICULTY_LABELS[level]}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">{DIFFICULTY_HINTS[difficulty]}</p>
          <p className="mt-1 text-[12px] text-[var(--text-subtle)]">
            Difficulty adapts during the interview based on how you answer, staying within one step
            of what you choose here.
          </p>
        </fieldset>
      </Card>

      <Card>
        <Field
          label={`Questions: ${questionCount}`}
          htmlFor="questionCount"
          hint="Roughly two minutes per question."
        >
          <input
            id="questionCount"
            type="range"
            min={3}
            max={20}
            step={1}
            value={questionCount}
            onChange={(event) => setQuestionCount(Number.parseInt(event.target.value, 10))}
            className="w-full accent-[var(--accent)]"
          />
        </Field>
      </Card>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Job description"
            htmlFor="jobId"
            hint={jobs.length === 0 ? undefined : 'Targets the questions at this posting.'}
          >
            {jobs.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                No analysed jobs yet.{' '}
                <Link href="/jobs" className="font-medium text-[var(--accent-text)] hover:underline">
                  Add one
                </Link>{' '}
                for questions built from a real posting.
              </p>
            ) : (
              <select
                id="jobId"
                value={jobId}
                onChange={(event) => onJobChange(event.target.value)}
                className={inputClass}
              >
                <option value="">None — general interview</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                    {job.company ? ` · ${job.company}` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="CV"
            htmlFor="resumeId"
            hint={resumes.length === 0 ? undefined : 'Lets the interviewer test what you claim.'}
          >
            {resumes.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                No CV uploaded.{' '}
                <Link href="/profile" className="font-medium text-[var(--accent-text)] hover:underline">
                  Upload one
                </Link>{' '}
                so the interviewer can probe your actual experience.
              </p>
            ) : (
              <select
                id="resumeId"
                value={resumeId}
                onChange={(event) => setResumeId(event.target.value)}
                className={inputClass}
              >
                <option value="">None</option>
                {resumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.fileName}
                    {resume.isPrimary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" loading={pending} disabled={outOfQuota}>
          {pending ? 'Preparing your interview…' : 'Start interview'}
        </Button>
        {remaining !== null ? (
          <Badge tone={remaining > 0 ? 'neutral' : 'warning'}>
            {remaining} left this month
          </Badge>
        ) : null}
      </div>
      {pending ? (
        <p className="text-[12px] text-[var(--text-subtle)]">
          Building your interview plan and first question — this takes a few seconds.
        </p>
      ) : null}
    </form>
  );
}
