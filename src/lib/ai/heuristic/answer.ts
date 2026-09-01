import type { AnswerEvaluation } from '@/lib/schemas/ai';
import type { HeuristicAnswerContext } from '@/lib/ai/heuristic/context';
import {
  analyzeText,
  clampScore,
  technicalDensity,
  topicOverlap,
  weightedAverage,
} from '@/lib/ai/heuristic/text';
import { detectSkills } from '@/lib/ai/taxonomy';

/**
 * Offline answer scoring.
 *
 * Every number below is derived from a measurable property of the answer:
 * length, structure, concrete detail, hedging, reasoning connectives, and
 * overlap with the hidden criteria written when the question was generated.
 *
 * It cannot judge whether a claim is factually true — only an LLM path can —
 * so `correctness` is deliberately anchored to topical coverage and the report
 * marks the interview's evidence confidence accordingly.
 */

/** Answers shorter than this cannot support a meaningful judgement. */
const MIN_GRADEABLE_WORDS = 12;

/** Word count at which length stops adding to a score. */
const LENGTH_SATURATION = 120;

export function analyzeAnswerOffline(context: HeuristicAnswerContext): AnswerEvaluation {
  const signals = analyzeText(context.answerText);

  // Coverage measures engagement with the topic that was asked about — the
  // question and the skill — not agreement with the grading rubric's wording.
  const overlap = topicOverlap(context.answerText, [
    context.question,
    context.skillLabel ?? '',
  ]);

  // Depth of domain vocabulary, seeded with the skill under test and anything
  // else in the taxonomy the answer touches.
  const density = technicalDensity(context.answerText, [
    context.skillLabel ?? '',
    ...detectSkills(context.answerText).map((skill) => skill.label),
  ]);

  // A non-answer scores near zero on everything and is flagged, rather than
  // being given a polite mid-range score it did not earn.
  if (signals.isNonAnswer || signals.wordCount < MIN_GRADEABLE_WORDS) {
    return nonAnswerEvaluation(context, signals.wordCount);
  }

  // ── Component signals, each 0–100 ────────────────────────────────────────

  // How directly the answer engages the topic it was asked about.
  const coverage = clampScore(overlap * 100);

  // Substantive technical content, 0–100.
  const depthSignal = clampScore(density * 100);

  // Length contributes up to a point, then stops — rambling is not depth.
  const substance = clampScore((Math.min(signals.wordCount, LENGTH_SATURATION) / LENGTH_SATURATION) * 100);

  // Concrete detail: numbers, scale, measured outcomes.
  const specificity = clampScore(
    Math.min(signals.numericMentions, 5) * 18 + (signals.wordCount >= 30 && signals.lexicalDiversity > 0.55 ? 10 : 0),
  );

  // Explicit reasoning connectives ("because", "the trade-off", "instead of").
  const reasoningSignal = clampScore(Math.min(signals.reasoningMarkerCount, 5) * 18);

  // Hedging pulls confidence down; ownership language pushes it up.
  const hedgePenalty = Math.min(signals.hedgeCount, 4) * 12;
  const confidenceSignal = clampScore(
    45 + signals.confidenceMarkerCount * 10 + signals.ownershipRatio * 20 - hedgePenalty,
  );

  // Lexical diversity only means something once there are enough words for
  // repetition to be possible; below that every word is trivially distinct, so
  // a hedged one-liner would otherwise score as well-structured prose.
  const diversitySignal = signals.wordCount >= 30 ? signals.lexicalDiversity : 0.5;

  // Readable structure: sentences of a workable length, varied vocabulary.
  const structure = clampScore(
    (signals.sentenceCount >= 2 ? 45 : 25) +
      (signals.averageSentenceWords >= 8 && signals.averageSentenceWords <= 32 ? 25 : 5) +
      diversitySignal * 30,
  );

  const isBehavioral = context.category === 'behavioral';
  // For behavioural questions, STAR completeness is the primary structural signal.
  const starSignal = clampScore((signals.starComponents / 4) * 100);

  // ── Rubric dimensions ────────────────────────────────────────────────────

  const relevance = weightedAverage([
    [coverage, 2],
    [depthSignal, 2],
    [substance, 1],
  ]);

  // Without an LLM this cannot be a fact check. It is a proxy built from
  // domain vocabulary and explicit reasoning, and the report's evidence
  // confidence says so.
  const correctness = weightedAverage([
    [depthSignal, 2],
    [reasoningSignal, 2],
    [coverage, 1],
  ]);

  const completeness = weightedAverage([
    [substance, 2],
    [depthSignal, 1],
    [isBehavioral ? starSignal : specificity, 2],
  ]);

  const clarity = weightedAverage([
    [structure, 3],
    // Each hedge is a concrete readability cost, not a cliff at three.
    [clampScore(85 - signals.hedgeCount * 20), 2],
  ]);

  const technicalDepth = isBehavioral
    ? weightedAverage([[specificity, 1], [reasoningSignal, 1]])
    : weightedAverage([
        [depthSignal, 3],
        [reasoningSignal, 2],
        [specificity, 1],
      ]);

  const communication = weightedAverage([
    [structure, 2],
    [isBehavioral ? starSignal : substance, 1],
  ]);

  const evidenceQuality = weightedAverage([
    [specificity, 2],
    [isBehavioral ? starSignal : depthSignal, 1],
  ]);

  const answerScore = weightedAverage([
    [relevance, 3],
    [correctness, 3],
    [completeness, 2],
    [technicalDepth, 2],
    [evidenceQuality, 2],
    [clarity, 1],
    [confidenceSignal, 1],
  ]);

  // ── Narrative feedback, tied to the signals that produced the scores ──────

  const strengths: string[] = [];
  if (depthSignal >= 55) strengths.push('Used precise domain vocabulary rather than describing the work generically.');
  if (specificity >= 55) strengths.push('Backed the answer with concrete numbers or scale rather than generalities.');
  if (reasoningSignal >= 50) strengths.push('Explained the reasoning behind the approach, not just what was done.');
  if (coverage >= 60) strengths.push('Covered most of what this question was looking for.');
  if (isBehavioral && signals.starComponents >= 3) strengths.push('Structured the story clearly, including the outcome.');
  if (signals.ownershipRatio >= 0.6 && signals.confidenceMarkerCount >= 2) {
    strengths.push('Made their own contribution clear rather than describing the team generically.');
  }

  const gaps: string[] = [];
  if (coverage < 40) gaps.push('Did not engage directly with what the question asked about.');
  if (depthSignal < 30) gaps.push('Stayed at a surface level — little technical substance behind the description.');
  if (specificity < 30) gaps.push('Stayed general — no concrete example, number or measurable outcome.');
  if (reasoningSignal < 30) gaps.push('Described what was done without explaining why that approach was chosen.');
  if (signals.hedgeCount >= 2) gaps.push('Hedged repeatedly, which reads as low confidence in the material.');
  if (isBehavioral && signals.starComponents < 3) gaps.push('The story is missing part of its structure — most often the result.');
  if (signals.wordCount < 40) gaps.push('The answer was brief for the depth this question invites.');
  if (signals.ownershipRatio < 0.3 && signals.wordCount > 30) {
    gaps.push('Described the work as "we" throughout, leaving their own contribution unclear.');
  }

  // ── Follow-up decision ───────────────────────────────────────────────────

  let followUpRecommendation: AnswerEvaluation['followUpRecommendation'];
  let followUpReason: string;

  if (answerScore >= 72 && technicalDepth >= 60) {
    followUpRecommendation = 'deepen';
    followUpReason = 'Strong, well-reasoned answer — worth raising the difficulty.';
  } else if (answerScore < 45) {
    // A weak answer is never left alone. Which probe depends on how it failed:
    // no substance means the fundamentals are in doubt, vagueness means the
    // candidate may know more than they said.
    if (depthSignal < 35) {
      followUpRecommendation = 'test_concept';
      followUpReason = 'Little technical substance — the underlying understanding needs testing directly.';
    } else if (specificity < 30) {
      followUpRecommendation = 'example';
      followUpReason = 'Plausible but unsupported; a concrete instance would settle it.';
    } else {
      followUpRecommendation = 'clarify';
      followUpReason = 'The answer was too imprecise to judge — the position needs pinning down.';
    }
  } else if (specificity < 30 && coverage >= 40) {
    followUpRecommendation = 'example';
    followUpReason = 'The claims are plausible but unsupported by a concrete instance.';
  } else if (clarity < 45 || signals.hedgeCount >= 3) {
    followUpRecommendation = 'clarify';
    followUpReason = 'The answer was vague or hedged; the underlying position is unclear.';
  } else if (depthSignal < 35) {
    followUpRecommendation = 'test_concept';
    followUpReason = 'Little technical substance behind the description — the fundamentals need testing.';
  } else {
    followUpRecommendation = 'move_on';
    followUpReason = 'The question has been adequately covered.';
  }

  return {
    relevance,
    correctness,
    completeness,
    clarity,
    confidence: confidenceSignal,
    technicalDepth,
    communication,
    reasoning: reasoningSignal,
    evidenceQuality,
    answerScore,
    cvConsistency: resolveCvConsistency(context, answerScore),
    strengths: strengths.slice(0, 5),
    gaps: gaps.slice(0, 5),
    evidenceQuotes: extractQuotes(context.answerText),
    followUpRecommendation,
    followUpReason,
    insufficientEvidence: false,
  };
}

/**
 * Does the demonstrated ability line up with what the CV claims?
 *
 * Only meaningful when the CV actually claims the skill; otherwise there is
 * nothing to be consistent or inconsistent with.
 */
function resolveCvConsistency(
  context: HeuristicAnswerContext,
  answerScore: number,
): AnswerEvaluation['cvConsistency'] {
  if (!context.cvClaimsSkill || !context.skillLabel) return 'not_applicable';
  if (answerScore >= 60) return 'supports';
  if (answerScore < 35) return 'contradicts';
  return 'neutral';
}

/** The most information-dense sentences, used as evidence in the report. */
function extractQuotes(answer: string): string[] {
  return answer
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 25 && /\d|because|instead|trade-?off/i.test(sentence))
    .slice(0, 3)
    .map((sentence) => sentence.slice(0, 300));
}

function nonAnswerEvaluation(context: HeuristicAnswerContext, wordCount: number): AnswerEvaluation {
  const empty = wordCount === 0;
  return {
    relevance: 0,
    correctness: 0,
    completeness: 0,
    clarity: empty ? 0 : 15,
    confidence: 0,
    technicalDepth: 0,
    communication: empty ? 0 : 15,
    reasoning: 0,
    evidenceQuality: 0,
    answerScore: 0,
    cvConsistency: context.cvClaimsSkill ? 'contradicts' : 'not_applicable',
    strengths: [],
    gaps: [
      empty
        ? 'No answer was given, so nothing could be assessed.'
        : 'The answer was too short to demonstrate anything about this topic.',
    ],
    evidenceQuotes: [],
    followUpRecommendation: 'test_concept',
    followUpReason: 'Nothing was demonstrated; the fundamentals need to be established directly.',
    insufficientEvidence: true,
  };
}
