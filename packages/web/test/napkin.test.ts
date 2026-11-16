/**
 * The napkin-maths worked solution as the notebook words it: every level's steps end on the recorded answer, use no
 * shorthand that was never explained, and render with the answer boxed exactly once.
 */
import { COMPONENT_LABELS, levelNumbers, LEVELS, solveEstimate, type Level, type NapkinGiven } from '@five-nines/sim';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatCount, formatEstimate, formatMs } from '../src/format.ts';
import { EstimateStep } from '../src/screens/EstimateStep.tsx';
import { cast, NapkinWorking, numbersText } from '../src/theme/index.ts';
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

/** Every way a given may be written in the question or the numbers box. */
function spellings({ value, unit }: NapkinGiven): string[] {
  switch (unit) {
    case 'count': {
      const out = [formatCount(value)];
      if (value >= 1e6 && value % 1e5 === 0) out.push(`${value / 1e6} million`);
      if (value >= 1e9 && value % 1e8 === 0) out.push(`${value / 1e9} billion`);
      return out;
    }
    case 'percent':
      return [`${formatEstimate(value * 100)}%`];
    case 'ms':
      return [formatMs(value)];
    case 'ratio':
      return [formatEstimate(value)];
    case 'seconds':
      return [
        `${value} s`,
        `${value} second`,
        ...(value % 60 === 0 ? [`${value / 60} min`, `${value / 60} minute`] : []),
      ];
    case 'clock':
      return [`${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`];
  }
}

/** Whether `text` holds `spelling` as a whole number (not inside a longer one). */
function holds(text: string, spelling: string): boolean {
  const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\d.,])${escaped}(?![\\d]|[.,]\\d)`).test(text);
}

const boxText = (level: Level) => {
  const text = numbersText(levelNumbers(level));
  return [
    ...text.groups.flatMap((group) => group.rows.map((row) => `${row.label}: ${row.value}`)),
    ...(text.during?.items ?? []),
  ].join('\n');
};

describe('the napkin question is self-contained (docs/design.md, "Estimate step")', () => {
  it.each(CASES)('%s: every number the working starts from is in the question or the numbers box', (_, level) => {
    const solution = solve(level);
    const { question } = cast.mentorEstimate.ask(solution.working, level);
    const shown = `${question}\n${boxText(level)}`;
    for (const given of solution.givens) {
      const found = spellings(given).some((spelling) => holds(shown, spelling));
      // A component's catalog figure may be left to the component the question names: "a large database".
      const words = given.spec ? [given.spec.size, ...SPEC_NOUNS[given.spec.kind]] : [];
      const named = given.spec !== undefined && words.slice(1).some((noun) => question.includes(`${given.spec!.size} ${noun}`));
      expect(found || named, `${given.value} (${given.unit}) in: ${question}`).toBe(true);
    }
  });

  it.each(CASES)('%s: the numbers box has the traffic, CPU per request, timeout and what it takes to pass', (_, level) => {
    const numbers = levelNumbers(level);
    const text = boxText(level);
    expect(text).toContain(`CPU per request: ${formatMs(level.workload.cpuMsPerRequest)}`);
    expect(text).toContain(`Request timeout: ${formatMs(level.workload.timeoutMs)}`);
    expect(text).toContain(formatCount(numbers.traffic.sustainedRps));
    for (const spike of numbers.traffic.spikes) expect(text).toContain(`${formatCount(spike.rps)} for ${spike.durationSec} s`);
    expect(text).toContain(`p99 latency: ≤ ${formatMs(level.requirements.p99Ms)}`);
    expect(text).toContain('Budget: ≤ $');
    expect(text).toContain('Availability: ≥ 99.9%');
    if (level.workload.data) expect(text).toMatch(/Reads and writes: /);
    if (level.requirements.maxStalenessSec !== undefined) expect(text).toContain(`${level.requirements.maxStalenessSec} s out of date`);
  });

  it('names what happens during the run without saying when', () => {
    const during = (id: string) => numbersText(levelNumbers(LEVELS.find((level) => level.id === id)!)).during?.items ?? [];
    expect(during('01-hello-traffic')).toEqual([]);
    expect(during('03-pull-the-plug')).toEqual(['an app server will crash']);
    expect(during('08-thundering-herd')).toEqual(['the cache will restart']);
    expect(during('07-the-write-wall')).toEqual(["a hot key: a celebrity's post"]);
    expect(during('10-flash-sale')).toEqual(['the payment provider refuses calls over its rate limit']);
    for (const level of LEVELS) for (const item of during(level.id)) expect(item).not.toMatch(/\d/);
  });

  it('asks the approved questions', () => {
    const ask = (id: string) => {
      const level = LEVELS.find((l) => l.id === id)!;
      return cast.mentorEstimate.ask(solve(level).working, level).question;
    };
    expect(ask('04-read-all-about-it')).toBe(
      'After the writes, a large database has room for 6,750 reads a second. At the peak, 24,700 reads arrive. What share must the cache catch?',
    );
    expect(ask('05-cache-miss')).toBe(
      '100 million profiles, all equally likely, and 19,200 reads a second at the peak. On average, how long between two reads of the same profile?',
    );
    expect(ask('06-bank-balance')).toBe(
      '3,800 reads a second are users checking a transfer they just made, so they must read from the primary. The primary also takes 1,000 writes a second, and each costs as much as 2.5 reads. A large primary does 10,000 reads a second. How busy is it?',
    );
    expect(ask('08-thundering-herd')).toBe(
      'At 1:30 the cache restarts empty, and 29,700 reads a second fall straight on a large database that handles 10,000 reads a second. How many times its capacity is that?',
    );
    expect(ask('09-stale-prices')).toBe(
      'After the writes, a medium database has room for 4,880 reads a second. At the peak, 23,952 reads arrive. What share must the cache catch?',
    );
    expect(ask('10-flash-sale')).toContain('start charging as orders arrive');
  });
});

const SPEC_NOUNS: Record<keyof typeof COMPONENT_LABELS, string[]> = {
  appServer: ['server'],
  loadBalancer: ['load balancer'],
  cache: ['cache'],
  database: ['database', 'primary', 'shard'],
  readReplicas: ['replica'],
  shards: ['shard'],
  queue: ['queue'],
  paymentProvider: ['provider'],
};
