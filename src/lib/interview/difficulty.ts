import { stepDifficulty, type Difficulty } from '@/lib/schemas/domain';
import { recentAverage, type InterviewState } from '@/lib/interview/state';

/**
 * Difficulty controller.
 *
 * A real interviewer calibrates: strong answers earn harder questions, a
 * struggling candidate is not buried. Two rules keep that from thrashing —
 * decisions use a two-answer average rather than the last answer alone, and
 * difficulty moves one step at a time.
 */

/** Above this average, the candidate has earned harder questions. */
const RAISE_THRESHOLD = 72;

/** Below this, the current level is not producing usable evidence. */
const LOWER_THRESHOLD = 38;

/** Answers considered when deciding. */
const WINDOW = 2;

export interface DifficultyDecision {
  next: Difficulty;
  changed: boolean;
  reason: string;
}

export function nextDifficulty(
  current: Difficulty,
  state: InterviewState,
  options: { floor: Difficulty; ceiling: Difficulty },
): DifficultyDecision {
  const average = recentAverage(state, WINDOW);

  if (average === null || state.answerScores.length < WINDOW) {
    return {
      next: current,
      changed: false,
      reason: 'Not enough answers yet to calibrate difficulty.',
    };
  }

  if (average >= RAISE_THRESHOLD) {
    const raised = clamp(stepDifficulty(current, 1), options.floor, options.ceiling);
    return {
      next: raised,
      changed: raised !== current,
      reason:
        raised === current
          ? `Performing well (${average}/100) but already at the ceiling for this interview.`
          : `Last ${WINDOW} answers averaged ${average}/100 — raising difficulty to ${raised}.`,
    };
  }

  if (average <= LOWER_THRESHOLD) {
    const lowered = clamp(stepDifficulty(current, -1), options.floor, options.ceiling);
    return {
      next: lowered,
      changed: lowered !== current,
      reason:
        lowered === current
          ? `Struggling (${average}/100) and already at the floor for this interview.`
          : `Last ${WINDOW} answers averaged ${average}/100 — easing to ${lowered} to find their level.`,
    };
  }

  return {
    next: current,
    changed: false,
    reason: `Last ${WINDOW} answers averaged ${average}/100 — holding at ${current}.`,
  };
}

/**
 * Bounds for a given starting difficulty.
 *
 * An interview booked as "easy" may rise but should not become an expert
 * interview; one booked as "expert" should not collapse to easy. The candidate
 * chose a level and the interview stays recognisably that level.
 */
export function difficultyBounds(selected: Difficulty): { floor: Difficulty; ceiling: Difficulty } {
  return {
    floor: stepDifficulty(selected, -1),
    ceiling: stepDifficulty(selected, 1),
  };
}

function clamp(value: Difficulty, floor: Difficulty, ceiling: Difficulty): Difficulty {
  const order: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
  const index = order.indexOf(value);
  const min = order.indexOf(floor);
  const max = order.indexOf(ceiling);
  return order[Math.min(max, Math.max(min, index))] as Difficulty;
}
