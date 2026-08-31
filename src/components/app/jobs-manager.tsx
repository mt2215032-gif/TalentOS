'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, inputClass,
} from '@/components/ui/primitives';
import { useHydrated } from '@/components/ui/use-hydrated';

interface JobRow {
  id: string;
  title: string;
  company: string | null;
  seniority: string | null;
  status: string;
  createdAt: string;
  skillCount: number;
}

interface JobDetail {
  job: { id: string; title: string; description: string };
  skills: Array<{
    key: string; label: string; category: string;
    requirement: string; importance: string; weight: number;
  }>;
  fit: Array<{ label: string; requirement: string; importance: string; claimedOnCv: boolean }>;
}

const IMPORTANCE_TONE: Record<string, 'danger' | 'warning' | 'neutral' | 'accent'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'neutral',
  low: 'neutral',
};

export function JobsManager({ initialJobs }: { initialJobs: JobRow[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const hydrated = useHydrated();

  async function addJob(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await api.post<{ job: { id: string; title: string; status: string } }>(
        '/api/jobs',
        {
          title: title.trim(),
          company: company.trim() || null,
          description: description.trim(),
        },
      );
      setJobs((previous) => [
        {
          id: result.job.id,
          title: result.job.title,
          company: company.trim() || null,
          seniority: null,
          status: result.job.status,
          createdAt: new Date().toISOString(),
          skillCount: 0,
        },
        ...previous,
      ]);
      setTitle('');
      setCompany('');
      setDescription('');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fields);
        setError(caught.message);
      } else {
        setError('The job could not be analysed. Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  async function openDetail(id: string): Promise<void> {
    if (detail?.job.id === id) {
      setDetail(null);
      return;
    }
    setDetailLoading(id);
    try {
      setDetail(await api.get<JobDetail>(`/api/jobs/${id}`));
    } catch {
      setError('Could not load that job.');
    } finally {
      setDetailLoading(null);
    }
  }

  async function removeJob(id: string): Promise<void> {
    if (!window.confirm('Delete this job? Interviews already run against it keep their reports.')) return;
    try {
      await api.delete(`/api/jobs/${id}`);
      setJobs((previous) => previous.filter((job) => job.id !== id));
      if (detail?.job.id === id) setDetail(null);
      router.refresh();
    } catch {
      setError('Could not delete that job.');
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Add a job description"
          description="Paste the posting. Requirements under a “must have” heading are weighted above a “nice to have”."
        />
        <form onSubmit={addJob} className="space-y-4" noValidate>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Job title" htmlFor="jobTitle" error={fieldErrors['title']}>
              <input
                id="jobTitle"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={inputClass}
                placeholder="Senior Data Engineer"
                required
                maxLength={160}
              />
            </Field>
            <Field label="Company" htmlFor="company" hint="Optional.">
              <input
                id="company"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                className={inputClass}
                placeholder="Northwind"
                maxLength={160}
              />
            </Field>
          </div>
          <Field
            label="Job description"
            htmlFor="description"
            error={fieldErrors['description']}
            hint={`${description.trim().length} characters — paste the full posting for the best skill matrix.`}
          >
            <textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={`${inputClass} min-h-[180px] resize-y leading-relaxed`}
              placeholder="Paste the responsibilities, requirements and nice-to-haves…"
              required
              maxLength={40000}
            />
          </Field>
          <Button type="submit" loading={pending} disabled={!hydrated}>
            {pending ? 'Analysing…' : 'Analyse job description'}
          </Button>
        </form>
      </Card>

      {jobs.length === 0 ? (
        <EmptyState
          title="No jobs yet"
          description="Add a posting above and every interview you run against it will be targeted at what it actually asks for."
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Card key={job.id} padded={false}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[var(--text)]">{job.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--text-subtle)]">
                    {job.company ? <span>{job.company}</span> : null}
                    {job.seniority ? <span>· {job.seniority}</span> : null}
                    <span>· {new Date(job.createdAt).toLocaleDateString()}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={job.status === 'ready' ? 'success' : job.status === 'failed' ? 'danger' : 'neutral'}>
                    {job.status}
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void openDetail(job.id)}
                    loading={detailLoading === job.id}
                  >
                    {detail?.job.id === job.id ? 'Hide' : 'Skill matrix'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void removeJob(job.id)}>
                    Delete
                  </Button>
                </div>
              </div>

              {detail?.job.id === job.id ? (
                <div className="border-t border-[var(--border)] px-5 py-4">
                  <h3 className="text-[13px] font-semibold text-[var(--text)]">
                    Job skill matrix
                  </h3>
                  <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                    Weight drives how many questions each skill earns in an interview.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-[13px]">
                      <thead>
                        <tr className="text-[12px] text-[var(--text-subtle)]">
                          <th className="py-2 font-medium">Skill</th>
                          <th className="py-2 font-medium">Requirement</th>
                          <th className="py-2 font-medium">Importance</th>
                          <th className="py-2 text-right font-medium">Weight</th>
                          <th className="py-2 text-right font-medium">On your CV</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.skills.map((skill) => {
                          const fit = detail.fit.find((entry) => entry.label === skill.label);
                          return (
                            <tr key={skill.key} className="border-t border-[var(--border)]">
                              <td className="py-2 font-medium text-[var(--text)]">{skill.label}</td>
                              <td className="py-2 text-[var(--text-muted)]">
                                {skill.requirement.replace('_', ' ')}
                              </td>
                              <td className="py-2">
                                <Badge tone={IMPORTANCE_TONE[skill.importance] ?? 'neutral'}>
                                  {skill.importance}
                                </Badge>
                              </td>
                              <td className="py-2 text-right tabular-nums text-[var(--text-muted)]">
                                {skill.weight.toFixed(2)}
                              </td>
                              <td className="py-2 text-right">
                                {fit?.claimedOnCv ? (
                                  <span className="text-[var(--success)]">Claimed</span>
                                ) : (
                                  <span className="text-[var(--text-subtle)]">Not found</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-subtle)]">
                    “Claimed” means the skill appears on your CV — not that you have demonstrated it.
                    That is what the interview establishes.
                  </p>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
