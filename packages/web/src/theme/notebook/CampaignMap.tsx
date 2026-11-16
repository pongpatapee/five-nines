import { isWritten, type Grade, type Level } from '@five-nines/sim';
import type { ReactNode } from 'react';
import { capitalize, GRADE_LABELS } from '../../format.ts';
import { MAX_NINES_PER_LEVEL, ninesForGrade, type ChapterAccess, type LevelAccess } from '../../progression/index.ts';
import { routeHref } from '../../routing.ts';
import type { CampaignMapProps } from '../contract.ts';
import { NOTEBOOK_SCRIPT } from './cast.ts';
import { CastLine } from './Characters.tsx';
import { NinesDots, paint } from './ink.tsx';
import {
  CHAPTER_LABELS,
  chapterLabelWidth,
  FINALE_SLOT,
  LEVEL_SLOTS,
  MAP_SIZE,
  PLANNED_CHAPTER_PAGES,
  TRAIL_SEGMENTS,
  type ChapterWash,
  type XYPoint,
} from './mapLayout.ts';

const WASH: Record<ChapterWash, string> = {
  green: 'var(--wash-green)',
  blue: 'var(--wash-blue)',
  peach: 'var(--wash-peach)',
  pink: 'var(--wash-pink)',
};

/**
 * The contents page as a hand-drawn trail: the written chapters' levels (each a link), then the planned chapters as
 * locked, dashed placeholders. The trail is inked as far as the player has passed, pencilled beyond.
 *
 * The map is drawn for 880 units across. Its frame scrolls sideways when the page is narrower than it can shrink to.
 */
export function CampaignMap({ chapters, levels, best, peeked, nextUp, access, chapterAccess }: CampaignMapProps) {
  const written = chapters.filter(isWritten);
  const planned = chapters.filter((chapter) => !isWritten(chapter));
  return (
    <div className="campaign-map">
      <div className="campaign-map__frame">
        <svg
          className="campaign-map__svg"
          viewBox={`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`}
          role="group"
          aria-label={`Campaign map. ${written.map((chapter, c) => `Chapter ${c + 1}, ${chapter.title}: ${chapter.levelIds.length} pages${chapterLockText(chapterAccess[chapter.id])}.`).join(' ')} Later chapters coming soon.`}
        >
          {written.map((chapter, c) => (
            <ChapterLabel key={chapter.id} layout={CHAPTER_LABELS[c]!} title={chapter.title} lock={chapterAccess[chapter.id]}>
              Ch. {c + 1} · {chapter.title}
            </ChapterLabel>
          ))}

          <g filter="url(#nb-wobble)">
            {TRAIL_SEGMENTS.map((d, i) => {
              // A segment is inked once the page it leaves is passed.
              const inked = i < levels.length - 1 && ninesForGrade(best[levels[i]!.id]) > 0;
              return <path key={i} d={d} className={inked ? 'map-trail map-trail--ink' : 'map-trail'} />;
            })}
          </g>

          <LockedChapters titles={planned.map((chapter) => chapter.title)} firstNumber={written.length + 1} />

          {levels.map((level, i) => (
            <LevelStop
              key={level.id}
              level={level}
              index={i}
              at={LEVEL_SLOTS[i]!}
              grade={best[level.id]}
              peeked={peeked?.[level.id] === true}
              current={i === nextUp}
              access={access[level.id] ?? { kind: 'open' }}
              levelNumberOf={(id) => levels.findIndex((l) => l.id === id) + 1}
            />
          ))}
        </svg>
      </div>

      <CastLine role="mentor" className="campaign-map__mentor" size={74}>
        {NOTEBOOK_SCRIPT.mentorWelcome}
      </CastLine>
    </div>
  );
}

/** ", locked: 4 more nines needed" for the map's description, or nothing for an open chapter. */
function chapterLockText(lock: ChapterAccess | undefined): string {
  return lock?.kind === 'locked' ? `, locked until you hold ${lock.needed} nines (you have ${lock.have})` : '';
}

function ChapterLabel({
  layout,
  title,
  lock,
  children,
}: {
  layout: (typeof CHAPTER_LABELS)[number];
  title: string;
  lock?: ChapterAccess;
  children: ReactNode;
}) {
  const { at, tilt } = layout;
  const width = chapterLabelWidth(title);
  return (
    <g transform={`rotate(${tilt} ${at.x + width / 2} ${at.y + 13})`}>
      <rect x={at.x} y={at.y} width={width} height={26} rx={6} style={{ fill: WASH[layout.wash], opacity: 0.9 }} />
      <text x={at.x + 8} y={at.y + 22} className="map-text map-text--chapter">
        {children}
      </text>
      {lock?.kind === 'locked' && (
        <g aria-hidden>
          <Padlock at={{ x: at.x + width + 14, y: at.y + 8 }} />
          <text x={at.x + width + 26} y={at.y + 19} className="map-text map-text--lock-note">
            needs {lock.needed} nines
          </text>
        </g>
      )}
    </g>
  );
}

/** Why a stop is closed, for its label. */
function lockLabel(access: LevelAccess, levelNumberOf: (levelId: string) => number): string {
  switch (access.kind) {
    case 'open':
      return '';
    case 'previousLevel':
      return ` Locked: pass page ${levelNumberOf(access.levelId)} first.`;
    case 'chapter':
      return ` Locked: the chapter needs ${access.needed} nines, you have ${access.have}.`;
  }
}

function LevelStop({
  level,
  index,
  at,
  grade,
  peeked,
  current,
  access,
  levelNumberOf,
}: {
  level: Level;
  index: number;
  at: XYPoint;
  grade: Grade | undefined;
  /** The solution was seen before passing: a pencil note beside the page. */
  peeked: boolean;
  current: boolean;
  access: LevelAccess;
  levelNumberOf(levelId: string): number;
}) {
  const nines = ninesForGrade(grade);
  const status = grade === undefined ? 'not played yet' : grade === 'fail' ? 'not passed yet' : GRADE_LABELS[grade];
  const r = current ? 32 : 30;
  const locked = access.kind !== 'open';
  if (locked) {
    // Still a link: the page explains what opens it. But it reads as closed on the map.
    return (
      <a
        href={routeHref({ name: 'level', levelId: level.id })}
        className="map-stop map-stop--locked"
        data-grade="locked"
        aria-label={`Page ${index + 1}: ${level.title}. ${level.concept}.${lockLabel(access, levelNumberOf)}${current ? ' You are here.' : ''}`}
      >
        <circle className="map-stop__focus" cx={at.x} cy={at.y} r={r + 8} />
        <circle className="map-locked__page" cx={at.x} cy={at.y} r={r} />
        <text x={at.x} y={at.y + 11} textAnchor="middle" className="map-text map-text--locked-number">
          {index + 1}
        </text>
        <Padlock at={{ x: at.x + r - 6, y: at.y - r - 4 }} />
        <text x={at.x} y={at.y + r + 22} textAnchor="middle" className="map-text map-text--title map-text--locked">
          {level.title}
        </text>
        {current && (
          <text x={at.x} y={at.y + r + 42} textAnchor="middle" className="map-text map-text--pen map-text--small">
            next, once it opens
          </text>
        )}
      </a>
    );
  }
  return (
    <a
      href={routeHref({ name: 'level', levelId: level.id })}
      className="map-stop"
      data-grade={grade ?? 'unplayed'}
      aria-label={`Page ${index + 1}: ${level.title}. ${level.concept}. ${status}, ${nines} of ${MAX_NINES_PER_LEVEL} nines.${peeked ? ` ${capitalize(NOTEBOOK_SCRIPT.giveUp.peekedNote)}.` : ''}${current ? ' You are here.' : ''}`}
    >
      {current && (
        <path
          d={`M${at.x - 42},${at.y - 30} C${at.x - 28},${at.y - 52} ${at.x + 26},${at.y - 56} ${at.x + 42},${at.y - 34} C${at.x + 58},${at.y - 12} ${at.x + 50},${at.y + 34} ${at.x + 18},${at.y + 42} C${at.x - 16},${at.y + 50} ${at.x - 50},${at.y + 34} ${at.x - 52},${at.y + 8} C${at.x - 54},${at.y - 8} ${at.x - 50},${at.y - 20} ${at.x - 42},${at.y - 30} Z`}
          style={{ fill: 'var(--highlighter)', opacity: 0.85 }}
        />
      )}
      <circle className="map-stop__focus" cx={at.x} cy={at.y} r={r + 8} />
      <g filter="url(#nb-wobble)">
        <circle className="map-stop__disc" cx={at.x} cy={at.y} r={r} />
      </g>
      {current && (
        <path
          className="ink-draw map-stop__pen"
          pathLength={1}
          d={`M${at.x},${at.y - r - 12} C${at.x + 30},${at.y - r - 14} ${at.x + r + 13},${at.y - 24} ${at.x + r + 13},${at.y} C${at.x + r + 12},${at.y + 26} ${at.x + 24},${at.y + r + 12} ${at.x - 2},${at.y + r + 12} C${at.x - 30},${at.y + r + 12} ${at.x - r - 13},${at.y + 24} ${at.x - r - 12},${at.y - 2} C${at.x - r - 11},${at.y - 26} ${at.x - 24},${at.y - r - 9} ${at.x + 4},${at.y - r - 9}`}
          style={paint(null, 'var(--red-pen)', 3)}
          strokeLinecap="round"
        />
      )}
      <text x={at.x} y={at.y + 11} textAnchor="middle" className="map-text map-text--number">
        {index + 1}
      </text>
      <text x={at.x} y={at.y + r + 22} textAnchor="middle" className="map-text map-text--title">
        {level.title}
      </text>
      <NinesDots filled={nines} total={MAX_NINES_PER_LEVEL} size="sm" x={at.x - 47} y={at.y + r + 32} />
      <GradeMark grade={grade} at={at} />
      {peeked && <PeekMark at={at} r={r} />}
      {current && (
        <g className="map-stop__here">
          <path
            d={`M${at.x - 2},${at.y + r + 82} C${at.x - 4},${at.y + r + 72} ${at.x + 1},${at.y + r + 64} ${at.x},${at.y + r + 56} M${at.x - 7},${at.y + r + 63} L${at.x},${at.y + r + 55} L${at.x + 6},${at.y + r + 63}`}
            style={paint(null, 'var(--red-pen)', 2.6)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text x={at.x} y={at.y + r + 104} textAnchor="middle" className="map-text map-text--pen">
            you are here
          </text>
        </g>
      )}
    </a>
  );
}

/** A pencil note beside a page whose solution was seen before passing: it pays at most a pass. Decorative (the link says it). */
function PeekMark({ at, r }: { at: XYPoint; r: number }) {
  const x = at.x - r - 10;
  const y = at.y - r + 2;
  return (
    <g aria-hidden>
      <path
        d={`M${x - 6},${y + 4} l14,-14 l4,4 l-14,14 z M${x - 6},${y + 4} l-3,7 l7,-3`}
        style={paint(null, 'var(--pencil)', 1.6)}
        strokeLinejoin="round"
      />
      <text x={x - 12} y={y + 2} textAnchor="end" className="map-text map-text--peek" transform={`rotate(-6 ${x - 12} ${y + 2})`}>
        peeked
      </text>
    </g>
  );
}

/** The teacher's mark beside a played page. */
function GradeMark({ grade, at }: { grade: Grade | undefined; at: XYPoint }) {
  const x = at.x + 22;
  const y = at.y - 32;
  switch (grade) {
    case 'mastered':
      return (
        <g>
          <path d={`M${x},${y} L${x + 8},${y + 10} L${x + 26},${y - 14}`} style={paint(null, 'var(--red-pen)', 3)} strokeLinecap="round" strokeLinejoin="round" />
          <text x={x + 30} y={y - 6} className="map-text map-text--pen map-text--small" transform={`rotate(-8 ${x + 30} ${y - 6})`}>
            mastered!
          </text>
        </g>
      );
    case 'star':
      return (
        <path
          transform={`translate(${x + 12},${y - 6})`}
          d="M0,-18 L5,-6 L18,-5 L8,3 L12,16 L0,8 L-11,16 L-8,3 L-18,-5 L-5,-6 Z"
          style={paint('var(--star-gold)', 'var(--ink)', 2)}
          strokeLinejoin="round"
        />
      );
    case 'pass':
      return <path d={`M${x},${y} L${x + 8},${y + 10} L${x + 26},${y - 14}`} style={paint(null, 'var(--green-pen)', 3)} strokeLinecap="round" strokeLinejoin="round" />;
    case 'fail':
      return (
        <text x={x + 4} y={y} className="map-text map-text--pen map-text--small" transform={`rotate(-8 ${x + 4} ${y})`}>
          try again
        </text>
      );
    default:
      return null;
  }
}

/** Chapters not written yet: dashed placeholder pages with padlocks. Nothing here is interactive. */
function LockedChapters({ titles, firstNumber }: { titles: readonly string[]; firstNumber: number }) {
  return (
    <g className="map-locked" aria-hidden>
      {titles.map((title, c) => {
        const layout = PLANNED_CHAPTER_PAGES[c]!;
        return (
          <g key={title}>
            <ChapterLabel layout={CHAPTER_LABELS[firstNumber - 1 + c]!} title={title}>
              Ch. {firstNumber + c} · {title}
            </ChapterLabel>
            <text x={layout.note.x} y={layout.note.y} className="map-text map-text--locked">
              coming soon
            </text>
            {layout.pages.map((page, p) => (
              <g key={p}>
                <circle cx={page.x} cy={page.y} r={26} className="map-locked__page" />
                <text x={page.x} y={page.y + 9} textAnchor="middle" className="map-text map-text--locked-number">
                  ?
                </text>
                <Padlock at={{ x: page.x + 18, y: page.y - 28 }} />
              </g>
            ))}
          </g>
        );
      })}
      <path
        transform={`translate(${FINALE_SLOT.x},${FINALE_SLOT.y})`}
        d="M0,-54 L12,-32 L36,-40 L32,-16 L56,-6 L36,10 L50,32 L24,32 L18,56 L0,40 L-18,56 L-24,32 L-50,32 L-36,10 L-56,-6 L-32,-16 L-36,-40 L-12,-32 Z"
        className="map-locked__page"
        strokeLinejoin="round"
      />
      <text x={FINALE_SLOT.x} y={FINALE_SLOT.y + 10} textAnchor="middle" className="map-text map-text--locked-number">
        ?
      </text>
      <Padlock at={{ x: FINALE_SLOT.x + 40, y: FINALE_SLOT.y - 50 }} />
      <text x={FINALE_SLOT.x} y={FINALE_SLOT.y + 84} textAnchor="middle" className="map-text map-text--locked map-text--bold">
        The finale
      </text>
      <text x={FINALE_SLOT.x} y={FINALE_SLOT.y + 104} textAnchor="middle" className="map-text map-text--locked">
        ({NOTEBOOK_SCRIPT.members.boss.name} grades it)
      </text>
    </g>
  );
}

function Padlock({ at }: { at: XYPoint }) {
  return (
    <g transform={`translate(${at.x},${at.y})`}>
      <path d="M-4,0 V-4 A4,4 0 0 1 4,-4 V0" style={paint(null, 'var(--pencil)', 1.8)} />
      <rect x={-6} y={0} width={12} height={9} rx={1.5} style={paint('var(--paper)', 'var(--pencil)', 1.8)} />
    </g>
  );
}
