import { z } from 'zod';
import {
  ClaimedLevelSchema,
  ConfidenceSchema,
  CvConsistencySchema,
  DifficultySchema,
  ImportanceSchema,
  QuestionCategorySchema,
  RecommendationKindSchema,
  RequirementSchema,
  ScoreSchema,
  SenioritySchema,
  SkillCategorySchema,
  SkillLevelSchema,
  VerdictSchema,
} from '@/lib/schemas/domain';

/**
 * Structured contracts for every AI call in the platform.
 *
 * Each schema serves two jobs: `z.toJSONSchema` turns it into the JSON Schema
 * sent to the provider, and the same object validates whatever comes back. A
 * model response that does not parse is never written to the database.
 *
 * `.describe()` text is not decoration — it is shipped to the model as field
 * documentation and is the main lever for output quality.
 */

// ── CandidateAnalysis ──────────────────────────────────────────────────────

export const CandidateSkillSchema = z.object({
  label: z.string().min(1).max(80).describe('Skill exactly as a recruiter would write it, e.g. "PostgreSQL".'),
  category: SkillCategorySchema,
  claimedLevel: ClaimedLevelSchema.nullable()
    .describe('Level the CV claims or implies. Null when the CV gives no signal.'),
  yearsUsed: z.number().min(0).max(50).nullable()
    .describe('Years of use if the CV states or clearly implies it, else null.'),
  evidence: z.string().max(400).nullable()
    .describe('Short quote or paraphrase from the CV supporting this skill. Null if merely listed.'),
});

export const CandidateExperienceSchema = z.object({
  company: z.string().max(160).nullable(),
  title: z.string().max(160).nullable(),
  startDate: z.string().max(40).nullable().describe('As written in the CV, e.g. "Mar 2022".'),
  endDate: z.string().max(40).nullable().describe('As written, or null when current.'),
  isCurrent: z.boolean(),
  summary: z.string().max(1200).nullable(),
  achievements: z.array(z.string().max(400)).max(8),
  technologies: z.array(z.string().max(60)).max(20),
});

export const CandidateProjectSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1200).nullable(),
  technologies: z.array(z.string().max(60)).max(20),
  outcomes: z.string().max(600).nullable().describe('Measured result, if the CV states one.'),
  url: z.string().max(300).nullable(),
});

export const CandidateEducationSchema = z.object({
  institution: z.string().max(200).nullable(),
  degree: z.string().max(160).nullable(),
  field: z.string().max(160).nullable(),
  startDate: z.string().max(40).nullable(),
  endDate: z.string().max(40).nullable(),
  grade: z.string().max(60).nullable(),
});

export const CandidateCertificationSchema = z.object({
  name: z.string().min(1).max(200),
  issuer: z.string().max(160).nullable(),
  issuedAt: z.string().max(40).nullable(),
});

export const CandidateAnalysisSchema = z.object({
  fullName: z.string().max(160).nullable(),
  headline: z.string().max(200).nullable().describe('Professional title from the CV, e.g. "Data Engineer".'),
  location: z.string().max(160).nullable(),
  totalYearsExperience: z.number().min(0).max(60).nullable()
    .describe('Sum of professional experience. Null when the CV gives no dates to reason from.'),
  seniority: SenioritySchema.nullable(),
  summary: z.string().max(1200).describe('Two or three sentences describing the candidate factually.'),
  skills: z.array(CandidateSkillSchema).max(60),
  experiences: z.array(CandidateExperienceSchema).max(20),
  projects: z.array(CandidateProjectSchema).max(20),
  education: z.array(CandidateEducationSchema).max(10),
  certifications: z.array(CandidateCertificationSchema).max(15),
  achievements: z.array(z.string().max(300)).max(12),
  /**
   * Claims worth probing in the interview. This is the bridge from CV analysis
   * to adaptive questioning: "built a recommender with scikit-learn" belongs
   * here so the engine can test whether the candidate actually understands it.
   */
  probeTargets: z.array(
    z.object({
      claim: z.string().max(300).describe('The specific claim made in the CV.'),
      skillLabel: z.string().max(80),
      whyItMatters: z.string().max(300),
    }),
  ).max(12),
  /** Gaps the reader of the CV would notice — unexplained breaks, vague scope. */
  redFlags: z.array(z.string().max(300)).max(8),
});
export type CandidateAnalysis = z.infer<typeof CandidateAnalysisSchema>;

// ── JobAnalysis ────────────────────────────────────────────────────────────

export const JobSkillSchema = z.object({
  label: z.string().min(1).max(80),
  category: SkillCategorySchema,
  requirement: RequirementSchema,
  importance: ImportanceSchema,
  evidence: z.string().max(300).nullable().describe('The phrase in the posting that establishes this.'),
});

export const JobAnalysisSchema = z.object({
  title: z.string().min(1).max(160),
  company: z.string().max(160).nullable(),
  location: z.string().max(160).nullable(),
  employmentType: z.string().max(60).nullable(),
  seniority: SenioritySchema.nullable(),
  experienceYears: z.object({
    min: z.number().min(0).max(40).nullable(),
    max: z.number().min(0).max(40).nullable(),
  }),
  summary: z.string().max(1200),
  responsibilities: z.array(z.string().max(300)).max(15),
  /** The Job Skill Matrix: every skill with its requirement level and weight. */
  skills: z.array(JobSkillSchema).min(1).max(40),
  technicalRequirements: z.array(z.string().max(300)).max(15),
  softSkills: z.array(z.string().max(120)).max(12),
  keywords: z.array(z.string().max(60)).max(25)
    .describe('Terms an ATS would screen on.'),
  /** What this specific interview should concentrate on. */
  interviewFocus: z.array(z.string().max(200)).max(8),
});
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;

// ── InterviewPlan ──────────────────────────────────────────────────────────

export const PlanSkillTargetSchema = z.object({
  skillLabel: z.string().min(1).max(80),
  category: SkillCategorySchema,
  /** How many questions this skill deserves out of the interview's budget. */
  questionBudget: z.number().int().min(0).max(10),
  priority: z.number().int().min(1).max(5).describe('1 is highest priority.'),
  rationale: z.string().max(300),
});

export const InterviewPlanSchema = z.object({
  objective: z.string().max(600).describe('What this interview must establish about the candidate.'),
  openingStrategy: z.string().max(400)
    .describe('How the interviewer opens, given this candidate and role.'),
  skillTargets: z.array(PlanSkillTargetSchema).min(1).max(15),
  /** Specific CV claims the interviewer intends to verify. */
  claimsToVerify: z.array(z.string().max(300)).max(10),
  /** Areas the CV suggests are weak relative to the job, worth probing. */
  riskAreas: z.array(z.string().max(300)).max(8),
  closingStrategy: z.string().max(300),
});
export type InterviewPlan = z.infer<typeof InterviewPlanSchema>;

// ── InterviewQuestion ──────────────────────────────────────────────────────

export const GeneratedQuestionSchema = z.object({
  question: z.string().min(10).max(900)
    .describe('The question as an interviewer would speak it. One question, no preamble about scoring.'),
  category: QuestionCategorySchema,
  skillLabel: z.string().max(80).nullable()
    .describe('The primary skill under test, or null for general/closing questions.'),
  difficulty: DifficultySchema,
  expectedCompetency: z.string().max(400)
    .describe('What a strong answer demonstrates. Never shown to the candidate.'),
  evaluationCriteria: z.array(z.string().max(240)).min(2).max(6)
    .describe('Concrete things to look for when grading. Hidden from the candidate.'),
  followUpOptions: z.array(z.string().max(300)).max(4)
    .describe('Follow-ups worth asking depending on the answer.'),
  selectionRationale: z.string().max(300)
    .describe('Why this question now, given the interview so far.'),
});
export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

// ── AnswerEvaluation ───────────────────────────────────────────────────────

export const AnswerEvaluationSchema = z.object({
  relevance: ScoreSchema.describe('Did the answer address the question that was asked?'),
  correctness: ScoreSchema.describe('Is what was said factually and technically right?'),
  completeness: ScoreSchema.describe('Did it cover what a full answer requires?'),
  clarity: ScoreSchema.describe('Was it structured and easy to follow?'),
  confidence: ScoreSchema.describe('Confidence conveyed by the wording — hedging, certainty, ownership.'),
  technicalDepth: ScoreSchema.describe('Depth beyond surface description: mechanisms, trade-offs, internals.'),
  communication: ScoreSchema,
  reasoning: ScoreSchema.describe('Quality of the reasoning shown, independent of the conclusion.'),
  evidenceQuality: ScoreSchema.describe('Concrete specifics — numbers, decisions, real situations — versus generalities.'),
  answerScore: ScoreSchema.describe('Overall quality of this single answer.'),
  cvConsistency: CvConsistencySchema
    .describe('Does the answer support what the CV claims about this area?'),
  strengths: z.array(z.string().max(300)).max(5)
    .describe('Specific good things in this answer, quoting or referencing what was said.'),
  gaps: z.array(z.string().max(300)).max(5).describe('Specific things missing or wrong.'),
  /** Direct quotes that justify the scores — keeps grading auditable. */
  evidenceQuotes: z.array(z.string().max(300)).max(4),
  /** Whether the answer warrants digging further, and how. */
  followUpRecommendation: z.enum(['clarify', 'example', 'deepen', 'test_concept', 'move_on'])
    .describe('clarify = vague; example = claims without specifics; deepen = strong, push harder; test_concept = suspect shaky fundamentals; move_on = adequately covered.'),
  followUpReason: z.string().max(300),
  /** True when the answer is too short or empty to grade meaningfully. */
  insufficientEvidence: z.boolean(),
});
export type AnswerEvaluation = z.infer<typeof AnswerEvaluationSchema>;

// ── FinalReport ────────────────────────────────────────────────────────────

export const ReportSkillScoreSchema = z.object({
  skillLabel: z.string().min(1).max(80),
  category: SkillCategorySchema,
  score: ScoreSchema,
  level: SkillLevelSchema,
  evidenceCount: z.number().int().min(0).max(50)
    .describe('How many answers informed this score. 0 means the skill was never tested.'),
  evidence: z.string().max(600).describe('What the candidate actually demonstrated.'),
  feedback: z.string().max(600).describe('Actionable guidance for this specific skill.'),
  isGap: z.boolean().describe('True when this skill needs work relative to the target role.'),
});

export const QuestionAnalysisSchema = z.object({
  position: z.number().int().min(1).max(60),
  score: ScoreSchema,
  whatWasGood: z.string().max(600),
  whatWasMissing: z.string().max(600),
  idealAnswerCharacteristics: z.array(z.string().max(300)).min(1).max(6)
    .describe('What a strong answer to this question contains.'),
  howToImprove: z.string().max(600).describe('Concrete next action, not encouragement.'),
});

export const FinalReportSchema = z.object({
  overallScore: ScoreSchema,
  dimensions: z.object({
    technicalKnowledge: ScoreSchema,
    problemSolving: ScoreSchema,
    communication: ScoreSchema,
    practicalExperience: ScoreSchema,
    criticalThinking: ScoreSchema,
    roleFit: ScoreSchema,
  }),
  verdict: VerdictSchema,
  evidenceConfidence: ConfidenceSchema
    .describe('How much the interview actually established. Use "low" when answers were short or few.'),
  summary: z.string().min(40).max(1600)
    .describe('An interviewer\'s written verdict. Specific, evidence-based, no filler praise.'),
  strengths: z.array(
    z.object({
      title: z.string().max(160),
      detail: z.string().max(600).describe('Backed by what the candidate said.'),
    }),
  ).max(6),
  weaknesses: z.array(
    z.object({
      title: z.string().max(160),
      detail: z.string().max(600),
    }),
  ).max(6),
  skillScores: z.array(ReportSkillScoreSchema).max(25),
  skillGaps: z.array(
    z.object({
      skillLabel: z.string().max(80),
      severity: ImportanceSchema,
      detail: z.string().max(600),
    }),
  ).max(12),
  questionAnalysis: z.array(QuestionAnalysisSchema).max(40),
});
export type FinalReport = z.infer<typeof FinalReportSchema>;

// ── Recommendations and learning plan ──────────────────────────────────────

export const RecommendationSchema = z.object({
  kind: RecommendationKindSchema,
  title: z.string().min(3).max(200),
  detail: z.string().max(700).nullable(),
  skillLabel: z.string().max(80).nullable(),
  priority: z.number().int().min(1).max(5).describe('1 is most urgent.'),
  effortHours: z.number().int().min(1).max(200).nullable(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const LearningPlanSchema = z.object({
  title: z.string().min(3).max(200),
  objective: z.string().max(700),
  totalWeeks: z.number().int().min(1).max(12),
  weeks: z.array(
    z.object({
      weekNumber: z.number().int().min(1).max(12),
      focus: z.string().min(3).max(200).describe('The single theme of this week.'),
      skillLabel: z.string().max(80).nullable(),
      activities: z.array(z.string().max(300)).min(1).max(6),
      successCriteria: z.string().max(400).describe('How the learner knows the week worked.'),
    }),
  ).min(1).max(12),
  recommendations: z.array(RecommendationSchema).max(15),
});
export type LearningPlan = z.infer<typeof LearningPlanSchema>;
