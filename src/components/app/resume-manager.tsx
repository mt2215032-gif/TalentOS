'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorNote,
} from '@/components/ui/primitives';

interface ResumeRow {
  id: string;
  fileName: string;
  status: string;
  failureReason: string | null;
  isPrimary: boolean;
  createdAt: string;
  headline: string | null;
  skillCount: number;
  skills: string[];
  probeCount: number;
  yearsExperience: number | null;
}

const MAX_BYTES = 5 * 1024 * 1024;

export function ResumeManager({ initialResumes }: { initialResumes: ResumeRow[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [resumes, setResumes] = useState(initialResumes);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File): Promise<void> {
    setError(null);

    // Checked client-side too so an oversized file fails instantly rather than
    // after a slow upload. The server enforces the real limit.
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 5 MB. Export a smaller PDF and try again.');
      return;
    }

    setUploading(true);
    const form = new FormData();
    form.append('file', file);

    try {
      const result = await api.upload<{ resume: ResumeRow & { analysis: unknown } }>(
        '/api/resumes',
        form,
      );
      router.refresh();
      setResumes((previous) => [
        {
          ...result.resume,
          createdAt: new Date().toISOString(),
          failureReason: null,
          headline: null,
          skillCount: 0,
          skills: [],
          probeCount: 0,
          yearsExperience: null,
        },
        ...previous.filter((resume) => resume.id !== result.resume.id).map((resume) => ({
          ...resume,
          isPrimary: false,
        })),
      ]);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'That file could not be uploaded.',
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function makePrimary(id: string): Promise<void> {
    try {
      await api.patch(`/api/resumes/${id}`, {});
      setResumes((previous) =>
        previous.map((resume) => ({ ...resume, isPrimary: resume.id === id })),
      );
      router.refresh();
    } catch {
      setError('Could not set that CV as primary.');
    }
  }

  async function remove(id: string): Promise<void> {
    if (!window.confirm('Delete this CV? Interviews already run against it keep their reports.')) return;
    try {
      await api.delete(`/api/resumes/${id}`);
      setResumes((previous) => previous.filter((resume) => resume.id !== id));
      router.refresh();
    } catch {
      setError('Could not delete that CV.');
    }
  }

  return (
    <Card>
      <CardHeader
        title="Your CV"
        description="PDF, Word or plain text, up to 5 MB. Only the extracted text is stored — the original file is not retained."
      />

      {error ? <div className="mb-4"><ErrorNote>{error}</ErrorNote></div> : null}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        className={`rounded-[var(--radius-card)] border-2 border-dashed p-8 text-center transition ${
          dragging
            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
            : 'border-[var(--border-strong)]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="sr-only"
          id="cv-upload"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <svg className="mx-auto h-8 w-8 text-[var(--text-subtle)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3" />
        </svg>
        <p className="mt-3 text-[13px] font-medium text-[var(--text)]">
          Drop your CV here, or
        </p>
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            loading={uploading}
            type="button"
          >
            {uploading ? 'Analysing your CV…' : 'Choose a file'}
          </Button>
        </div>
        {uploading ? (
          <p className="mt-3 text-[12px] text-[var(--text-subtle)]">
            Extracting text and identifying the claims worth testing.
          </p>
        ) : null}
      </div>

      {resumes.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No CV uploaded"
            description="Without one, interviews fall back to generic questions for the role title."
          />
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {resumes.map((resume) => (
            <li
              key={resume.id}
              className="rounded-[var(--radius-control)] border border-[var(--border)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]">
                    <span className="truncate">{resume.fileName}</span>
                    {resume.isPrimary ? <Badge tone="accent">Primary</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[var(--text-subtle)]">
                    {new Date(resume.createdAt).toLocaleDateString()}
                    {resume.skillCount > 0 ? ` · ${resume.skillCount} skills` : ''}
                    {resume.probeCount > 0 ? ` · ${resume.probeCount} claims to test` : ''}
                    {resume.yearsExperience !== null ? ` · ${resume.yearsExperience} years` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      resume.status === 'ready' ? 'success'
                      : resume.status === 'failed' ? 'danger'
                      : 'neutral'
                    }
                  >
                    {resume.status}
                  </Badge>
                  {!resume.isPrimary && resume.status === 'ready' ? (
                    <Button variant="ghost" size="sm" onClick={() => void makePrimary(resume.id)}>
                      Make primary
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => void remove(resume.id)}>
                    Delete
                  </Button>
                </div>
              </div>

              {resume.failureReason ? (
                <p className="mt-2 text-[12px] text-[var(--danger)]">{resume.failureReason}</p>
              ) : null}

              {resume.skills.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {resume.skills.map((skill) => (
                    <Badge key={skill}>{skill}</Badge>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
