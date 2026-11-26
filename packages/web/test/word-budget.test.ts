/**
 * Chapter 1's word budgets (docs/design.md, "Word budgets"): the player should reach the canvas and press Run within
 * seconds, so every piece of text on the way is short. Measured from what the game actually shows: the briefing card
 * as rendered (outside "more", without the numbers drawn), the all-hands bubbles, the mentor's callout on every known
 * wrong answer, and the debrief. Later chapters may keep their longer copy. The title page the game opens on is held to
 * the same spirit: a glance at the world, then one way on.
 */
import { CHAPTERS, evaluateDesign, getLevel, levelNumbers, type Level } from '@five-nines/sim';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BriefingCard, cast, failureStory, story, TitlePage } from '../src/theme/index.ts';

const CHAPTER_1 = CHAPTERS[0]!;
const LEVELS_1 = CHAPTER_1.levelIds.map((id) => [id, getLevel(id)!] as const);

/** Words as a reader counts them: runs of text with a letter or digit in them ("75 ms" is two, "·" none). */
const words = (text: string) => text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;

const BUDGET = {
  chad: 20,
  goal: 20,
  beforeMore: 60,
  allHands: 45,
  callout: 25,
  debriefBullets: 3,
  debriefBullet: 30,
  titlePage: 28,
};

const memoOf = (level: Level) => story.memo(level.id, levelNumbers(level))!;

/** The briefing card's visible words: rendered, minus "more", the numbers drawn, and text only screen readers get. */
function visibleBeforeMore(level: Level): string {
  const html = renderToStaticMarkup(
    createElement(BriefingCard, {
      memo: memoOf(level),
      numbers: levelNumbers(level),
      traffic: level.workload.traffic,
      challenge: level.estimate ? createElement('button', null, cast.mentorEstimate.challenge) : null,
      more: null,
    }),
  );
  return html
    .replace(/<details[\s\S]*<\/details>/, ' ')
    .replace(/<section class="numbers-card"[\s\S]*?<\/section>/, ' ')
    .replace(/<span class="visually-hidden">[^<]*<\/span>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, "'");
}

describe("chapter 1's word budgets", () => {
  it('covers the whole chapter, capstone included', () => {
    expect(CHAPTER_1.levelIds).toEqual(['01-hello-traffic', '02-scale-out', '03-pull-the-plug', '11-everything-links']);
  });

  it.each(LEVELS_1)(`%s: Chad's line is at most ${BUDGET.chad} words`, (_, level) => {
    expect(words(memoOf(level).hype)).toBeLessThanOrEqual(BUDGET.chad);
  });

  it.each(LEVELS_1)(`%s: has a goal line of at most ${BUDGET.goal} words`, (_, level) => {
    const goal = memoOf(level).goal;
    expect(goal).not.toBeNull();
    expect(words(goal!)).toBeLessThanOrEqual(BUDGET.goal);
  });

  it.each(LEVELS_1)("%s: Erasmus's translation is one line", (_, level) => {
    const translation = memoOf(level).translation;
    expect(translation.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length).toBeLessThanOrEqual(2);
    expect(words(translation)).toBeLessThanOrEqual(BUDGET.goal);
  });

  it.each(LEVELS_1)(`%s: shows at most ${BUDGET.beforeMore} words before "more"`, (_, level) => {
    const text = visibleBeforeMore(level);
    expect(text).toContain(memoOf(level).hype.split(' ')[0]);
    expect(words(text), text).toBeLessThanOrEqual(BUDGET.beforeMore);
  });

  it(`opens with an all-hands of at most ${BUDGET.allHands} words in its bubbles, on one panel`, () => {
    const scene = story.allHands(CHAPTER_1.id)!;
    const bubbles = scene.beats.flatMap((beat) => (beat.kind === 'line' ? [beat.text] : []));
    expect(bubbles.length).toBeGreaterThanOrEqual(2);
    expect(bubbles.length).toBeLessThanOrEqual(3);
    expect(words(bubbles.join(' '))).toBeLessThanOrEqual(BUDGET.allHands);
    // Nothing else to read but the product's stamp.
    expect(scene.beats.filter((beat) => beat.kind !== 'line').map((beat) => beat.kind)).toEqual(['stamp']);
  });

  it.each(LEVELS_1)(`%s: every known wrong answer gets a callout of at most ${BUDGET.callout} words`, (_, level) => {
    for (const trap of level.antiSolutions.filter((anti) => anti.expectedFailure !== 'invalid')) {
      const evaluation = evaluateDesign(level, trap.design);
      if (evaluation.status !== 'graded') throw new Error(`${trap.name} should grade`);
      const failure = failureStory(level, trap.design, evaluation);
      expect(failure, trap.name).not.toBeNull();
      const callout = cast.mentorCallout(failure!);
      expect(words(callout), `${trap.name}: ${callout}`).toBeLessThanOrEqual(BUDGET.callout);
    }
  });

  it.each(LEVELS_1)(`%s: debriefs in at most ${BUDGET.debriefBullets} bullets of ${BUDGET.debriefBullet} words`, (_, level) => {
    expect(level.debrief.length).toBeLessThanOrEqual(BUDGET.debriefBullets);
    for (const bullet of level.debrief) expect(words(bullet), bullet).toBeLessThanOrEqual(BUDGET.debriefBullet);
  });
});

/** The title page's visible words beyond the title itself: rendered, without its heading, art or screen-reader text. */
function titlePageWords(playerTitle: string | null): string {
  const html = renderToStaticMarkup(createElement(TitlePage, { playerTitle, goHref: '#/', contentsHref: '#/contents', sound: null }));
  return html
    .replace(/<h1[\s\S]*?<\/h1>/, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<span class="visually-hidden">[^<]*<\/span>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, "'");
}

describe("the title page's word budget", () => {
  const titles = [null, story.startingTitle, ...Object.values(story.promotions).map((promotion) => promotion.title)];

  it.each(titles)(`shows at most ${BUDGET.titlePage} words beyond the title, as %s`, (playerTitle) => {
    const text = titlePageWords(playerTitle);
    expect(text).toContain(story.company);
    if (playerTitle) expect(text).toContain(playerTitle);
    expect(words(text), text).toBeLessThanOrEqual(BUDGET.titlePage);
  });
});
