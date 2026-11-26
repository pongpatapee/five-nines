/**
 * The title page (docs/design.md, "Title page"): the root opens on it, deep links skip it, and its way on is "Start"
 * into chapter 1 for a new player or "Continue" with their title to the contents for anyone who has begun.
 */
import { CHAPTERS } from '@five-nines/sim';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseHash, routeHref, type Route } from '../src/routing.ts';
import { hasStarted, playerTitle } from '../src/screens/campaign.ts';
import { story, TitlePage } from '../src/theme/index.ts';

describe('routes', () => {
  it('opens on the title page at the root, and on anything it does not know', () => {
    for (const hash of ['', '#', '#/', '#/nowhere']) expect(parseHash(hash), hash).toEqual({ name: 'title' });
  });

  it('keeps the contents and the deep links', () => {
    expect(parseHash('#/contents')).toEqual({ name: 'levels' });
    expect(parseHash('#/level/02-scale-out')).toEqual({ name: 'level', levelId: '02-scale-out' });
    expect(parseHash('#/all-hands/getting-online')).toEqual({ name: 'allHands', chapterId: 'getting-online' });
  });

  it('round-trips every route through its href', () => {
    const routes: Route[] = [
      { name: 'title' },
      { name: 'levels' },
      { name: 'level', levelId: '01-hello-traffic' },
      { name: 'allHands', chapterId: 'growing-pains' },
    ];
    for (const route of routes) expect(parseHash(routeHref(route))).toEqual(route);
  });
});

describe('who has started', () => {
  it('is nobody with an empty save', () => {
    expect(hasStarted({}, {})).toBe(false);
  });

  it('is anyone who has sat through an all-hands or graded a run', () => {
    expect(hasStarted({}, { 'getting-online': true })).toBe(true);
    expect(hasStarted({ '01-hello-traffic': 'fail' }, {})).toBe(true);
  });

  it("titles the player by their latest promotion, or the starting title", () => {
    expect(playerTitle({})).toBe(story.startingTitle);
    const capstone = CHAPTERS[0]!.capstoneId!;
    expect(playerTitle({ [capstone]: 'pass' })).toBe(story.promotions[CHAPTERS[0]!.id]!.title);
  });
});

describe('the title page', () => {
  const render = (playerTitle: string | null) =>
    renderToStaticMarkup(createElement(TitlePage, { playerTitle, goHref: '#/go', contentsHref: '#/contents', sound: null }));

  it('has a real heading, the company and the founder', () => {
    const html = render(null);
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Five Nines[\s\S]*<\/h1>/);
    expect(html).toContain(story.company);
    expect(html).toContain('Chad Visionary');
  });

  it('offers a new player Start, and anyone else Continue with their title', () => {
    expect(render(null)).toMatch(/href="#\/go"[^>]*>Start/);
    expect(render('10x Engineer')).toMatch(/href="#\/go"[^>]*>Continue as 10x Engineer/);
  });

  it('always links to the contents', () => {
    for (const title of [null, story.startingTitle]) expect(render(title)).toContain('href="#/contents"');
  });
});
