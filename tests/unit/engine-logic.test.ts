import { describe, expect, it } from 'vitest';
import {
  createInitialState, recentAverage, recordAnswer, recordQuestion, remainingSkills, parseState,
} from '@/lib/interview/state';
import { difficultyBounds, nextDifficulty } from '@/lib/interview/difficulty';
import { buildPlanOffline } from '@/lib/ai/heuristic/plan';
import { generateQuestionOffline } from '@/lib/ai/heuristic/questions';
import { analyzeJobOffline } from '@/lib/ai/heuristic/documents';
import { stepDifficulty, scoreToLevel } from '@/lib/schemas/domain';

describe('interview state', () => {
  it('spends skill budget on a new question but not on a follow-up', () => {
    let state = createInitialState([{ skillLabel: 'SQL', budget: 3 }]);

    state = recordQuestion(state, {
      question: 'Q1', category: 'practical', difficulty: 'medium', skillLabel: 'SQL', wasFollowUp: false,
    });
    expect(state.coverage[0]?.used).toBe(1);

    // A follow-up digs into a skill already paid for.
    state = recordQuestion(state, {
      question: 'Q2', category: 'conceptual', difficulty: 'medium', skillLabel: 'SQL', wasFollowUp: true,
    });
    expect(state.coverage[0]?.used).toBe(1);
    expect(state.followUpDepth).toBe(1);
  });

  it('resets follow-up depth when the subject changes', () => {
    let state = createInitialState([{ skillLabel: 'SQL', budget: 3 }]);
    state = recordQuestion(state, { question: 'a', category: 'practical', difficulty: 'medium', skillLabel: 'SQL', wasFollowUp: true });
    state = recordQuestion(state, { question: 'b', category: 'practical', difficulty: 'medium', skillLabel: 'SQL', wasFollowUp: false });
    expect(state.followUpDepth).toBe(0);
  });

  it('reports skills that still have budget, most under-served first', () => {
    let state = createInitialState([
      { skillLabel: 'SQL', budget: 1 },
      { skillLabel: 'Python', budget: 3 },
    ]);
    state = recordQuestion(state, { question: 'q', category: 'practical', difficulty: 'medium', skillLabel: 'SQL', wasFollowUp: false });

    const remaining = remainingSkills(state);
    expect(remaining[0]?.label).toBe('Python');
    expect(remaining.find((entry) => entry.label === 'SQL')).toBeUndefined();
  });

  it('rebuilds rather than throwing on an unreadable state document', () => {
    const state = parseState({ version: 99, nonsense: true }, [{ skillLabel: 'SQL', budget: 2 }]);
    expect(state.version).toBe(1);
    expect(state.coverage).toHaveLength(1);
  });

  it('averages only the most recent answers', () => {
    let state = createInitialState([]);
    for (const score of [10, 10, 90, 90]) state = recordAnswer(state, { skillLabel: null, score });
    expect(recentAverage(state, 2)).toBe(90);
    expect(recentAverage(createInitialState([]), 2)).toBeNull();
  });
});

describe('difficulty controller', () => {
  const bounds = difficultyBounds('medium');

  it('bounds an interview to one step either side of the chosen level', () => {
    expect(bounds).toEqual({ floor: 'easy', ceiling: 'hard' });
    expect(difficultyBounds('easy')).toEqual({ floor: 'easy', ceiling: 'medium' });
    expect(difficultyBounds('expert')).toEqual({ floor: 'hard', ceiling: 'expert' });
  });

  it('holds until there are enough answers to judge', () => {
    let state = createInitialState([]);
    state = recordAnswer(state, { skillLabel: null, score: 95 });
    expect(nextDifficulty('medium', state, bounds).changed).toBe(false);
  });

  it('raises after consistently strong answers', () => {
    let state = createInitialState([]);
    for (const score of [85, 90]) state = recordAnswer(state, { skillLabel: null, score });
    expect(nextDifficulty('medium', state, bounds).next).toBe('hard');
  });

  it('eases after consistently weak answers', () => {
    let state = createInitialState([]);
    for (const score of [20, 25]) state = recordAnswer(state, { skillLabel: null, score });
    expect(nextDifficulty('medium', state, bounds).next).toBe('easy');
  });

  it('never moves outside the bounds', () => {
    let state = createInitialState([]);
    for (const score of [95, 98]) state = recordAnswer(state, { skillLabel: null, score });
    expect(nextDifficulty('hard', state, bounds).next).toBe('hard');
  });

  it('moves one step at a time', () => {
    let state = createInitialState([]);
    for (const score of [99, 99]) state = recordAnswer(state, { skillLabel: null, score });
    expect(nextDifficulty('easy', state, difficultyBounds('easy')).next).toBe('medium');
  });
});

describe('interview planning', () => {
  const job = analyzeJobOffline(
    `Senior Data Engineer
Required
- Python and SQL and Python and Python
- Spark and Airflow
Nice to have
- dbt, Power BI`,
  );

  it('allocates exactly the available question budget', () => {
    for (const planned of [6, 8, 10, 14, 20]) {
      const plan = buildPlanOffline({
        roleTitle: 'SDE', interviewType: 'technical', difficulty: 'medium',
        plannedQuestions: planned, candidate: null, job,
      });
      const allocated = plan.skillTargets.reduce((sum, target) => sum + target.questionBudget, 0);
      // Two questions are reserved for the opener and the close.
      expect(allocated).toBe(planned - 2);
    }
  });

  it('gives more budget to higher-weighted skills', () => {
    const plan = buildPlanOffline({
      roleTitle: 'SDE', interviewType: 'technical', difficulty: 'medium',
      plannedQuestions: 14, candidate: null, job,
    });
    const required = plan.skillTargets.find((t) => t.skillLabel === 'Python')?.questionBudget ?? 0;
    const preferred = plan.skillTargets.find((t) => t.skillLabel === 'Power BI')?.questionBudget ?? 0;
    expect(required).toBeGreaterThan(preferred);
  });

  it('plans behavioural interviews around competencies, not technologies', () => {
    const plan = buildPlanOffline({
      roleTitle: 'SDE', interviewType: 'behavioral', difficulty: 'medium',
      plannedQuestions: 8, candidate: null, job,
    });
    expect(plan.skillTargets.map((t) => t.skillLabel)).toContain('Communication');
    expect(plan.skillTargets.map((t) => t.skillLabel)).not.toContain('Python');
  });
});

describe('question generation', () => {
  const base = {
    roleTitle: 'Senior Data Engineer',
    interviewType: 'technical' as const,
    candidate: null,
    job: null,
    targetSkills: [{ label: 'Airflow', remaining: 20 }],
    followUp: null,
    plannedQuestions: 24,
  };

  it('never repeats a question, even when one skill must carry the interview', () => {
    const asked: Array<{ question: string; [key: string]: unknown }> = [];
    for (let position = 1; position <= 20; position += 1) {
      const generated = generateQuestionOffline({
        ...base, position, difficulty: 'easy', asked: asked as never,
      });
      expect(asked.some((entry) => entry.question === generated.question)).toBe(false);
      asked.push({
        position, question: generated.question, category: generated.category,
        skillLabel: generated.skillLabel, difficulty: 'easy', answerText: 'x', answerScore: 50,
      });
    }
  });

  it('opens on real work rather than a definition', () => {
    const first = generateQuestionOffline({ ...base, position: 1, difficulty: 'medium', asked: [] });
    expect(['practical', 'experience', 'behavioral']).toContain(first.category);
  });

  it('produces a follow-up on the parent subject when the engine asks for one', () => {
    const followUp = generateQuestionOffline({
      ...base,
      position: 3,
      difficulty: 'medium',
      asked: [],
      followUp: {
        parentQuestion: 'Tell me about Airflow.',
        parentAnswer: 'We used it.',
        parentSkillLabel: 'Airflow',
        kind: 'example',
      },
    });
    expect(followUp.skillLabel).toBe('Airflow');
    expect(followUp.selectionRationale.toLowerCase()).toContain('example');
  });

  it('closes the interview on the final question', () => {
    const last = generateQuestionOffline({
      ...base, position: 24, plannedQuestions: 24, difficulty: 'medium', asked: [],
    });
    expect(last.category).toBe('closing');
  });
});

describe('score bands', () => {
  it('maps scores onto levels monotonically', () => {
    expect(scoreToLevel(95)).toBe('expert');
    expect(scoreToLevel(72)).toBe('advanced');
    expect(scoreToLevel(55)).toBe('intermediate');
    expect(scoreToLevel(35)).toBe('beginner');
    expect(scoreToLevel(10)).toBe('none');
  });

  it('clamps difficulty stepping at both ends', () => {
    expect(stepDifficulty('easy', -1)).toBe('easy');
    expect(stepDifficulty('expert', 1)).toBe('expert');
  });
});
