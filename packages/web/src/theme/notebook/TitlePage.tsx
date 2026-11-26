/**
 * The title page: the notebook's cover, a kraft board with a paper label. The logo and the name on the label, the
 * tagline and the credit printed below it, the founder's one line with the rest of the cast doodled beside him, and
 * one way on. The words are in `story.ts`; this file only draws them.
 */
import { useEffect, useRef } from 'react';
import type { TitlePageProps } from '../contract.ts';
import { CastLine, Erasmus, MsTally, Smudge } from './Characters.tsx';
import { HandArrow } from './ink.tsx';
import { StickyGradeLogo } from './Logo.tsx';
import { NOTEBOOK_STORY, TITLE_PAGE } from './story.ts';

export function TitlePage({ playerTitle, goHref, contentsHref, sound }: TitlePageProps) {
  const go = useRef<HTMLAnchorElement>(null);
  // One keystroke on: the way on has the focus as the page opens, so Enter takes it.
  useEffect(() => go.current?.focus({ preventScroll: true }), []);
  return (
    <main className="title-page">
      <div className="title-page__bar">{sound}</div>
      <section className="cover" aria-labelledby="cover-title">
        <span className="cover__band" aria-hidden />
        <header className="cover__label">
          <h1 id="cover-title" className="cover__title">
            <StickyGradeLogo size={96} />
            <span className="hand cover__name">Five Nines</span>
          </h1>
          <p className="cover__tagline">{TITLE_PAGE.tagline}</p>
        </header>
        <p className="cover__credit">
          <span className="cover__starring">{TITLE_PAGE.starring}</span> <span className="cover__company">{NOTEBOOK_STORY.company}</span>
        </p>
        <div className="cover__cast">
          {/* The rest of the cast, doodled small beside the founder. Decorative: they speak in the pages. */}
          <div className="cover__crowd" aria-hidden>
            <MsTally size={78} />
            <Erasmus size={54} />
          </div>
          <CastLine role="founder" size={132} mood="pleased" className="cover__founder">
            “{TITLE_PAGE.hype}”
          </CastLine>
          <div className="cover__crowd" aria-hidden>
            <Smudge size={52} />
          </div>
        </div>
        <nav className="cover__actions" aria-label="Open the notebook">
          <a ref={go} className="btn btn--primary cover__go" href={goHref}>
            {playerTitle === null ? TITLE_PAGE.start : TITLE_PAGE.continueAs(playerTitle)}
            <HandArrow width={32} />
          </a>
          <a className="btn btn--ghost cover__contents" href={contentsHref}>
            {TITLE_PAGE.contents}
          </a>
        </nav>
      </section>
    </main>
  );
}
