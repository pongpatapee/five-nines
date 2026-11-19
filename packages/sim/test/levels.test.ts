/**
 * The calibration contract: every level's reference solutions get exactly their expected grade, and every
 * anti-solution fails exactly the checks it is meant to. A failure here after an engine or catalog change
 * means a level needs deliberate recalibration.
 */
import { describe, expect, it } from 'vitest';
import { evaluateDesign } from '../src/evaluate.ts';
import { CHAPTERS, isCapstone, isWritten } from '../src/levels/chapters.ts';
import { COMPONENTS_IN_CAMPAIGN, LEVELS } from '../src/levels/index.ts';
import { ComponentKindSchema } from '../src/schema.ts';
import { validateDesign } from '../src/validate.ts';

describe('level catalogue', () => {
  it('offers every catalog kind in some level, except blob storage, which waits for its first level', () => {
    const unused = ComponentKindSchema.options.filter((kind) => !COMPONENTS_IN_CAMPAIGN.includes(kind));
    expect(unused).toEqual(['blobStorage']);
  });

  it('turns blob storage away in every level', () => {
    for (const level of LEVELS) {
      const issues = validateDesign(
        { nodes: [{ id: 'bucket', kind: 'blobStorage' }], edges: [{ from: 'clients', to: 'bucket' }] },
        level,
      );
      expect(issues.map((issue) => issue.code), level.id).toContain('component_not_allowed');
    }
  });

  it('has unique ids', () => {
    // Ids are permanent save keys, numbered in the order levels were written; play order is the chapters' order.
    const ids = LEVELS.map((level) => level.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ends a chapter on its capstone, when it has one', () => {
    const withCapstone = CHAPTERS.filter((chapter) => chapter.capstoneId !== undefined);
    expect(withCapstone.map((chapter) => chapter.id)).toEqual(['getting-online']);
    for (const chapter of withCapstone) {
      expect(chapter.levelIds.at(-1)).toBe(chapter.capstoneId);
      expect(isCapstone(CHAPTERS, chapter.capstoneId!)).toBe(true);
    }
    expect(isCapstone(CHAPTERS, '03-pull-the-plug')).toBe(false);
  });

  it('groups every level into exactly one chapter, in play order, before the planned chapters', () => {
    const written = CHAPTERS.filter(isWritten);
    expect(written.flatMap((chapter) => chapter.levelIds)).toEqual(LEVELS.map((level) => level.id));
    expect(CHAPTERS.slice(0, written.length)).toEqual(written);
    expect(new Set(CHAPTERS.map((chapter) => chapter.id)).size).toBe(CHAPTERS.length);
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
