import type { GeneratedQuestion } from '@/lib/schemas/ai';
import type { Difficulty, QuestionCategory } from '@/lib/schemas/domain';
import type { HeuristicQuestionContext } from '@/lib/ai/heuristic/context';

/**
 * Offline question generation.
 *
 * Questions come from templated frames rather than a model. The adaptive logic
 * is identical to the LLM path — the engine has already decided which skill to
 * probe, at what difficulty, and whether this is a follow-up — so what differs
 * is only the wording, not the interview's behaviour.
 */

const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

interface Frame {
  category: QuestionCategory;
  difficulties: readonly Difficulty[];
  /** `{skill}` is substituted with the skill under test. */
  template: string;
  competency: string;
  criteria: readonly string[];
}

const TECHNICAL_FRAMES: readonly Frame[] = [
  {
    category: 'conceptual',
    difficulties: ['easy', 'medium'],
    template: 'Explain how {skill} works to someone who has never used it. What problem does it actually solve?',
    competency: 'Can articulate the purpose and mechanism of the technology in plain language.',
    criteria: ['Explains the underlying mechanism, not just the syntax', 'Names the problem it solves', 'Avoids circular definitions'],
  },
  {
    category: 'practical',
    difficulties: ['medium', 'hard'],
    template: 'Walk me through the last time you used {skill} on real work. What did you build, and what decisions did you have to make?',
    competency: 'Has genuine hands-on experience and made deliberate design decisions.',
    criteria: ['Describes a specific piece of work', 'Names concrete decisions and alternatives', 'Gives scale or measurable outcomes'],
  },
  {
    category: 'technical_deep_dive',
    difficulties: ['hard', 'expert'],
    template: 'What are the main trade-offs when using {skill}? Give me a case where it was the wrong choice.',
    competency: 'Understands limitations, not just capabilities.',
    criteria: ['Names real trade-offs', 'Describes a situation where it is a poor fit', 'Compares against a credible alternative'],
  },
  {
    category: 'problem_solving',
    difficulties: ['medium', 'hard', 'expert'],
    template: 'Something built on {skill} is running far slower in production than in testing. How do you find out why?',
    competency: 'Has a systematic diagnostic method rather than guesswork.',
    criteria: ['Starts from measurement rather than assumptions', 'Names specific tools or signals', 'Narrows the problem in a logical order'],
  },
  {
    category: 'scenario',
    difficulties: ['medium', 'hard', 'expert'],
    template: 'Your team must scale the {skill} side of a system to ten times its current load. What breaks first, and what do you change?',
    competency: 'Can reason about scaling limits and bottlenecks.',
    criteria: ['Identifies a plausible first bottleneck', 'Proposes a proportionate change', 'Acknowledges the cost of the change'],
  },
  {
    category: 'knowledge',
    difficulties: ['easy', 'medium'],
    template: 'What is the difference between the common approaches to {skill}, and when would you pick each one?',
    competency: 'Knows the option space and the selection criteria.',
    criteria: ['Names at least two distinct approaches', 'Gives a selection rule', 'Is accurate about the differences'],
  },
];

const BEHAVIORAL_FRAMES: readonly Frame[] = [
  {
    category: 'behavioral',
    difficulties: ['easy', 'medium', 'hard', 'expert'],
    template: 'Tell me about a time you disagreed with a colleague about a technical decision. How did it end?',
    competency: 'Handles disagreement professionally and reaches a resolution.',
    criteria: ['Describes a specific situation', 'Explains their own position and the other side fairly', 'States the outcome honestly'],
  },
  {
    category: 'behavioral',
    difficulties: ['medium', 'hard', 'expert'],
    template: 'Describe a project that did not go well. What was your part in that, and what did you change afterwards?',
    competency: 'Takes ownership and learns from failure.',
    criteria: ['Accepts a share of responsibility', 'Identifies a concrete cause', 'Names a specific change in behaviour'],
  },
  {
    category: 'behavioral',
    difficulties: ['easy', 'medium'],
    template: 'Tell me about a time you had to explain something technical to someone without a technical background.',
    competency: 'Adapts communication to the audience.',
    criteria: ['Describes the audience and their need', 'Explains how the message was adapted', 'States whether it worked'],
  },
  {
    category: 'behavioral',
    difficulties: ['medium', 'hard'],
    template: 'Give me an example of a deadline you were not going to meet. What did you do?',
    competency: 'Communicates risk early and manages expectations.',
    criteria: ['Raised the problem before the deadline passed', 'Describes concrete mitigation', 'Shows awareness of the impact on others'],
  },
  {
    category: 'behavioral',
    difficulties: ['hard', 'expert'],
    template: 'Tell me about a time you changed your mind on something you had argued for. What convinced you?',
    competency: 'Updates on evidence rather than defending a position.',
    criteria: ['Names the original position', 'Identifies the specific evidence that shifted it', 'Shows no defensiveness'],
  },
];

const HR_FRAMES: readonly Frame[] = [
  {
    category: 'experience',
    difficulties: ['easy', 'medium'],
    template: 'Walk me through your background and what led you to apply for this kind of role.',
    competency: 'Can narrate their career coherently and connect it to the role.',
    criteria: ['Gives a coherent through-line', 'Connects past work to this role', 'Stays concise'],
  },
  {
    category: 'experience',
    difficulties: ['easy', 'medium', 'hard'],
    template: 'What are you looking for in your next role that you do not have today?',
    competency: 'Has thought about motivation and fit.',
    criteria: ['Names something specific', 'Is honest rather than generic', 'Relates to what this role offers'],
  },
  {
    category: 'closing',
    difficulties: ['easy', 'medium', 'hard', 'expert'],
    template: 'Is there anything about your experience we have not covered that you think is relevant to this role?',
    competency: 'Can self-advocate and identify what matters.',
    criteria: ['Adds genuinely new information', 'Keeps it relevant to the role', 'Is specific rather than promotional'],
  },
];

const SYSTEM_DESIGN_FRAMES: readonly Frame[] = [
  {
    category: 'scenario',
    difficulties: ['medium', 'hard', 'expert'],
    template: 'Design a system that handles {skill} for a product with a million daily users. Start with the constraints you would want to establish.',
    competency: 'Establishes requirements before designing, and reasons about scale.',
    criteria: ['Asks about or states constraints first', 'Proposes a coherent component breakdown', 'Addresses a scaling bottleneck explicitly'],
  },
  {
    category: 'technical_deep_dive',
    difficulties: ['hard', 'expert'],
    template: 'In a system built around {skill}, where would you expect data consistency to become a problem, and how would you handle it?',
    competency: 'Understands consistency trade-offs in distributed systems.',
    criteria: ['Identifies a realistic consistency boundary', 'Names a concrete strategy', 'Acknowledges what the strategy costs'],
  },
];

const CASE_STUDY_FRAMES: readonly Frame[] = [
  {
    category: 'problem_solving',
    difficulties: ['medium', 'hard', 'expert'],
    template: 'A product metric tied to {skill} has dropped 20% in a week with no release. How do you investigate?',
    competency: 'Structures ambiguous problems and forms testable hypotheses.',
    criteria: ['Structures the problem before diving in', 'Forms hypotheses that can be checked', 'Says what data would settle it'],
  },
  {
    category: 'scenario',
    difficulties: ['medium', 'hard'],
    template: 'You have two weeks and limited data to decide whether investing in {skill} is worth it. How do you reach a recommendation?',
    competency: 'Makes decisions under uncertainty with an explicit method.',
    criteria: ['Defines what would make it worth it', 'Proposes a proportionate analysis', 'Commits to a recommendation'],
  },
];

/**
 * Frames that need no skill.
 *
 * Used once the interview has spent every skill-specific frame. A role title is
 * not a technology, so substituting it into "Explain how {skill} works" produces
 * nonsense — these ask about the role directly instead.
 */
const GENERAL_FRAMES: readonly Frame[] = [
  {
    category: 'experience',
    difficulties: ['easy', 'medium', 'hard', 'expert'],
    template: 'What is the hardest problem you have solved in this kind of role, and what made it hard?',
    competency: 'Can identify genuine difficulty and articulate why it was difficult.',
    criteria: ['Names a specific problem', 'Explains the source of the difficulty', 'Describes how it was resolved'],
  },
  {
    category: 'problem_solving',
    difficulties: ['medium', 'hard', 'expert'],
    template: 'Tell me about a technical decision you made that you would make differently now. What changed your mind?',
    competency: 'Reflects on past decisions and updates on evidence.',
    criteria: ['Names the original decision and its reasoning', 'Identifies what new information changed it', 'Shows no defensiveness'],
  },
  {
    category: 'scenario',
    difficulties: ['medium', 'hard', 'expert'],
    template: 'You join a team and inherit a system nobody fully understands. What are your first two weeks?',
    competency: 'Has a method for building understanding of unfamiliar systems.',
    criteria: ['Prioritises understanding before changing', 'Names concrete first steps', 'Involves the people who hold context'],
  },
  {
    category: 'experience',
    difficulties: ['easy', 'medium'],
    template: 'What part of this role do you expect to find most difficult, and what would you do about it?',
    competency: 'Assesses their own gaps honestly and plans around them.',
    criteria: ['Names a real gap rather than a humblebrag', 'Proposes a concrete mitigation', 'Is specific to this role'],
  },
];

/** Follow-up frames, chosen by the decision the engine already made. */
const FOLLOW_UP_FRAMES: Record<'clarify' | 'example' | 'deepen' | 'test_concept', Frame> = {
  clarify: {
    category: 'conceptual',
    difficulties: ['easy', 'medium', 'hard', 'expert'],
    template: 'I want to make sure I understood. Can you be more precise about the part involving {skill} — what exactly did you do there?',
    competency: 'Can restate their own work precisely when pressed.',
    criteria: ['Adds precision rather than repeating', 'Distinguishes their contribution from the team', 'Resolves the ambiguity'],
  },
  example: {
    category: 'experience',
    difficulties: ['easy', 'medium', 'hard', 'expert'],
    template: 'Give me a concrete example of that. What was the situation, and what specifically did you do?',
    competency: 'Backs general claims with a real, specific instance.',
    criteria: ['Provides a real situation rather than a hypothetical', 'Includes specifics such as scale, tools or timeline', 'Their own actions are clear'],
  },
  deepen: {
    category: 'technical_deep_dive',
    difficulties: ['hard', 'expert'],
    template: 'That is a good answer, so let me push further. What would you do differently if the constraints on {skill} were ten times tighter?',
    competency: 'Reasons past the familiar case into harder territory.',
    criteria: ['Engages with the harder constraint honestly', 'Proposes a substantively different approach', 'Recognises what becomes infeasible'],
  },
  test_concept: {
    category: 'conceptual',
    difficulties: ['easy', 'medium', 'hard'],
    template: 'Let me test the foundation underneath that. What is actually happening in {skill} at the level below what you described?',
    competency: 'Understands the mechanism beneath the tooling they use.',
    criteria: ['Describes the underlying mechanism correctly', 'Does not substitute jargon for explanation', 'Admits the boundary of their knowledge if reached'],
  },
};

function framesFor(context: HeuristicQuestionContext): readonly Frame[] {
  switch (context.interviewType) {
    case 'behavioral':
      return BEHAVIORAL_FRAMES;
    case 'hr':
      return HR_FRAMES;
    case 'system_design':
      return SYSTEM_DESIGN_FRAMES;
    case 'case_study':
      return CASE_STUDY_FRAMES;
    case 'technical':
      return TECHNICAL_FRAMES;
    case 'mixed':
      return [...TECHNICAL_FRAMES, ...BEHAVIORAL_FRAMES, ...CASE_STUDY_FRAMES];
    default:
      return TECHNICAL_FRAMES;
  }
}

/** Deterministic pick so the same interview state always yields the same question. */
function pick<T>(items: readonly T[], seed: number): T | undefined {
  if (items.length === 0) return undefined;
  return items[seed % items.length];
}

export function generateQuestionOffline(context: HeuristicQuestionContext): GeneratedQuestion {
  const askedQuestions = new Set(context.asked.map((a) => a.question));

  // ── Follow-up path ───────────────────────────────────────────────────────
  if (context.followUp) {
    const frame = FOLLOW_UP_FRAMES[context.followUp.kind];
    const skill = context.followUp.parentSkillLabel ?? 'that work';
    return {
      question: frame.template.replace('{skill}', skill),
      category: frame.category,
      skillLabel: context.followUp.parentSkillLabel,
      difficulty: context.difficulty,
      expectedCompetency: frame.competency,
      evaluationCriteria: [...frame.criteria],
      followUpOptions: [],
      selectionRationale: `Following up on the previous answer to ${context.followUp.kind.replace('_', ' ')}.`,
    };
  }

  // ── CV-claim probe ───────────────────────────────────────────────────────
  // Testing a specific claim beats a generic question, so it is preferred when
  // the candidate's CV offers one that has not been used yet.
  const probe = context.candidate?.probeTargets.find(
    (target) => !context.asked.some((a) => a.question.includes(target.claim.slice(0, 40))),
  );
  if (probe && context.position > 1 && context.position % 3 === 0) {
    const question =
      `Your CV mentions: "${truncate(probe.claim, 160)}" ` +
      `Take me through the decisions behind that. Why did you approach it that way?`;
    if (!askedQuestions.has(question)) {
      return {
        question,
        category: 'experience',
        skillLabel: probe.skillLabel,
        difficulty: context.difficulty,
        expectedCompetency: 'Can justify the decisions behind work claimed on their CV.',
        evaluationCriteria: [
          'Demonstrates first-hand knowledge of the work',
          'Explains why this approach over alternatives',
          'Details are consistent with the CV claim',
        ],
        followUpOptions: ['Ask what they would change now', 'Ask how it was evaluated'],
        selectionRationale: 'Verifying a specific claim made on the CV.',
      };
    }
  }

  // ── Skill-targeted question ──────────────────────────────────────────────
  const targetSkill = context.targetSkills.find((s) => s.remaining > 0)?.label ?? null;
  const allFrames = framesFor(context);
  const atDifficulty = allFrames.filter((frame) => frame.difficulties.includes(context.difficulty));

  // Filtering by difficulty alone can leave one or two frames — at "easy" only
  // the definitional ones survive — and the interview then alternates between
  // two sentence shapes. Widen to the neighbouring difficulty rather than let
  // it become repetitive.
  const pool =
    atDifficulty.length >= 3
      ? atDifficulty
      : allFrames.filter((frame) =>
          frame.difficulties.some((level) => Math.abs(
            DIFFICULTY_ORDER.indexOf(level) - DIFFICULTY_ORDER.indexOf(context.difficulty),
          ) <= 1),
        );

  // The opening question sets the tone. Asking a candidate to define a
  // technology they claim years of is the wrong first move — open on their
  // actual work and let the interview earn its way to fundamentals.
  // The opening question sets the tone. Asking a candidate to define a
  // technology they claim years of is the wrong first move — open on their
  // actual work and let the interview earn its way to fundamentals.
  const opener =
    context.position === 1
      ? (pool.find((frame) => frame.category === 'practical' || frame.category === 'experience') ??
         pool.find((frame) => frame.category === 'behavioral'))
      : undefined;

  const fallbackSkill = context.job?.skills[0]?.label ?? context.roleTitle;
  // Search every skill that still has budget, not only the first. Exhausting
  // one skill's frames must move the interview to another subject rather than
  // repeat a question, which is the most obvious way an interviewer breaks.
  const skillCandidates = [
    ...(targetSkill ? [targetSkill] : []),
    ...context.targetSkills.filter((entry) => entry.label !== targetSkill).map((entry) => entry.label),
    fallbackSkill,
  ].filter((label, index, all) => label !== context.roleTitle && all.indexOf(label) === index);

  if (skillCandidates.length === 0) skillCandidates.push(context.roleTitle);

  const render = (frame: Frame | undefined, skill: string): string =>
    (frame?.template ?? 'Tell me about your experience with {skill}.').replace('{skill}', skill);

  let frame: Frame | undefined = opener ?? pick(pool, context.position - 1);
  let skillLabel = skillCandidates[0] ?? fallbackSkill;
  let question = render(frame, skillLabel);

  if (askedQuestions.has(question)) {
    let resolved = false;
    // Walk (skill × frame) pairs in priority order until something is new.
    for (const candidateSkill of skillCandidates) {
      for (let offset = 0; offset < pool.length && !resolved; offset += 1) {
        const alternative = pick(pool, context.position - 1 + offset);
        const candidateQuestion = render(alternative, candidateSkill);
        if (!askedQuestions.has(candidateQuestion)) {
          frame = alternative;
          skillLabel = candidateSkill;
          question = candidateQuestion;
          resolved = true;
        }
      }
      if (resolved) break;
    }

    // Every skill-specific frame is spent. Fall back to role-level questions,
    // which need no skill and so never produce "explain how <job title> works".
    if (!resolved) {
      const general = GENERAL_FRAMES.find((entry) => !askedQuestions.has(entry.template));
      if (general) {
        frame = general;
        skillLabel = context.roleTitle;
        question = general.template;
        resolved = true;
      }
    }

    // Even the general frames are spent — only reachable in a long interview
    // against a single skill. Questions built from what the interview has
    // already covered are always novel, which keeps the no-repeats invariant
    // true rather than nearly true.
    if (!resolved) {
      const covered = [...new Set(context.asked.map((a) => a.skillLabel).filter(Boolean))] as string[];
      const lastResort: string[] = [
        ...(covered.length >= 2
          ? [`Compare ${covered[0]} and ${covered[1]} for this kind of work. When would you reach for one over the other?`]
          : []),
        ...covered.map(
          (skill) => `Where does ${skill} stop being the right tool, and what do you reach for instead?`,
        ),
        ...covered.map(
          (skill) => `How would you teach ${skill} to someone joining your team next week?`,
        ),
        'What is the most important thing about this role that we have not covered yet?',
        'If you were interviewing someone for this role, what would you ask that I have not?',
      ];

      question =
        lastResort.find((candidate) => !askedQuestions.has(candidate)) ??
        // Positional suffix guarantees uniqueness once every phrasing is spent.
        `Staying on this subject, what is the ${ordinal(context.position)} thing a strong candidate should be able to explain about it?`;
      skillLabel = context.roleTitle;
    }
  }

  const isLast = context.position >= context.plannedQuestions;
  if (isLast) {
    const closing = HR_FRAMES[HR_FRAMES.length - 1] as Frame;
    return {
      question: closing.template,
      category: 'closing',
      skillLabel: null,
      difficulty: context.difficulty,
      expectedCompetency: closing.competency,
      evaluationCriteria: [...closing.criteria],
      followUpOptions: [],
      selectionRationale: 'Final question — giving the candidate the floor before closing.',
    };
  }

  return {
    question,
    category: frame?.category ?? 'experience',
    // Report the skill the question actually names. Returning null here while
    // the text asks about Python would misattribute the answer's score.
    skillLabel: skillLabel === context.roleTitle ? null : skillLabel,
    difficulty: context.difficulty,
    expectedCompetency: frame?.competency ?? 'Demonstrates relevant working knowledge.',
    evaluationCriteria: frame ? [...frame.criteria] : ['Answers the question asked', 'Gives specific detail'],
    followUpOptions: ['Ask for a concrete example', 'Test the underlying concept'],
    selectionRationale: targetSkill
      ? `${targetSkill} is a priority skill for this role and has remaining question budget.`
      : 'Covering general role suitability.',
  };
}

function ordinal(value: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const remainder = value % 100;
  return `${value}${suffixes[(remainder - 20) % 10] ?? suffixes[remainder] ?? suffixes[0]}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
