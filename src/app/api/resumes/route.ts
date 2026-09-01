import { authedRoute, ok } from '@/lib/security/api';
import { ingestResume, listResumes } from '@/lib/resume/service';
import { consumeQuota } from '@/lib/billing/entitlements';
import { AppError } from '@/lib/security/errors';
import { config } from '@/lib/config';
import { track } from '@/lib/analytics/events';

export const runtime = 'nodejs';

export const GET = authedRoute({ rateLimit: 'readApi' }, async ({ user }) => {
  const resumes = await listResumes(user.id);
  return ok({
    resumes: resumes.map((resume) => ({
      id: resume.id,
      fileName: resume.file_name,
      status: resume.status,
      failureReason: resume.failure_reason,
      isPrimary: resume.is_primary,
      createdAt: resume.created_at,
      // The full analysis is large; the list view needs the summary only.
      skillCount: resume.analysis?.skills.length ?? 0,
      headline: resume.analysis?.headline ?? null,
      yearsExperience: resume.analysis?.totalYearsExperience ?? null,
    })),
  });
});

/**
 * Upload and analyse a CV.
 *
 * multipart/form-data rather than JSON, so the file never has to be
 * base64-encoded into a request body.
 */
export const POST = authedRoute({ rateLimit: 'resumeUpload' }, async ({ request, user }) => {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    throw new AppError('unsupported_media_type', 'Send the file as multipart/form-data.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError('bad_request', 'That upload could not be read.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new AppError('bad_request', 'Attach a CV file to upload.');
  }
  // Checked before reading the body into memory, so an oversized upload is
  // rejected rather than buffered.
  if (file.size > config.uploads.maxBytes) {
    const megabytes = Math.round(config.uploads.maxBytes / (1024 * 1024));
    throw new AppError('payload_too_large', `Files must be ${megabytes} MB or smaller.`);
  }

  await consumeQuota(user.id, user.plan, 'resume_analyses');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const resume = await ingestResume({
    userId: user.id,
    fileName: file.name || 'cv',
    bytes,
  });

  await track({
    userId: user.id,
    event: 'resume_analyzed',
    entityId: resume.id,
    props: { skills: resume.analysis?.skills.length ?? 0 },
  });

  return ok(
    {
      resume: {
        id: resume.id,
        fileName: resume.file_name,
        status: resume.status,
        isPrimary: resume.is_primary,
        analysis: resume.analysis,
      },
    },
    { status: 201 },
  );
});
