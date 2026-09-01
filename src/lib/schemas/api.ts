import { z } from 'zod';
import {
  DifficultySchema,
  InterviewTypeSchema,
  SenioritySchema,
} from '@/lib/schemas/domain';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

/**
 * Request validation.
 *
 * Every API route parses its body through one of these. Messages are written to
 * be shown directly next to a form field, since that is where they end up.
 */

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Enter your email address.')
  .max(254, 'That email address is too long.')
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid email address.');

export const PasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, 'That password is too long.');

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  fullName: z.string().trim().max(160).optional(),
});

export const LoginSchema = z.object({
  email: EmailSchema,
  // Length is not enforced on login: an existing password must still work if
  // the policy is tightened later.
  password: z.string().min(1, 'Enter your password.').max(MAX_PASSWORD_LENGTH),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: PasswordSchema,
});

export const ProfileUpdateSchema = z.object({
  fullName: z.string().trim().max(160).nullable().optional(),
  headline: z.string().trim().max(200).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  links: z.record(z.string().max(40), z.string().url('Enter a valid URL.').max(300)).optional(),
  yearsExperience: z.number().min(0).max(60).nullable().optional(),
  seniority: SenioritySchema.nullable().optional(),
  targetRole: z.string().trim().max(160).nullable().optional(),
  targetIndustry: z.string().trim().max(160).nullable().optional(),
  onboardingDone: z.boolean().optional(),
});

export const CreateJobSchema = z.object({
  title: z.string().trim().min(2, 'Give this role a title.').max(160),
  company: z.string().trim().max(160).nullable().optional(),
  sourceUrl: z.string().url('Enter a valid URL.').max(300).nullable().optional(),
  description: z
    .string()
    .trim()
    .min(80, 'Paste the full job description — at least a paragraph so it can be analysed.')
    .max(40_000, 'That job description is too long. Paste the relevant sections.'),
});

export const StartInterviewSchema = z.object({
  roleTitle: z.string().trim().min(2, 'Enter the role you are interviewing for.').max(160),
  interviewType: InterviewTypeSchema,
  difficulty: DifficultySchema,
  questionCount: z
    .number()
    .int()
    .min(3, 'An interview needs at least 3 questions.')
    .max(20, 'Keep interviews to 20 questions or fewer.')
    .default(8),
  jobId: z.string().uuid('That job could not be found.').nullable().optional(),
  resumeId: z.string().uuid('That CV could not be found.').nullable().optional(),
});

export const SubmitAnswerSchema = z.object({
  questionId: z.string().uuid(),
  answerText: z
    .string()
    .max(20_000, 'That answer is longer than this interview accepts.')
    // Empty is allowed: skipping is a legitimate action and is scored as such.
    .default(''),
  responseSeconds: z.number().int().min(0).max(7200).nullable().optional(),
  transcriptSource: z.enum(['text', 'speech']).default('text'),
});

export const SetPrimaryResumeSchema = z.object({
  resumeId: z.string().uuid(),
});

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type StartInterviewInput = z.infer<typeof StartInterviewSchema>;
export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;
