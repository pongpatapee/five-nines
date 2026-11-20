/**
 * The story (docs/story/everything-labs.md) against its rules: every level has a product and a memo, every written
 * chapter an all-hands and a promotion; the founder never states a number; every number Erasmus writes in a memo is
 * in the level's numbers box (or is the 70% rule), so the story never contradicts the sim; and the pages draw.
 */
import { CHAPTERS, isWritten, LEVELS, levelNumbers, type Level } from '@five-nines/sim';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AllHands, BriefingCard, CastLine, cast, numbersText, story, type SceneBeat } from '../src/theme/index.ts';

const CASES = LEVELS.map((level) => [level.id, level] as const);
const WRITTEN = CHAPTERS.filter(isWritten).map((chapter) => [chapter.id, chapter] as const);

const boxText = (level: Level) => {
  const text = numbersText(levelNumbers(level));
  return [
    ...text.groups.flatMap((group) => group.rows.map((row) => `${row.label}: ${row.value}`)),
    ...(text.during?.items ?? []),
  ].join('\n');
};

/** The numbers in some text: "1,000", "99.8", "75". */
const numbersIn = (text: string) => [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) => match[0].replace(/,/g, ''));
const memoOf = (level: Level) => story.memo(level.id, levelNumbers(level))!;
const founderLines = (beats: readonly SceneBeat[]) =>
  beats.flatMap((beat) => (beat.kind === 'line' && beat.role === 'founder' ? [beat.text] : []));

/** The ladder's titles may carry a digit ("10x Engineer"); that is a name, not a number the founder states. */
const TITLES = [story.startingTitle, ...Object.values(story.promotions).map((promotion) => promotion.title)];
const withoutTitles = (text: string) => TITLES.reduce((rest, title) => rest.replaceAll(title, ''), text);

describe('the founder', () => {
  it('is a member of the cast with a figure of his own', () => {
    expect(cast.members.founder.name).toBe('Chad Visionary');
    const html = renderToStaticMarkup(createElement(CastLine, { role: 'founder', children: 'Team. Family.' }));
    expect(html).toContain('Chad Visionary');
    expect(html).toContain('<svg');
  });
});

describe('every level', () => {
  it.each(CASES)('%s has a product and a memo', (_, level) => {
    expect(story.product(level.id)).toMatch(/Everything/);
    const memo = memoOf(level);
    expect(memo.hype.length).toBeGreaterThan(0);
    expect(memo.translation.length).toBeGreaterThan(0);
  });

  it.each(CASES)('%s: the founder states no number', (_, level) => {
    expect(memoOf(level).hype).not.toMatch(/\d/);
  });

  it.each(CASES)("%s: every number in Erasmus's translation is in the numbers box", (_, level) => {
    const box = new Set([...numbersIn(boxText(level)), '70']);
    for (const number of numbersIn(memoOf(level).translation)) expect(box, `${number} in ${memoOf(level).translation}`).toContain(number);
  });

  it.each(CASES)('%s: the memo says no event happens at a particular time', (_, level) => {
    expect(memoOf(level).translation).not.toMatch(/\bat \d|\bafter \d+ ?s\b/);
  });

  it('marks the capstone with the product it launches', () => {
    expect(story.product('11-everything-links')).toBe('Everything Links · launch day');
  });
});

describe('every written chapter', () => {
  it.each(WRITTEN)('%s opens with an all-hands, and the founder states no number in it', (id) => {
    const scene = story.allHands(id)!;
    expect(scene.beats.some((beat) => beat.kind === 'stamp')).toBe(true);
    for (const line of founderLines(scene.beats)) expect(withoutTitles(line)).not.toMatch(/\d/);
  });

  it.each(WRITTEN)('%s ends in a promotion, stamped with its title', (id) => {
    const promotion = story.promotions[id]!;
    expect(promotion.beats).toContainEqual({ kind: 'stamp', text: promotion.title });
    for (const line of founderLines(promotion.beats)) expect(withoutTitles(line)).not.toMatch(/\d/);
  });

  it('climbs the ladder: Synergy Intern, 10x Engineer, Paradigm Architect, Chief Disruption Officer', () => {
    expect([story.startingTitle, ...WRITTEN.map(([id]) => story.promotions[id]!.title)]).toEqual([
      'Synergy Intern',
      '10x Engineer',
      'Paradigm Architect',
      'Chief Disruption Officer',
    ]);
  });

  it('has no all-hands or promotion for a chapter not yet written', () => {
    for (const chapter of CHAPTERS.filter((c) => !isWritten(c))) {
      expect(story.allHands(chapter.id)).toBeNull();
      expect(story.promotions[chapter.id]).toBeUndefined();
    }
  });
});

describe('the story pages', () => {
  it('draws an all-hands: its beats, the stamp and the way on', () => {
    const html = renderToStaticMarkup(
      createElement(AllHands, {
        scene: story.allHands('getting-online')!,
        chapterNumber: 1,
        chapterTitle: 'Getting Online',
        continueLabel: 'On to p.1 · Hello, Traffic',
        onContinue: () => {},
        backHref: '#/',
      }),
    );
    expect(html).toContain('Everything Links');
    expect(html).toContain('The waitlist opens today');
    expect(html).toContain(story.words.go.replace("'", '&#x27;'));
    expect(html).toContain('On to p.1');
  });

  it('draws a briefing card: the memo, the numbers drawn, and the sticky note behind more', () => {
    const level = LEVELS.find((l) => l.id === '02-scale-out')!;
    const html = renderToStaticMarkup(
      createElement(BriefingCard, { memo: memoOf(level), numbers: levelNumbers(level), traffic: level.workload.traffic, more: null }),
    );
    expect(html).toContain('Chad Visionary');
    expect(html).toContain('Bex');
    expect(html).toContain('5,000');
    expect(html).toContain('<details class="brief-card__more">');
  });

  it('keeps more open for a level whose card has no goal line', () => {
    const level = LEVELS.find((l) => l.id === '07-the-write-wall')!;
    expect(memoOf(level).goal).toBeNull();
    const html = renderToStaticMarkup(
      createElement(BriefingCard, { memo: memoOf(level), numbers: levelNumbers(level), traffic: level.workload.traffic, more: null }),
    );
    expect(html).toContain('<details class="brief-card__more" open="">');
  });
});
