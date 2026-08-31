import { describe, expect, it } from 'vitest';
import { analyzeAnswerOffline } from '@/lib/ai/heuristic/answer';
import { analyzeText, topicOverlap } from '@/lib/ai/heuristic/text';
import type { HeuristicAnswerContext } from '@/lib/ai/heuristic/context';

const base: HeuristicAnswerContext = {
  question: 'Walk me through the last time you used Airflow on real work.',
  category: 'practical',
  difficulty: 'medium',
  skillLabel: 'Airflow',
  expectedCompetency: 'Has genuine hands-on experience and made deliberate design decisions.',
  evaluationCriteria: [
    'Describes a specific piece of work',
    'Names concrete decisions and alternatives',
    'Gives scale or measurable outcomes',
  ],
  answerText: '',
  cvClaimsSkill: true,
};

const STRONG =
  'I owned our Airflow deployment. The nightly ETL was a single DAG taking 3 hours, so I split it ' +
  'into 12 task groups with per-task retries because a single failure was re-running everything. ' +
  'I moved the scheduler to a Celery executor with 6 workers, which brought the run to 25 minutes. ' +
  'The trade-off was operational: more moving parts, so I added SLA alerts instead of relying on ' +
  'someone watching the UI.';

const DECENT =
  'We used Airflow to schedule our nightly ETL jobs. I set up the DAGs and configured retries so ' +
  'failures did not block the whole pipeline, and I added alerting when a task failed twice.';

const VAGUE = 'I think we used Airflow sometimes for scheduling stuff, maybe for reports.';

describe('offline answer scoring', () => {
  it('orders answers by quality', () => {
    const strong = analyzeAnswerOffline({ ...base, answerText: STRONG }).answerScore;
    const decent = analyzeAnswerOffline({ ...base, answerText: DECENT }).answerScore;
    const vague = analyzeAnswerOffline({ ...base, answerText: VAGUE }).answerScore;

    expect(strong).toBeGreaterThan(decent);
    expect(decent).toBeGreaterThan(vague);
  });

  it('places a strong answer in the upper band and a vague one in the lower', () => {
    expect(analyzeAnswerOffline({ ...base, answerText: STRONG }).answerScore).toBeGreaterThanOrEqual(65);
    expect(analyzeAnswerOffline({ ...base, answerText: VAGUE }).answerScore).toBeLessThan(45);
  });

  it('scores a non-answer at zero and flags insufficient evidence', () => {
    for (const text of ['', 'I dont know', 'no idea', 'pass']) {
      const result = analyzeAnswerOffline({ ...base, answerText: text });
      expect(result.answerScore).toBe(0);
      expect(result.insufficientEvidence).toBe(true);
    }
  });

  it('never recommends moving on from a weak answer', () => {
    for (const text of ['', VAGUE]) {
      const result = analyzeAnswerOffline({ ...base, answerText: text });
      expect(result.followUpRecommendation).not.toBe('move_on');
    }
  });

  it('recommends going deeper after a strong answer', () => {
    expect(analyzeAnswerOffline({ ...base, answerText: STRONG }).followUpRecommendation).toBe('deepen');
  });

  it('contradicts a CV claim the answer fails to support', () => {
    expect(analyzeAnswerOffline({ ...base, answerText: '' }).cvConsistency).toBe('contradicts');
  });

  it('reports not_applicable when the CV claims nothing about the skill', () => {
    const result = analyzeAnswerOffline({ ...base, answerText: STRONG, cvClaimsSkill: false });
    expect(result.cvConsistency).toBe('not_applicable');
  });

  it('keeps every dimension inside the 0-100 scale', () => {
    for (const text of ['', VAGUE, DECENT, STRONG, 'x '.repeat(4000)]) {
      const result = analyzeAnswerOffline({ ...base, answerText: text });
      for (const [key, value] of Object.entries(result)) {
        if (typeof value === 'number') {
          expect(value, `${key} out of range`).toBeGreaterThanOrEqual(0);
          expect(value, `${key} out of range`).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('text signals', () => {
  it('detects hedging', () => {
    expect(analyzeText(VAGUE).hedgeCount).toBeGreaterThan(0);
    expect(analyzeText(STRONG).hedgeCount).toBe(0);
  });

  it('counts concrete quantities', () => {
    expect(analyzeText(STRONG).numericMentions).toBeGreaterThan(2);
    expect(analyzeText(VAGUE).numericMentions).toBe(0);
  });

  it('measures ownership separately from team language', () => {
    expect(analyzeText('I designed and I built it').ownershipRatio).toBe(1);
    expect(analyzeText('We designed and we built it').ownershipRatio).toBe(0);
  });

  it('reports zero overlap when nothing relevant was said', () => {
    expect(topicOverlap('completely unrelated words here', ['Airflow scheduling'])).toBe(0);
  });
});
