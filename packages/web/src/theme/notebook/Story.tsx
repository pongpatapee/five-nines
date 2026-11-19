/**
 * The story on the page: a scene (stage directions, lines, Doug's stamp, Erasmus's margin note), the all-hands page a
 * chapter opens with, and the memo taped above each briefing. The words are in `story.ts`; this file only draws them.
 */
import { useEffect, useRef } from 'react';
import type { AllHandsProps, LevelMemoProps, SceneBeat } from '../contract.ts';
import { NOTEBOOK_SCRIPT } from './cast.ts';
import { CastLine } from './Characters.tsx';
import { HandArrow } from './ink.tsx';
import { NOTEBOOK_STORY } from './story.ts';

/** A scene's beats, in order. `size` scales the cast figures. */
export function Scene({ beats, size = 'md' }: { beats: readonly SceneBeat[]; size?: 'sm' | 'md' }) {
  return (
    <div className="scene" data-size={size}>
      {beats.map((beat, i) => (
        <SceneBeatView key={i} beat={beat} size={size} />
      ))}
    </div>
  );
}

function SceneBeatView({ beat, size }: { beat: SceneBeat; size: 'sm' | 'md' }) {
  switch (beat.kind) {
    case 'stage':
      return <p className="scene__stage">{beat.text}</p>;
    case 'line':
      return (
        <CastLine role={beat.role} size={size === 'sm' ? 64 : 92} mood="pleased" className="scene__line">
          “{beat.text}”
        </CastLine>
      );
    case 'stamp':
      return (
        <p className="scene__stamp">
          {/* Several names ("A · B · C") stamp one to a line, so none breaks in two. */}
          <span className="scene__stamp-ink">
            {beat.text.split(' · ').map((name, i) => (
              <span key={i} className="scene__stamp-line">
                {i > 0 && <span className="visually-hidden"> · </span>}
                {name}
              </span>
            ))}
          </span>
        </p>
      );
    case 'margin':
      return (
        <p className="scene__margin">
          <span className="visually-hidden">{NOTEBOOK_SCRIPT.members.mentor.name}, in the margin: </span>
          {beat.text}
        </p>
      );
  }
}

/** A chapter's all-hands, on a page of its own: the founder unveils the product, then on to the work. */
export function AllHands({ scene, chapterNumber, chapterTitle, continueLabel, onContinue, backHref }: AllHandsProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The page replaces another: land keyboard and screen-reader players on its heading.
  useEffect(() => heading.current?.focus(), []);
  return (
    <main className="all-hands">
      <header className="all-hands__head">
        <p className="eyebrow">
          {NOTEBOOK_STORY.company} · all-hands · the Amphitheater
        </p>
        <h1 ref={heading} tabIndex={-1} className="hand all-hands__title">
          Ch. {chapterNumber} · {chapterTitle}
        </h1>
        <p className="all-hands__product">
          Now unveiling: <span className="highlight">{scene.product}</span>
        </p>
      </header>
      <Scene beats={scene.beats} />
      <footer className="all-hands__actions">
        <button type="button" className="btn btn--primary" onClick={onContinue}>
          {continueLabel}
          <HandArrow width={30} />
        </button>
        <a className="btn" href={backHref}>
          Back to the contents
        </a>
      </footer>
    </main>
  );
}

/** The memo taped above a briefing: the founder's hype, Erasmus's translation in the margin, a coworker's sticky. */
export function LevelMemoNote({ memo }: LevelMemoProps) {
  const founder = NOTEBOOK_SCRIPT.members.founder.name;
  return (
    <section className="memo" aria-label={`Memo from ${founder}`}>
      <span className="tape tape--left" aria-hidden />
      <p className="memo__from">Memo · from the desk of {founder}</p>
      <CastLine role="founder" size={64} className="memo__hype">
        “{memo.hype}”
      </CastLine>
      <p className="memo__translation">
        <span className="memo__translation-lead">{NOTEBOOK_SCRIPT.members.mentor.name}, in the margin:</span> {memo.translation}
      </p>
      {memo.sticky && (
        <aside className="memo__sticky" aria-label={`Sticky note from ${memo.sticky.from}`}>
          <p className="memo__sticky-text">{memo.sticky.text}</p>
          <p className="memo__sticky-from">—{memo.sticky.from}</p>
        </aside>
      )}
    </section>
  );
}
