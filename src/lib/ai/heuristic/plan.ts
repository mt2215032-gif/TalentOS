import type { InterviewPlan } from '@/lib/schemas/ai';
import type { HeuristicPlanContext } from '@/lib/ai/heuristic/context';
import { resolveSkill } from '@/lib/ai/taxonomy';
import type { Importance, InterviewType } from '@/lib/schemas/domain';

/**
 * Offline interview planning.
 *
 * Allocates the question budget across the job's skills in proportion to their
 * weight in the skill matrix, so a "critical" requirement gets probed more than
 * a "nice to have". This is the same allocation the LLM path is asked to make;
 * doing it arithmetically keeps it reproducible.
 */

const IMPORTANCE_WEIGHT: Record<Importance, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function buildPlanOffline(context: HeuristicPlanContext): InterviewPlan {
  const { job, candidate, plannedQuestions, roleTitle, interviewType } = context;

  // Behavioural and HR interviews are not organised around technical skills, so
  // they target competencies instead.
  const isCompetencyInterview = interviewType === 'behavioral' || interviewType === 'hr';

  const sourceSkills = isCompetencyInterview
    ? BEHAVIORAL_COMPETENCIES.map((label) => ({
        label,
        category: 'soft' as const,
        importance: 'high' as Importance,
      }))
    : (job?.skills ?? []).map((skill) => ({
        label: skill.label,
        category: skill.category,
        importance: skill.importance,
      }));

  // Without a job description there is no skill matrix to plan from. Falling
  // back to the role title alone would make every question skill-less, and an
  // interview that scores no skills leaves the candidate's skill profile empty
  // forever. Use what the CV claims, or a general competency set for the type.
  const fallbackSkills =
    (candidate?.skills ?? []).length > 0
      ? (candidate?.skills ?? []).slice(0, 6).map((skill) => ({
          label: skill.label,
          category: skill.category,
          importance: 'high' as Importance,
        }))
      : GENERAL_COMPETENCIES[interviewType].map((label) => ({
          label,
          category: 'domain' as const,
          importance: 'high' as Importance,
        }));

  const skills = sourceSkills.length > 0 ? sourceSkills : fallbackSkills;

  // Reserve one question for the opener and one for the close.
  const budget = Math.max(1, plannedQuestions - 2);
  const totalWeight = skills.reduce((sum, skill) => sum + IMPORTANCE_WEIGHT[skill.importance], 0);

  const candidateSkillKeys = new Set(
    (candidate?.skills ?? []).map((skill) => resolveSkill(skill.label).key),
  );

  // Allocate the budget with largest-remainder rounding. Rounding each share
  // independently over-allocates — six skills each rounding 0.67 up to 1 would
  // spend six questions from a budget of four.
  const shares = skills.map((skill) => {
    const weight = IMPORTANCE_WEIGHT[skill.importance];
    return totalWeight === 0 ? 0 : (weight / totalWeight) * budget;
  });

  const allocation = shares.map((share) => Math.floor(share));
  let remaining = budget - allocation.reduce((sum, value) => sum + value, 0);

  // Hand the leftovers to whoever lost the most to flooring.
  const byRemainder = shares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder);

  for (const entry of byRemainder) {
    if (remaining <= 0) break;
    allocation[entry.index] = (allocation[entry.index] ?? 0) + 1;
    remaining -= 1;
  }

  const skillTargets = skills
    .map((skill, index) => {
      const weight = IMPORTANCE_WEIGHT[skill.importance];
      const resolved = resolveSkill(skill.label, skill.category);
      const claimed = candidateSkillKeys.has(resolved.key);
      return {
        skillLabel: resolved.label,
        category: resolved.category,
        questionBudget: Math.max(0, Math.min(10, allocation[index] ?? 0)),
        priority: Math.max(1, Math.min(5, 5 - weight + 1)),
        rationale: claimed
          ? `The job weights this as ${skill.importance} and the CV claims it — worth verifying directly.`
          : `The job weights this as ${skill.importance} but the CV does not evidence it — a likely gap.`,
      };
    })
    .sort((a, b) => a.priority - b.priority || b.questionBudget - a.questionBudget)
    .slice(0, 15);

  // Guarantee the highest-priority skill gets at least one question even when
  // rounding pushed every share to zero.
  if (skillTargets.length > 0 && skillTargets.every((target) => target.questionBudget === 0)) {
    const first = skillTargets[0];
    if (first) first.questionBudget = 1;
  }

  const missingSkills = skillTargets.filter(
    (target) => !candidateSkillKeys.has(resolveSkill(target.skillLabel).key),
  );

  return {
    objective:
      `Establish whether this candidate can do the ${roleTitle} job, by testing the skills the posting weights most ` +
      `heavily and verifying the claims their CV makes.`,
    openingStrategy: candidate?.headline
      ? `Open on their stated background as a ${candidate.headline} and move quickly into a real piece of their work.`
      : 'Open with a broad question about their background, then move into specifics.',
    skillTargets,
    claimsToVerify: (candidate?.probeTargets ?? []).slice(0, 10).map((probe) => probe.claim.slice(0, 300)),
    riskAreas: [
      ...missingSkills.slice(0, 5).map(
        (target) => `${target.skillLabel} is required by the role but not evidenced in the CV.`,
      ),
      ...(candidate?.redFlags ?? []).slice(0, 3),
    ].slice(0, 8),
    closingStrategy: 'Give the candidate the floor to add anything the questions did not reach.',
  };
}

/**
 * What each interview type is about when no job description narrows it.
 *
 * These are subjects an interviewer can actually probe and score, which is what
 * a role title is not.
 */
const GENERAL_COMPETENCIES: Record<InterviewType, readonly string[]> = {
  technical: ['Problem Solving', 'System Design', 'Debugging', 'Testing', 'Data Structures'],
  behavioral: ['Communication', 'Teamwork', 'Ownership', 'Conflict Resolution', 'Adaptability'],
  hr: ['Communication', 'Adaptability', 'Ownership'],
  case_study: ['Problem Solving', 'Critical Thinking', 'Stakeholder Management'],
  system_design: ['System Design', 'Performance Optimization', 'Security'],
  mixed: ['Problem Solving', 'Communication', 'System Design', 'Ownership'],
};

/** Competencies a behavioural or HR interview is organised around. */
const BEHAVIORAL_COMPETENCIES = [
  'Communication',
  'Teamwork',
  'Problem Solving',
  'Leadership',
  'Conflict Resolution',
  'Adaptability',
  'Ownership',
];
