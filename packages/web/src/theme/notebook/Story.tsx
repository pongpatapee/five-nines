/**
 * The story on the page: a scene (stage directions, lines, Doug's stamp, Erasmus's margin note), the all-hands panel a
 * chapter opens with, and the briefing card atop each level. The words are in `story.ts`; this file only draws them.
 */
import { useEffect, useRef } from 'react';
import type { AllHandsProps, BriefingCardProps, SceneBeat } from '../contract.ts';
import { NOTEBOOK_SCRIPT } from './cast.ts';
import { CastLine, ChadVisionary } from './Characters.tsx';
import { HandArrow } from './ink.tsx';
import { NumbersCard } from './NumbersCard.tsx';
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

/**
 * A chapter's all-hands, as one panel read in seconds: the founder's doodle, Doug's stamp and the founder's lines as
 * speech bubbles, and a big way on. Stage directions and margin notes, where a scene has them, sit small among them.
 */
export function AllHands({ scene, chapterNumber, chapterTitle, continueLabel, onContinue, backHref }: AllHandsProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The page replaces another: land keyboard and screen-reader players on its heading.
  useEffect(() => heading.current?.focus(), []);
  const founder = NOTEBOOK_SCRIPT.members.founder;
  return (
    <main className="all-hands">
      <header className="all-hands__head">
        <p className="eyebrow">{NOTEBOOK_STORY.company} · all-hands</p>
        <h1 ref={heading} tabIndex={-1} className="hand all-hands__title">
          Ch. {chapterNumber} · {chapterTitle}
        </h1>
      </header>
      <section className="all-hands__panel" aria-label={`${founder.name} unveils ${scene.product}`}>
        <figure className="all-hands__founder">
          <ChadVisionary size={190} />
          <figcaption className="cast-line__name">
            {founder.name}
            <span className="visually-hidden">, </span>
            <span className="cast-line__role">{founder.title}</span>
          </figcaption>
        </figure>
        <div className="all-hands__talk">
          {scene.beats.map((beat, i) => (
            <PanelBeat key={i} beat={beat} />
          ))}
        </div>
      </section>
      <footer className="all-hands__actions">
        <button type="button" className="btn btn--primary all-hands__go" onClick={onContinue}>
          <span className="all-hands__go-word">{NOTEBOOK_STORY.words.go}</span>
          <HandArrow width={36} />
          <span className="all-hands__go-to">{continueLabel}</span>
        </button>
        <a className="btn btn--ghost" href={backHref}>
          Back to the contents
        </a>
        <p className="all-hands__keys">
          <kbd>Enter</kbd> or <kbd>Esc</kbd> to skip
        </p>
      </footer>
    </main>
  );
}

/** One beat on the all-hands panel: the founder's lines are bubbles; anything else is drawn as in a scene, small. */
function PanelBeat({ beat }: { beat: SceneBeat }) {
  if (beat.kind === 'line' && beat.role === 'founder') {
    return (
      <blockquote className="all-hands__bubble">
        <span className="visually-hidden">{NOTEBOOK_SCRIPT.members.founder.name}: </span>
        {beat.text}
      </blockquote>
    );
  }
  return (
    <div className="all-hands__aside" data-kind={beat.kind}>
      <SceneBeatView beat={beat} size="sm" />
    </div>
  );
}

/**
 * The briefing card: the founder's line, the goal, Erasmus's one margin line, the numbers drawn, the opt-in napkin
 * challenge, and everything else behind "more". A level without a goal line keeps "more" open, so its longer briefing
 * stays in view.
 */
export function BriefingCard({ memo, numbers, traffic, challenge, more }: BriefingCardProps) {
  const words = NOTEBOOK_STORY.words;
  return (
    <section className="brief-card" aria-label="Briefing">
      {memo && (
        <>
          <CastLine role="founder" size={56} className="brief-card__hype">
            “{memo.hype}”
          </CastLine>
          {memo.goal && (
            <p className="brief-card__goal">
              <b className="brief-card__goal-label">{words.goal}:</b> {memo.goal}
            </p>
          )}
          <p className="brief-card__margin">
            <span className="visually-hidden">{NOTEBOOK_SCRIPT.members.mentor.name}, in the margin: </span>
            {memo.translation} <span aria-hidden>—E.</span>
          </p>
        </>
      )}
      <NumbersCard numbers={numbers} traffic={traffic} />
      {challenge}
      <details className="brief-card__more" open={!memo?.goal}>
        <summary className="brief-card__more-toggle">{words.more}</summary>
        <div className="brief-card__more-body">
          {memo?.sticky && (
            <aside className="memo__sticky" aria-label={`Sticky note from ${memo.sticky.from}`}>
              <p className="memo__sticky-text">{memo.sticky.text}</p>
              <p className="memo__sticky-from">—{memo.sticky.from}</p>
            </aside>
          )}
          {more}
        </div>
      </details>
    </section>
  );
}
