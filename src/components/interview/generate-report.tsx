'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { Button, Card, ErrorNote } from '@/components/ui/primitives';

/**
 * Shown when an interview exists but its report has not been generated.
 *
 * Generation is explicit rather than automatic because it is the most expensive
 * call in the product, and an interview abandoned at question one should not
 * silently spend on a report nobody asked for.
 */
export function GenerateReportPrompt({
  interviewId,
  roleTitle,
  answered,
  canGenerate,
}: {
  interviewId: string;
  roleTitle: string;
  answered: number;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api.post(`/api/interviews/${interviewId}/report`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The report could not be generated. Please try again.',
      );
      setPending(false);
    }
  }

  return (
    <Card raised className="text-center">
      <h1 className="text-[19px] font-semibold tracking-tight text-[var(--text)]">
        Report not generated yet
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
        {canGenerate
          ? `Your ${roleTitle} interview has ${answered} answered question${answered === 1 ? '' : 's'} ready to evaluate.`
          : 'This interview has no answered questions, so there is nothing to evaluate.'}
      </p>
      {error ? <div className="mt-4 text-left"><ErrorNote>{error}</ErrorNote></div> : null}
      <div className="mt-5">
        <Button onClick={() => void generate()} loading={pending} disabled={!canGenerate}>
          {pending ? 'Analysing your answers…' : 'Generate report'}
        </Button>
      </div>
    </Card>
  );
}
