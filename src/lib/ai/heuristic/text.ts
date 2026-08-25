/**
 * Measurable properties of a piece of written English.
 *
 * The offline engine grades answers from these signals. They are deliberately
 * things that can be counted rather than judged, which is why the offline
 * engine is honest about being heuristic: it measures shape, not truth.
 */

const HEDGE_MARKERS = [
  'i think', 'i guess', 'maybe', 'probably', 'not sure', 'kind of', 'sort of',
  'i believe', 'possibly', 'might be', 'i suppose', 'or something', 'i forget',
  "i don't remember", "i can't remember", 'somewhat',
];

const CONFIDENCE_MARKERS = [
  'i designed', 'i built', 'i implemented', 'i decided', 'i led', 'i chose',
  'i measured', 'i reduced', 'i increased', 'we shipped', 'i shipped',
  'specifically', 'in practice', 'the reason', 'because', 'which meant',
];

const REASONING_MARKERS = [
  'because', 'therefore', 'so that', 'which means', 'the trade-off', 'tradeoff',
  'as a result', 'in order to', 'the reason', 'however', 'whereas', 'instead of',
  'compared to', 'the downside', 'the advantage', 'this avoids', 'otherwise',
];

/** STAR structure markers, used when grading behavioural answers. */
const STAR_MARKERS = {
  situation: ['the situation', 'at the time', 'we were', 'the context', 'the problem was'],
  task: ['my job', 'i was responsible', 'my task', 'i had to', 'the goal was', 'i needed to'],
  action: ['i did', 'i built', 'i organised', 'i organized', 'i proposed', 'i set up', 'i implemented', 'i talked', 'i decided'],
  result: ['as a result', 'the outcome', 'we ended up', 'this led to', 'in the end', 'which reduced', 'which improved', 'resulting in'],
};

const NON_ANSWER_PATTERNS = [
  /^i (don'?t|do not) know\.?$/i,
  /^no idea\.?$/i,
  /^(pass|skip|next)\.?$/i,
  /^n\/?a\.?$/i,
  /^\W*$/,
];

export interface TextSignals {
  wordCount: number;
  sentenceCount: number;
  averageSentenceWords: number;
  /** Distinct words divided by total words — low means repetitive padding. */
  lexicalDiversity: number;
  /** Counts of concrete detail: numbers, percentages, durations, scale. */
  numericMentions: number;
  hedgeCount: number;
  confidenceMarkerCount: number;
  reasoningMarkerCount: number;
  /** How many of the four STAR components are present. */
  starComponents: number;
  /** First-person singular ownership relative to plural "we". */
  ownershipRatio: number;
  isNonAnswer: boolean;
}

export function analyzeText(input: string): TextSignals {
  const text = input.trim();
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 1);

  const distinct = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))).size;

  const countOccurrences = (markers: readonly string[]): number =>
    markers.reduce((total, marker) => (lower.includes(marker) ? total + 1 : total), 0);

  const starComponents = Object.values(STAR_MARKERS).filter((markers) =>
    markers.some((marker) => lower.includes(marker)),
  ).length;

  // Numbers that carry meaning: quantities, percentages, scale ("10x", "3 million").
  const numericMentions = (text.match(/\b\d[\d,.]*\s*(%|x|k|m|bn|million|billion|thousand|ms|s|sec|min|hours?|days?|weeks?|months?|years?|gb|tb|mb|qps|rps|users?|rows?|records?)?\b/gi) ?? []).length;

  const singular = (lower.match(/\bi\b|\bmy\b/g) ?? []).length;
  const plural = (lower.match(/\bwe\b|\bour\b/g) ?? []).length;

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    averageSentenceWords: sentences.length ? words.length / sentences.length : words.length,
    lexicalDiversity: words.length ? distinct / words.length : 0,
    numericMentions,
    hedgeCount: countOccurrences(HEDGE_MARKERS),
    confidenceMarkerCount: countOccurrences(CONFIDENCE_MARKERS),
    reasoningMarkerCount: countOccurrences(REASONING_MARKERS),
    starComponents,
    ownershipRatio: singular + plural === 0 ? 0 : singular / (singular + plural),
    isNonAnswer: NON_ANSWER_PATTERNS.some((pattern) => pattern.test(text)) || words.length < 4,
  };
}

/**
 * Fraction of a reference vocabulary the answer actually used.
 *
 * Compare against the *question and skill*, never against the grading rubric:
 * rubric text is meta-language about an answer ("describes a specific piece of
 * work") and shares almost no vocabulary with the answer itself, so scoring
 * against it punishes good answers for using domain words instead of grading
 * words.
 */
export function topicOverlap(answer: string, expectations: readonly string[]): number {
  const expected = new Set(
    expectations
      .join(' ')
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word)),
  );
  if (expected.size === 0) return 0;

  const answerWords = new Set(
    answer
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter(Boolean),
  );

  let hits = 0;
  for (const word of expected) {
    // Stem-insensitive containment catches "optimise"/"optimisation".
    if (answerWords.has(word) || [...answerWords].some((w) => w.startsWith(word.slice(0, 5)) && w.length > 4)) {
      hits += 1;
    }
  }
  return hits / expected.size;
}

const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'they', 'what', 'when', 'where',
  'which', 'would', 'about', 'their', 'there', 'been', 'were', 'your', 'into',
  'them', 'than', 'then', 'some', 'such', 'only', 'also', 'more', 'most',
  'other', 'very', 'used', 'using', 'able', 'candidate', 'answer', 'should',
  'shows', 'show', 'explains', 'explain', 'describes', 'describe', 'mentions',
  'demonstrates', 'demonstrate', 'clear', 'good', 'strong',
]);

/**
 * Density of substantive technical vocabulary.
 *
 * Counts recognised domain terms and multi-syllable technical nouns relative to
 * a realistic ceiling. This is the signal that separates "we used Airflow for
 * scheduling" from an answer naming executors, DAGs, retries and SLAs.
 */
export function technicalDensity(text: string, knownTerms: readonly string[]): number {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z0-9+#.]+/).filter(Boolean);
  if (words.length === 0) return 0;

  let hits = 0;
  for (const term of knownTerms) {
    if (lower.includes(term.toLowerCase())) hits += 1;
  }

  // Domain jargon that is not in the skill taxonomy but signals real depth.
  const jargon = words.filter(
    (word) =>
      word.length >= 7 &&
      !GENERIC_LONG_WORDS.has(word) &&
      /[aeiou]/.test(word),
  ).length;

  // Six distinct technical signals in an answer is already dense.
  const raw = hits * 2 + Math.min(jargon, 12) * 0.5;
  return Math.min(1, raw / 8);
}

const GENERIC_LONG_WORDS = new Set([
  'basically', 'generally', 'something', 'everything', 'anything', 'situation',
  'important', 'different', 'sometimes', 'obviously', 'definitely', 'actually',
  'probably', 'interesting', 'experience', 'understand', 'understood',
  'basically', 'together', 'yourself', 'themselves', 'therefore', 'however',
]);

/** Clamp to the 0–100 integer scale used everywhere in the product. */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Weighted mean that ignores null contributions. */
export function weightedAverage(entries: ReadonlyArray<readonly [number | null, number]>): number {
  let total = 0;
  let weight = 0;
  for (const [value, w] of entries) {
    if (value === null || !Number.isFinite(value)) continue;
    total += value * w;
    weight += w;
  }
  return weight === 0 ? 0 : clampScore(total / weight);
}
