'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { Badge, Button, ErrorNote, ProgressBar, buttonClass } from '@/components/ui/primitives';
import { DIFFICULTY_LABELS, INTERVIEW_TYPE_LABELS, QUESTION_CATEGORY_LABELS } from '@/lib/schemas/domain';
import type { Difficulty, InterviewType, QuestionCategory } from '@/lib/schemas/domain';
import { Logo } from '@/components/marketing/nav';

/**
 * The interview room.
 *
 * Deliberately not a chat log. The current question is the focus of the screen;
 * previous turns are collapsed into a transcript panel. Nothing here displays a
 * score — the server does not send one, and showing a running grade would
 * change how the candidate answers the rest.
 */

export interface RoomQuestion {
  id: string;
  position: number;
  question: string;
  category: string;
  skillLabel: string | null;
  difficulty: Difficulty;
}

export interface RoomInterview {
  id: string;
  roleTitle: string;
  interviewType: InterviewType;
  difficulty: Difficulty;
  currentDifficulty: Difficulty;
  status: string;
  askedCount: number;
  answeredCount: number;
  plannedQuestions: number;
  engineProvider: string;
}

interface Props {
  interview: RoomInterview;
  currentQuestion: RoomQuestion | null;
  history: Array<{ position: number; question: string; skillLabel: string | null; answer: string }>;
}

export function InterviewRoom({ interview: initial, currentQuestion: initialQuestion, history: initialHistory }: Props) {
  const router = useRouter();

  const [interview, setInterview] = useState(initial);
  const [question, setQuestion] = useState<RoomQuestion | null>(initialQuestion);
  const [history, setHistory] = useState(initialHistory);
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(initial.status === 'completed' || initial.status === 'evaluating');
  const [elapsed, setElapsed] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);

  const questionShownAt = useRef<number>(Date.now());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paused = interview.status === 'paused';

  // Reset the response timer whenever a new question arrives.
  useEffect(() => {
    questionShownAt.current = Date.now();
    setElapsed(0);
    if (question && !paused) textareaRef.current?.focus();
  }, [question?.id, paused, question]);

  useEffect(() => {
    if (paused || finished || !question) return;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - questionShownAt.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [paused, finished, question]);

  const submit = useCallback(
    async (text: string) => {
      if (!question || pending) return;
      setPending(true);
      setError(null);

      try {
        const result = await api.post<{
          next: RoomQuestion & { plannedQuestions: number } | null;
          isComplete: boolean;
          answeredCount: number;
        }>(`/api/interviews/${interview.id}/answer`, {
          questionId: question.id,
          answerText: text,
          responseSeconds: Math.floor((Date.now() - questionShownAt.current) / 1000),
          transcriptSource: 'text',
        });

        setHistory((previous) => [
          ...previous,
          {
            position: question.position,
            question: question.question,
            skillLabel: question.skillLabel,
            answer: text,
          },
        ]);
        setAnswer('');
        setInterview((previous) => ({
          ...previous,
          answeredCount: result.answeredCount,
          askedCount: result.next ? result.next.position : previous.askedCount,
          currentDifficulty: result.next?.difficulty ?? previous.currentDifficulty,
        }));

        if (result.isComplete || !result.next) {
          setFinished(true);
          setQuestion(null);
        } else {
          setQuestion(result.next);
        }
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Your answer could not be submitted. Please try again.',
        );
      } finally {
        setPending(false);
      }
    },
    [interview.id, question, pending],
  );

  async function control(action: 'pause' | 'resume' | 'end'): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api.post(`/api/interviews/${interview.id}/${action}`);
      if (action === 'end') {
        setFinished(true);
        setQuestion(null);
      } else {
        setInterview((previous) => ({
          ...previous,
          status: action === 'pause' ? 'paused' : 'in_progress',
        }));
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That action failed. Please try again.');
    } finally {
      setPending(false);
    }
  }

  // Ctrl/Cmd+Enter submits, which is what people expect in a text box that
  // accepts paragraphs.
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (answer.trim().length > 0) void submit(answer);
    }
  }

  const progress = interview.plannedQuestions === 0 ? 0 : (interview.answeredCount / interview.plannedQuestions) * 100;
  const wordCount = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  if (finished) {
    return <FinishedPanel interviewId={interview.id} answered={interview.answeredCount} />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      {/* ── Interview column ────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-4">
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
          {/* Interviewer identity, so the screen reads as a room not a form. */}
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)]">
              <Logo size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[var(--text)]">Interviewer</p>
              <p className="truncate text-[12px] text-[var(--text-subtle)]">
                {interview.roleTitle} · {INTERVIEW_TYPE_LABELS[interview.interviewType]}
              </p>
            </div>
            {paused ? <Badge tone="warning">Paused</Badge> : <LiveDot />}
          </div>

          <div className="px-5 py-6 sm:px-7 sm:py-8">
            {question ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium text-[var(--text-subtle)]">
                    Question {question.position} of {interview.plannedQuestions}
                  </span>
                  {question.skillLabel ? <Badge tone="accent">{question.skillLabel}</Badge> : null}
                  <Badge>{QUESTION_CATEGORY_LABELS[question.category as QuestionCategory] ?? question.category}</Badge>
                </div>
                <p
                  key={question.id}
                  className="animate-fade-rise text-[19px] font-medium leading-relaxed tracking-[-0.01em] text-[var(--text)] sm:text-[21px]"
                >
                  {question.question}
                </p>
              </>
            ) : (
              <p className="text-[15px] text-[var(--text-muted)]">Preparing the next question…</p>
            )}
          </div>
        </div>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {paused ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
            <p className="text-[14px] font-medium text-[var(--text)]">This interview is paused.</p>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              Paused time is not counted against your interview duration.
            </p>
            <Button className="mt-4" onClick={() => void control('resume')} loading={pending}>
              Resume interview
            </Button>
          </div>
        ) : (
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
            <label htmlFor="answer" className="sr-only">
              Your answer
            </label>
            <textarea
              ref={textareaRef}
              id="answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={pending || !question}
              rows={7}
              maxLength={20000}
              placeholder="Answer as you would out loud. Specifics — what you did, why, and what it produced — score better than generalities."
              className="w-full resize-y rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--bg)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--text)] placeholder:text-[var(--text-subtle)] transition focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] disabled:opacity-60"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-[12px] text-[var(--text-subtle)]">
                <span className="tabular-nums">{wordCount} words</span>
                <span className="tabular-nums">{formatClock(elapsed)}</span>
                <span className="hidden sm:inline">⌘↵ to submit</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void submit('')}
                  disabled={pending || !question}
                  title="Skip this question. It will be scored as unanswered."
                >
                  Skip
                </Button>
                <Button
                  onClick={() => void submit(answer)}
                  loading={pending}
                  disabled={!question || answer.trim().length === 0}
                >
                  Submit answer
                </Button>
              </div>
            </div>
          </div>
        )}

        {history.length > 0 ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
            <button
              type="button"
              onClick={() => setShowTranscript((value) => !value)}
              className="flex w-full items-center justify-between px-5 py-3 text-[13px] font-medium text-[var(--text)]"
              aria-expanded={showTranscript}
            >
              Transcript so far ({history.length})
              <svg
                className={`h-4 w-4 text-[var(--text-subtle)] transition-transform ${showTranscript ? 'rotate-180' : ''}`}
                viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="m4 6 4 4 4-4" />
              </svg>
            </button>
            {showTranscript ? (
              <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                {history.map((turn) => (
                  <li key={turn.position} className="px-5 py-4">
                    <p className="text-[12px] font-medium text-[var(--text-subtle)]">
                      Q{turn.position}
                      {turn.skillLabel ? ` · ${turn.skillLabel}` : ''}
                    </p>
                    <p className="mt-1 text-[13px] font-medium leading-relaxed text-[var(--text)]">
                      {turn.question}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-muted)]">
                      {turn.answer || <span className="italic">Skipped.</span>}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── Progress rail ───────────────────────────────────────────────── */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
          <h2 className="text-[13px] font-semibold text-[var(--text)]">Progress</h2>
          <p className="mt-3 flex items-baseline gap-1.5">
            <span className="text-[28px] font-semibold leading-none tabular-nums text-[var(--text)]">
              {interview.answeredCount}
            </span>
            <span className="text-[13px] text-[var(--text-subtle)]">
              / {interview.plannedQuestions} answered
            </span>
          </p>
          <ProgressBar value={progress} className="mt-3" />

          <dl className="mt-5 space-y-3 border-t border-[var(--border)] pt-4 text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[var(--text-subtle)]">Current topic</dt>
              <dd className="truncate font-medium text-[var(--text)]">
                {question?.skillLabel ?? '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[var(--text-subtle)]">Difficulty now</dt>
              <dd>
                <Badge tone={interview.currentDifficulty === interview.difficulty ? 'neutral' : 'accent'}>
                  {DIFFICULTY_LABELS[interview.currentDifficulty]}
                </Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[var(--text-subtle)]">Started at</dt>
              <dd className="font-medium text-[var(--text)]">
                {DIFFICULTY_LABELS[interview.difficulty]}
              </dd>
            </div>
          </dl>

          {interview.currentDifficulty !== interview.difficulty ? (
            <p className="mt-3 rounded-[var(--radius-control)] bg-[var(--accent-soft)] px-3 py-2 text-[11px] leading-relaxed text-[var(--accent-text)]">
              The interviewer has adjusted difficulty based on your answers.
            </p>
          ) : null}
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-col gap-2">
            {!paused ? (
              <Button variant="secondary" size="sm" onClick={() => void control('pause')} disabled={pending}>
                Pause interview
              </Button>
            ) : null}
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (
                  window.confirm(
                    'End this interview now? You will get a report from the questions you have answered so far.',
                  )
                ) {
                  void control('end');
                }
              }}
              disabled={pending}
            >
              End and get report
            </Button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-subtle)]">
            Your answers are scored after the interview. Nothing is revealed while it is running.
          </p>
        </div>
      </aside>
    </div>
  );
}

function LiveDot() {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--success)]">
      <span className="animate-pulse-soft h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
      Live
    </span>
  );
}

function FinishedPanel({ interviewId, answered }: { interviewId: string; answered: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api.post(`/api/interviews/${interviewId}/report`);
      router.push(`/interviews/${interviewId}/report`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The report could not be generated. Please try again.',
      );
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow-md)]">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--success-soft)]">
        <svg className="h-5 w-5 text-[var(--success)]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m4 10 4 4 8-8" />
        </svg>
      </div>
      <h2 className="mt-4 text-[19px] font-semibold tracking-tight text-[var(--text)]">
        Interview complete
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
        You answered {answered} question{answered === 1 ? '' : 's'}. Generating the report analyses
        every answer against what the question was looking for.
      </p>
      {error ? <div className="mt-4"><ErrorNote>{error}</ErrorNote></div> : null}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button onClick={() => void generate()} loading={pending} size="lg">
          {pending ? 'Analysing your answers…' : 'Generate my report'}
        </Button>
        <a href="/interviews" className={buttonClass('secondary', 'lg')}>
          Back to interviews
        </a>
      </div>
    </div>
  );
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
