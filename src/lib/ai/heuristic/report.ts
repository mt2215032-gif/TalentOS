import type { FinalReport, LearningPlan } from '@/lib/schemas/ai';
import type { Importance, SkillCategory } from '@/lib/schemas/domain';
import { scoreToLevel } from '@/lib/schemas/domain';
import { relatedSkills, resolveSkill } from '@/lib/ai/taxonomy';
import { clampScore, weightedAverage } from '@/lib/ai/heuristic/text';
import type {
  HeuristicEvaluationContext,
  HeuristicLearningPlanContext,
} from '@/lib/ai/heuristic/context';

/**
 * Offline report synthesis.
 *
 * Aggregates the per-answer analysis that was already computed during the
 * interview. Nothing here re-judges an answer: the final score is a weighted
 * roll-up of evidence gathered turn by turn, which is what keeps the report
 * consistent with what the candidate actually saw.
 */

/** Below this many graded answers, the report says so rather than projecting confidence. */
const LOW_EVIDENCE_ANSWERS = 4;

export function buildReportOffline(context: HeuristicEvaluationContext): FinalReport {
  const graded = context.answers.filter((a) => a.dimensions !== null && !a.insufficientEvidence);
  const attempted = context.answers.filter((a) => !a.insufficientEvidence);

  // Later answers carry slightly more weight: difficulty rises through the
  // interview, so the last answers are the more demanding evidence.
  const weightOf = (index: number): number => 1 + index * 0.08;

  const dimension = (key: keyof NonNullable<HeuristicEvaluationContext['answers'][number]['dimensions']>): number =>
    weightedAverage(
      context.answers.map((answer, index) => [answer.dimensions?.[key] ?? null, weightOf(index)] as const),
    );

  const technicalKnowledge = weightedAverage([
    [dimension('correctness'), 2],
    [dimension('technicalDepth'), 2],
  ]);
  const problemSolving = weightedAverage([
    [dimension('reasoning'), 2],
    [dimension('completeness'), 1],
  ]);
  const communication = weightedAverage([
    [dimension('communication'), 2],
    [dimension('clarity'), 2],
  ]);
  const practicalExperience = weightedAverage([
    [dimension('evidenceQuality'), 2],
    [dimension('technicalDepth'), 1],
  ]);
  const criticalThinking = weightedAverage([
    [dimension('reasoning'), 2],
    [dimension('relevance'), 1],
  ]);

  // Unanswered questions are not free: a candidate who skipped half the
  // interview has not demonstrated fit, so coverage scales role fit.
  const coverageRatio = context.answers.length === 0 ? 0 : attempted.length / context.answers.length;
  const roleFit = clampScore(
    weightedAverage([
      [technicalKnowledge, 3],
      [practicalExperience, 2],
      [communication, 1],
    ]) * (0.6 + 0.4 * coverageRatio),
  );

  const overallScore = weightedAverage([
    [technicalKnowledge, 3],
    [problemSolving, 2],
    [practicalExperience, 2],
    [communication, 2],
    [criticalThinking, 2],
    [roleFit, 1],
  ]);

  const skillScores = rollUpSkills(context);
  const evidenceConfidence: FinalReport['evidenceConfidence'] =
    graded.length >= LOW_EVIDENCE_ANSWERS * 2 ? 'high'
    : graded.length >= LOW_EVIDENCE_ANSWERS ? 'medium'
    : 'low';

  const verdict: FinalReport['verdict'] =
    graded.length < 2 ? 'insufficient_evidence'
    : overallScore >= 82 ? 'strong_hire'
    : overallScore >= 68 ? 'hire'
    : overallScore >= 52 ? 'borderline'
    : 'not_yet';

  return {
    overallScore,
    dimensions: {
      technicalKnowledge,
      problemSolving,
      communication,
      practicalExperience,
      criticalThinking,
      roleFit,
    },
    verdict,
    evidenceConfidence,
    summary: buildSummary(context, overallScore, graded.length, evidenceConfidence, verdict),
    strengths: collectStrengths(context),
    weaknesses: collectWeaknesses(context),
    skillScores,
    skillGaps: skillScores
      .filter((skill) => skill.isGap)
      .slice(0, 12)
      .map((skill) => ({
        skillLabel: skill.skillLabel,
        severity: severityFor(skill.score, skill.evidenceCount),
        detail:
          skill.evidenceCount === 0
            ? `${skill.skillLabel} was not covered in this interview, so it remains unverified for this role.`
            : `Answers touching ${skill.skillLabel} scored ${skill.score}/100. ${skill.feedback}`,
      })),
    questionAnalysis: buildQuestionAnalysis(context),
  };
}

/**
 * Per-question analysis.
 *
 * Advice already given earlier in the report is not repeated: when a candidate
 * makes the same mistake on five questions, saying the same sentence five times
 * teaches nothing they did not learn the first time. Each question instead
 * surfaces the most consequential gap whose advice has not been used yet, so the
 * report covers the range of what to work on.
 */
function buildQuestionAnalysis(context: HeuristicEvaluationContext): FinalReport['questionAnalysis'] {
  const alreadyAdvised = new Set<string>();

  return context.answers.slice(0, 40).map((answer) => {
    const score = answer.answerScore ?? 0;
    const advice = improvementFor(score, answer.gaps, alreadyAdvised);
    alreadyAdvised.add(advice);

    return {
      position: answer.position,
      score,
      whatWasGood:
        answer.strengths.length > 0
          ? answer.strengths.join(' ')
          : 'Nothing in this answer stood out as a strength.',
      whatWasMissing:
        answer.gaps.length > 0
          ? answer.gaps.join(' ')
          : 'No significant gaps were identified in this answer.',
      idealAnswerCharacteristics: idealCharacteristics(answer.expectedCompetency, answer.category),
      howToImprove: advice,
    };
  });
}

function severityFor(score: number, evidenceCount: number): Importance {
  if (evidenceCount === 0) return 'medium';
  if (score < 30) return 'critical';
  if (score < 45) return 'high';
  if (score < 60) return 'medium';
  return 'low';
}

/** Per-skill roll-up, including skills the plan targeted but never reached. */
function rollUpSkills(context: HeuristicEvaluationContext): FinalReport['skillScores'] {
  const buckets = new Map<
    string,
    { label: string; category: SkillCategory; scores: number[]; gaps: string[] }
  >();

  for (const answer of context.answers) {
    if (!answer.skillLabel) continue;
    const resolved = resolveSkill(answer.skillLabel);
    const bucket = buckets.get(resolved.key) ?? {
      label: resolved.label,
      category: resolved.category,
      scores: [],
      gaps: [],
    };
    if (answer.answerScore !== null && !answer.insufficientEvidence) {
      bucket.scores.push(answer.answerScore);
    } else if (answer.insufficientEvidence) {
      // A skipped question is evidence of absence, weighted as a zero.
      bucket.scores.push(0);
    }
    bucket.gaps.push(...answer.gaps);
    buckets.set(resolved.key, bucket);
  }

  // Skills the job requires but the interview never reached are reported at
  // zero evidence rather than silently omitted.
  for (const jobSkill of context.job?.skills ?? []) {
    const resolved = resolveSkill(jobSkill.label, jobSkill.category);
    if (!buckets.has(resolved.key) && (jobSkill.importance === 'critical' || jobSkill.importance === 'high')) {
      buckets.set(resolved.key, {
        label: resolved.label,
        category: resolved.category,
        scores: [],
        gaps: [],
      });
    }
  }

  return [...buckets.values()]
    .map((bucket) => {
      const score = bucket.scores.length
        ? clampScore(bucket.scores.reduce((sum, value) => sum + value, 0) / bucket.scores.length)
        : 0;
      const evidenceCount = bucket.scores.length;
      return {
        skillLabel: bucket.label,
        category: bucket.category,
        score,
        level: scoreToLevel(score),
        evidenceCount,
        evidence:
          evidenceCount === 0
            ? 'Not covered in this interview.'
            : `Assessed across ${evidenceCount} answer${evidenceCount === 1 ? '' : 's'}, averaging ${score}/100.`,
        feedback:
          evidenceCount === 0
            ? `Practise ${bucket.label} and run another interview that covers it.`
            : dedupe(bucket.gaps).slice(0, 2).join(' ') ||
              `Keep consolidating ${bucket.label} with harder, more specific practice.`,
        isGap: evidenceCount === 0 || score < 60,
      };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 25);
}

function collectStrengths(context: HeuristicEvaluationContext): FinalReport['strengths'] {
  const best = [...context.answers]
    .filter((a) => (a.answerScore ?? 0) >= 60 && a.strengths.length > 0)
    .sort((a, b) => (b.answerScore ?? 0) - (a.answerScore ?? 0))
    .slice(0, 6);

  return best.map((answer) => ({
    title: answer.skillLabel ? `Solid grasp of ${answer.skillLabel}` : `Strong answer on question ${answer.position}`,
    detail: `On question ${answer.position} (${answer.answerScore}/100): ${answer.strengths.join(' ')}`.slice(0, 600),
  }));
}

function collectWeaknesses(context: HeuristicEvaluationContext): FinalReport['weaknesses'] {
  const worst = [...context.answers]
    .filter((a) => (a.answerScore ?? 0) < 60)
    .sort((a, b) => (a.answerScore ?? 0) - (b.answerScore ?? 0))
    .slice(0, 6);

  return worst.map((answer) => ({
    title: answer.skillLabel
      ? `${answer.skillLabel} needs more depth`
      : `Question ${answer.position} was not convincingly answered`,
    detail: `On question ${answer.position} (${answer.answerScore ?? 0}/100): ${
      answer.gaps.join(' ') || 'The answer did not demonstrate the expected competency.'
    }`.slice(0, 600),
  }));
}

function buildSummary(
  context: HeuristicEvaluationContext,
  overall: number,
  gradedCount: number,
  confidence: FinalReport['evidenceConfidence'],
  verdict: FinalReport['verdict'],
): string {
  const total = context.answers.length;
  const skipped = total - gradedCount;
  const strongest = [...context.answers].sort((a, b) => (b.answerScore ?? 0) - (a.answerScore ?? 0))[0];
  const weakest = [...context.answers].sort((a, b) => (a.answerScore ?? 0) - (b.answerScore ?? 0))[0];

  const parts: string[] = [
    `This was a ${context.difficulty} ${context.interviewType.replace('_', ' ')} interview for ${context.roleTitle}, scored ${overall}/100 across ${total} question${total === 1 ? '' : 's'}.`,
  ];

  if (verdict === 'insufficient_evidence') {
    parts.push(
      'Too few questions were answered in enough detail to support a judgement. Treat this score as provisional and run a fuller interview.',
    );
  }
  if (skipped > 0) {
    parts.push(`${skipped} answer${skipped === 1 ? ' was' : 's were'} too brief to assess, which held the overall score down.`);
  }
  if (strongest && (strongest.answerScore ?? 0) >= 60) {
    parts.push(
      `The strongest moment was question ${strongest.position}${strongest.skillLabel ? ` on ${strongest.skillLabel}` : ''}, at ${strongest.answerScore}/100.`,
    );
  }
  if (weakest && (weakest.answerScore ?? 0) < 50 && weakest !== strongest) {
    parts.push(
      `The weakest was question ${weakest.position}${weakest.skillLabel ? ` on ${weakest.skillLabel}` : ''}, at ${weakest.answerScore ?? 0}/100.`,
    );
  }
  if (confidence === 'low') {
    parts.push('Evidence confidence is low — this report describes what was shown, which was not much.');
  }

  return parts.join(' ').slice(0, 1600);
}

function idealCharacteristics(expectedCompetency: string, category: string): string[] {
  const base = [expectedCompetency].filter(Boolean).map((text) => text.slice(0, 300));
  if (category === 'behavioral') {
    base.push(
      'Sets the situation briefly, then spends most of the answer on what you personally did.',
      'Ends with a concrete outcome, including what you would do differently.',
    );
  } else {
    base.push(
      'Names a specific piece of work rather than describing the technology in general.',
      'Explains the reasoning behind the choice and what the alternative would have cost.',
      'Includes scale or a measured result where one exists.',
    );
  }
  return base.slice(0, 6);
}

/**
 * Turn a measured gap into a specific next action.
 *
 * The gap strings come from the answer analyzer, so this maps the actual set
 * rather than pattern-matching loosely. Echoing the gap back ("address the gap:
 * you did not engage with the question") is not advice — every entry here names
 * something the candidate can practise.
 */
const IMPROVEMENT_BY_GAP: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /did not engage directly/i,
    'Re-read the question before answering and name its subject in your first sentence, so the answer is visibly on target.',
  ],
  [
    /surface level|little technical substance/i,
    'Go one layer below the tool: name the mechanism, the data structure or the failure mode involved, not just what the tool is for.',
  ],
  [
    /no concrete example|stayed general/i,
    'Prepare two or three real stories with numbers attached, and reach for one whenever a question invites an example.',
  ],
  [
    /without explaining why/i,
    'After stating what you did, add one sentence beginning "I chose this because…" and name the alternative you rejected.',
  ],
  [
    /hedged repeatedly/i,
    'Replace hedges with a position and its boundary: "X, though I have not tested it beyond Y."',
  ],
  [
    /missing part of its structure/i,
    'Finish the story: every behavioural answer needs an outcome, even when the outcome was not the one you wanted.',
  ],
  [
    /brief for the depth/i,
    'Aim for 90 to 150 words on a question like this: context, what you did, the result.',
  ],
  [
    /as "we" throughout|contribution unclear/i,
    'Say "I" for your own decisions. Reserve "we" for work you genuinely shared, so your contribution is legible.',
  ],
];

function improvementFor(score: number, gaps: string[], alreadyAdvised: ReadonlySet<string>): string {
  if (score === 0) {
    return 'Answer this question in full next time — even a partial, honest answer scores better than a skip.';
  }
  if (gaps.length === 0) {
    return 'Tighten the delivery: lead with the answer, then justify it in one sentence.';
  }

  const adviceForGaps = gaps
    .map((gap) => IMPROVEMENT_BY_GAP.find(([pattern]) => pattern.test(gap))?.[1])
    .filter((advice): advice is string => advice !== undefined);

  // Prefer advice this report has not given yet, so a recurring mistake does not
  // crowd out everything else the candidate should work on.
  const fresh = adviceForGaps.find((advice) => !alreadyAdvised.has(advice));
  if (fresh) return fresh;

  // Every applicable gap has been covered. Say something true about this answer
  // rather than repeating a line the reader has already seen four times.
  if (adviceForGaps.length > 0) {
    return score < 50
      ? 'The same gaps as earlier answers — work through them once and this question improves with them.'
      : 'A solid answer with the same rough edge noted above; smoothing it lifts the whole interview.';
  }

  return 'Answer the question that was asked, then add one specific detail that shows you have done this work.';
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

// ── Learning plan ──────────────────────────────────────────────────────────

export function buildLearningPlanOffline(context: HeuristicLearningPlanContext): LearningPlan {
  // Biggest gaps first — the plan spends its early weeks where the score is
  // weakest, which is where practice moves the needle most.
  const ranked = [...context.gaps].sort((a, b) => a.score - b.score);
  const focusSkills = ranked.slice(0, 4);
  const totalWeeks = Math.max(1, Math.min(4, focusSkills.length || 1));

  const weeks: LearningPlan['weeks'] = focusSkills.slice(0, totalWeeks).map((gap, index) => {
    const related = relatedSkills(gap.skillLabel);
    return {
      weekNumber: index + 1,
      focus:
        gap.score === 0
          ? `Establish the fundamentals of ${gap.skillLabel}`
          : `Strengthen ${gap.skillLabel} from ${gap.score}/100`,
      skillLabel: gap.skillLabel,
      activities: [
        `Work through the core concepts of ${gap.skillLabel} and write a one-page summary in your own words.`,
        `Build something small that uses ${gap.skillLabel} end to end, and record the decisions you made.`,
        related.length > 0
          ? `Review how ${gap.skillLabel} interacts with ${related.slice(0, 2).join(' and ')}.`
          : `Prepare two interview stories about ${gap.skillLabel} with concrete numbers.`,
        `Run a practice interview focused on ${gap.skillLabel} and compare the score.`,
      ].slice(0, 6),
      successCriteria: `You can explain ${gap.skillLabel} without notes, justify one design decision, and cite a measurable outcome.`,
    };
  });

  if (weeks.length === 0) {
    weeks.push({
      weekNumber: 1,
      focus: 'Consolidate and raise difficulty',
      skillLabel: null,
      activities: [
        'Run a harder interview at the next difficulty level.',
        'Prepare three stories with measured outcomes for your strongest skills.',
        'Practise answering in 90 to 150 words: answer first, then justify.',
      ],
      successCriteria: 'You score at or above your current level at a higher difficulty.',
    });
  }

  return {
    title: `Four-week plan for ${context.roleTitle}`.slice(0, 200),
    objective:
      focusSkills.length > 0
        ? `Close the gaps that cost the most in this interview: ${focusSkills.map((g) => g.skillLabel).join(', ')}.`
        : 'Consolidate current strengths and move up a difficulty level.',
    totalWeeks: weeks.length,
    weeks,
    recommendations: [
      ...focusSkills.slice(0, 3).map((gap, index) => ({
        kind: 'topic' as const,
        title: `Study ${gap.skillLabel}`,
        detail: `Scored ${gap.score}/100 in this interview. Focus on the mechanism, not just usage.`,
        skillLabel: gap.skillLabel,
        priority: (index + 1) as 1 | 2 | 3,
        effortHours: 6,
      })),
      ...(focusSkills[0]
        ? [
            {
              kind: 'project' as const,
              title: `Build a small project using ${focusSkills[0].skillLabel}`,
              detail: 'A finished project gives you the specifics and numbers that weak answers were missing.',
              skillLabel: focusSkills[0].skillLabel,
              priority: 2 as const,
              effortHours: 20,
            },
          ]
        : []),
      {
        kind: 'habit' as const,
        title: 'Answer first, justify second',
        detail: 'Open with a direct answer, then one sentence of reasoning and one concrete detail.',
        skillLabel: null,
        priority: 3 as const,
        effortHours: null,
      },
    ].slice(0, 15),
  };
}
