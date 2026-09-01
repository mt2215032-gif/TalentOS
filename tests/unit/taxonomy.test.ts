import { describe, expect, it } from 'vitest';
import { detectSkills, relatedSkills, resolveSkill } from '@/lib/ai/taxonomy';
import { toSkillKey } from '@/lib/schemas/domain';

describe('skill key normalisation', () => {
  it('collapses spellings of the same skill onto one key', () => {
    expect(toSkillKey('Node.js')).toBe(toSkillKey('nodejs'));
    expect(toSkillKey('Scikit-Learn')).toBe(toSkillKey('scikit learn'));
    expect(toSkillKey('  Power   BI ')).toBe('power-bi');
  });

  it('keeps symbol-bearing names distinct', () => {
    // "C++" and "C#" must not both collapse onto "c".
    expect(toSkillKey('C++')).toBe('cpp');
    expect(toSkillKey('C#')).toBe('csharp');
    expect(toSkillKey('C++')).not.toBe(toSkillKey('C#'));
  });

  it('strips diacritics', () => {
    expect(toSkillKey('Café')).toBe('cafe');
  });
});

describe('resolveSkill', () => {
  it('maps aliases to the canonical label', () => {
    expect(resolveSkill('JS').label).toBe('JavaScript');
    expect(resolveSkill('postgres').label).toBe('PostgreSQL');
    expect(resolveSkill('k8s').label).toBe('Kubernetes');
  });

  it('passes unknown skills through rather than discarding them', () => {
    const resolved = resolveSkill('Quantum Widgetry');
    expect(resolved.known).toBe(false);
    expect(resolved.label).toBe('Quantum Widgetry');
    expect(resolved.key).toBe('quantum-widgetry');
  });
});

describe('detectSkills', () => {
  it('finds skills mentioned in prose', () => {
    const found = detectSkills(
      'Built a recommender in Python with scikit-learn, deployed on AWS behind Docker.',
    ).map((skill) => skill.label);

    expect(found).toContain('Python');
    expect(found).toContain('Scikit-learn');
    expect(found).toContain('AWS');
    expect(found).toContain('Docker');
  });

  it('does not match a skill inside a longer word', () => {
    // "Go" must not fire on "Google"; "R" must not fire on every word.
    const found = detectSkills('I used Google Analytics and read reports.').map((s) => s.label);
    expect(found).not.toContain('Go');
    expect(found).not.toContain('R');
  });

  it('returns each skill once regardless of repetition', () => {
    const found = detectSkills('Python, python, PYTHON everywhere');
    expect(found.filter((skill) => skill.label === 'Python')).toHaveLength(1);
  });
});

describe('relatedSkills', () => {
  it('suggests adjacent skills for study plans', () => {
    expect(relatedSkills('Machine Learning')).toContain('Scikit-learn');
  });

  it('returns nothing for an unknown skill', () => {
    expect(relatedSkills('Quantum Widgetry')).toEqual([]);
  });
});
