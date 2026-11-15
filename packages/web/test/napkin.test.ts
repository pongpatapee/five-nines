/**
 * The napkin-maths worked solution as the notebook words it: every level's steps end on the recorded answer, use no
 * shorthand that was never explained, and render with the answer boxed exactly once.
 */
import { LEVELS, solveEstimate, type Level } from '@five-nines/sim';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatEstimate } from '../src/format.ts';
import { EstimateStep } from '../src/screens/EstimateStep.tsx';
import { cast, NapkinWorking } from '../src/theme/index.ts';
import { mainLine, NAPKIN_JARGON, workedSolution, type WorkedSolution } from '../src/theme/notebook/hints.ts';

const CASES = LEVELS.map((level) => [level.id, level] as const);
const solve = (level: Level) => solveEstimate(level, level.estimate!);
const lineText = (line: { sum: string | null; result: string; note?: string }) =>
  `${line.sum === null ? '' : `${line.sum} = `}${line.result}${line.note ? ` ${line.note}` : ''}`;
const allText = (worked: WorkedSolution) =>
  [...worked.steps.flatMap((step) => [step.reason, ...step.lines.map(lineText)]), worked.takeaway].join('\n');
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

describe('the worked napkin solution', () => {
  it.each(CASES)('%s works step by step and ends on the recorded answer', (_, level) => {
    const worked = workedSolution(solve(level));
    expect(worked.steps.length).toBeGreaterThanOrEqual(2);
    for (const step of worked.steps) {
      expect(step.reason.length).toBeGreaterThan(20);
      expect(step.lines.length).toBeGreaterThan(0);
    }
    expect(worked.takeaway.length).toBeGreaterThan(20);
    const answer = mainLine(worked.steps.at(-1)!).result;
    expect(answer).toMatch(new RegExp(`^${formatEstimate(level.estimate!.answer).replace('.', '\\.')}(?![\\d.,])`));
  });

  it.each(CASES)('%s uses no unexplained shorthand', (_, level) => {
    const text = allText(workedSolution(solve(level)));
    for (const word of NAPKIN_JARGON) expect(text, word).not.toContain(word);
    // "Reads' worth" of work only after the step that says what one write is worth.
    const worth = text.indexOf("reads' worth");
    if (worth >= 0) expect(text.indexOf('as much work as')).toBeGreaterThanOrEqual(0);
    if (worth >= 0) expect(text.indexOf('as much work as')).toBeLessThan(worth);
  });

  it.each(CASES)('%s renders numbered steps with the answer boxed once', (_, level) => {
    const html = unescape(renderToStaticMarkup(createElement(NapkinWorking, { solution: solve(level) })));
    const worked = workedSolution(solve(level));
    expect(html.match(/<li /g)).toHaveLength(worked.steps.length);
    expect(html.match(/data-answer/g)).toHaveLength(1);
    expect(html).toContain(`${cast.members.mentor.name}'s working`);
  });

  it('works level 4 the way a player would on paper', () => {
    const text = allText(workedSolution(solve(LEVELS.find((level) => level.id === '04-read-all-about-it')!)));
    for (const line of [
      '26,000 req/s',
      '26,000 × 95% = 24,700 reads/s',
      '26,000 − 24,700 = 1,300 writes/s',
      '10,000 ÷ 4,000 = 2.5 one write costs as much as 2.5 reads',
      "1,300 writes × 2.5 = 3,250 reads' worth",
      '10,000 − 3,250 = 6,750 reads/s',
      '6,750 ÷ 24,700 = 27.3%',
      '100% − 27.3% = 72.7%',
      'a cache only helps reads',
      '78.7%',
      '84.8%',
    ]) {
      expect(text.toLowerCase()).toContain(line.toLowerCase());
    }
  });

  it('shows the working when the step reopens on it', () => {
    const level = LEVELS[3]!;
    const props = {
      level,
      estimate: level.estimate!,
      record: { guess: 60, close: false },
      onAnswer: () => [],
      onSkip: () => {},
      onClose: () => {},
    };
    const review = unescape(renderToStaticMarkup(createElement(EstimateStep, { ...props, start: 'review' })));
    expect(review).toContain(cast.mentorEstimate.review.line);
    expect(review).toContain('Your last estimate');
    expect(review).toContain('data-answer');
    const ask = unescape(renderToStaticMarkup(createElement(EstimateStep, props)));
    expect(ask).not.toContain('data-answer');
    expect(ask).toContain(cast.mentorEstimate.revisit);
  });
});
