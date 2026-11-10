/**
 * The calibration contract: every level's reference solutions get exactly their expected grade, and every
 * anti-solution fails exactly the checks it is meant to. A failure here after an engine or catalog change
 * means a level needs deliberate recalibration.
 */
import { describe, expect, it } from 'vitest';
import { evaluateDesign } from '../src/evaluate.ts';
import { LEVELS } from '../src/levels/index.ts';
import { validateDesign } from '../src/validate.ts';

describe('level catalogue', () => {
  it('has unique ids in play order', () => {
    const ids = LEVELS.map((level) => level.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe.each(LEVELS.map((level) => [level.id, level] as const))('%s', (_, level) => {
  it.each(level.solutions.map((solution) => [solution.name, solution] as const))(
    'solution "%s" is valid and earns its expected grade',
    (_, solution) => {
      expect(validateDesign(solution.design, level)).toEqual([]);
      const evaluation = evaluateDesign(level, solution.design);
      expect(evaluation.status === 'graded' && evaluation.grade).toBe(solution.expectedGrade);
    },
  );

  it.each(level.antiSolutions.map((anti) => [anti.name, anti] as const))(
    'anti-solution "%s" fails as intended',
    (_, anti) => {
      const evaluation = evaluateDesign(level, anti.design);
      if (anti.expectedFailure === 'invalid') {
        expect(evaluation.status).toBe('invalid');
      } else {
        expect(evaluation.status === 'graded' && evaluation.failedChecks).toEqual(anti.expectedFailure);
      }
    },
  );
});
