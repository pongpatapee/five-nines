/**
 * The cast, drawn in ink. All three are decorative (`aria-hidden`); wherever they speak, `CastLine` names them in
 * text, so nothing depends on seeing the drawing.
 *
 * Ink strokes use `currentColor` (set to --ink by `.cast-figure`), material colours come from tokens.
 */
import type { ReactNode } from 'react';
import { CAST, type CastMember } from './cast.ts';
import { paint } from './ink.tsx';

const INK = 'currentColor';

export type TallyMood = 'stern' | 'unimpressed' | 'pleased';

/** Ms. Tally, the budget boss: a pencil with a tally-marked body, spectacles, a red tie and a receipt. */
export function MsTally({ mood = 'stern', size = 120 }: { mood?: TallyMood; size?: number }) {
  const mouth =
    mood === 'pleased' ? 'M-1,-31 Q5,-26 11,-31' : mood === 'unimpressed' ? 'M-1,-28 Q5,-33 11,-28' : 'M-1,-30 L10,-31';
  return (
    <svg className="cast-figure" width={(size * 100) / 196} height={size} viewBox="0 0 100 196" aria-hidden>
      <g transform="translate(46,92) rotate(-4)">
        <rect x="-18" y="-72" width="36" height="140" rx="3" style={paint('var(--cast-pencil-wood)', INK, 2.4)} />
        <path d="M-18,-72 L0,-92 L18,-72 Z" style={paint('var(--paper-shade)', INK, 2.2)} strokeLinejoin="round" />
        <path d="M-5,-86 L0,-92 L5,-86 Z" style={paint(INK)} />
        <path
          d="M-18,-60 h8 M-18,-52 h5 M-18,-44 h8 M-18,-36 h5 M-18,-28 h8 M-18,-20 h5 M-18,-12 h8 M-18,-4 h5 M-18,4 h8 M-18,12 h5 M-18,20 h8 M-18,28 h5 M-18,36 h8 M-18,44 h5 M-18,52 h8 M-18,60 h5"
          style={paint(null, INK, 1.3)}
        />
        <circle cx="-3" cy="-46" r="7" style={paint('var(--paper-card)', INK, 1.8)} />
        <circle cx="12" cy="-46" r="7" style={paint('var(--paper-card)', INK, 1.8)} />
        <path d="M4,-46 L5,-46" style={paint(null, INK, 1.8)} />
        <circle cx={mood === 'unimpressed' ? -1 : -2} cy="-45" r="2" style={paint(INK)} />
        <circle cx={mood === 'unimpressed' ? 14 : 11} cy="-45" r="2" style={paint(INK)} />
        <path
          d={mood === 'pleased' ? 'M-10,-57 Q-4,-60 2,-56 M8,-56 Q14,-60 19,-57' : 'M-10,-58 L2,-54 M19,-58 L8,-54'}
          style={paint(null, INK, 2.4)}
          strokeLinecap="round"
        />
        <path d={mouth} style={paint(null, INK, 2)} strokeLinecap="round" />
        <path d="M1,-20 L9,-20 L7,-14 L10,6 L5,12 L0,6 L3,-14 Z" style={paint('var(--red-pen)', INK, 1.4)} strokeLinejoin="round" />
        <path d="M18,-8 L36,6" style={paint(null, INK, 2.2)} strokeLinecap="round" />
        <path d="M-18,-6 L-30,14" style={paint(null, INK, 2.2)} strokeLinecap="round" />
        <g transform="rotate(8 38 17)">
          <rect x="26" y="2" width="24" height="30" rx="2" style={paint('var(--paper-card)', INK, 1.8)} />
          <text x="38" y="23" textAnchor="middle" className="cast-figure__glyph" style={{ fill: 'currentColor' }}>
            $
          </text>
        </g>
        <path d="M-8,68 L-10,84 M8,68 L10,84" style={paint(null, INK, 2.2)} strokeLinecap="round" />
      </g>
    </svg>
  );
}

export type ErasmusMood = 'calm' | 'leaning';

/** Erasmus, the mentor: a pink-and-blue eraser with round glasses and a moustache. */
export function Erasmus({ mood = 'calm', size = 96 }: { mood?: ErasmusMood; size?: number }) {
  return (
    <svg className="cast-figure" width={size} height={(size * 112) / 110} viewBox="-50 -48 110 112" aria-hidden>
      <g transform="rotate(-5)">
        <path
          d="M-34,-20 Q-30,-36 -12,-36 L28,-32 Q38,-30 38,-18 L36,34 Q36,40 30,40 L-30,40 Q-36,40 -36,34 Z"
          style={paint('var(--cast-eraser-pink)', INK, 2.4)}
          strokeLinejoin="round"
        />
        <path
          d="M-36,16 L37,16 L36,34 Q36,40 30,40 L-30,40 Q-36,40 -36,34 Z"
          style={paint('var(--cast-eraser-blue)', INK, 2.4)}
          strokeLinejoin="round"
        />
        <circle cx="-11" cy="-12" r="8" style={{ ...paint('var(--paper-card)', INK, 1.8), fillOpacity: 0.45 }} />
        <circle cx="11" cy="-12" r="8" style={{ ...paint('var(--paper-card)', INK, 1.8), fillOpacity: 0.45 }} />
        <path d="M-3,-12 L3,-12" style={paint(null, INK, 1.8)} />
        {mood === 'calm' ? (
          <path d="M-15,-11 Q-11,-15 -7,-11 M7,-11 Q11,-15 15,-11" style={paint(null, INK, 1.8)} strokeLinecap="round" />
        ) : (
          <>
            <circle cx="-9" cy="-11" r="2.2" style={paint(INK)} />
            <circle cx="13" cy="-11" r="2.2" style={paint(INK)} />
          </>
        )}
        <path d="M-18,-24 Q-11,-28 -4,-24 M4,-24 Q11,-28 18,-24" style={paint(null, INK, 2.6)} strokeLinecap="round" />
        <path d="M-14,4 Q-7,-4 0,3 Q7,-4 14,4 Q7,10 0,6 Q-7,10 -14,4 Z" style={paint('var(--paper-card)', INK, 1.6)} />
        <path d="M37,-2 L52,-20" style={paint(null, INK, 2.4)} strokeLinecap="round" />
        <circle cx="54" cy="-22" r="3.5" style={paint('var(--cast-eraser-pink)', INK, 1.6)} />
        <path
          d="M-26,52 Q-20,48 -16,54 M-6,54 Q-2,48 4,52"
          style={paint(null, 'var(--cast-eraser-shadow)', 2)}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/** Smudge, the troublemaker: an ink blot with a drip, mischievous eyes and a toothy grin. Optionally holding a plug. */
export function Smudge({ size = 90, holdingPlug = false }: { size?: number; holdingPlug?: boolean }) {
  return (
    <svg className="cast-figure cast-figure--smudge" width={size} height={size} viewBox="-56 -44 112 108" aria-hidden>
      <g className="smudge-bob">
        <path
          d="M0,-34 C16,-38 28,-26 30,-12 C40,-6 40,8 32,14 C34,26 22,34 8,32 C2,42 -10,40 -14,32 C-30,34 -38,22 -32,8 C-42,0 -38,-16 -26,-20 C-24,-32 -12,-36 0,-34 Z"
          style={paint(INK)}
        />
        <path d="M-6,32 C-7,40 -4,46 -6,52" style={paint(null, INK, 5)} strokeLinecap="round" />
        <circle cx="-6" cy="55" r="4" style={paint(INK)} />
        <path d="M16,30 C16,36 18,40 16,44" style={paint(null, INK, 4)} strokeLinecap="round" />
        <circle cx="-10" cy="-8" r="8" style={paint('var(--paper-card)')} />
        <circle cx="11" cy="-10" r="9" style={paint('var(--paper-card)')} />
        <circle cx="-7" cy="-6" r="3.5" style={paint(INK)} />
        <circle cx="14" cy="-8" r="4" style={paint(INK)} />
        <path d="M-18,-20 L-4,-15 M20,-22 L6,-17" style={paint(null, 'var(--paper-card)', 2.4)} strokeLinecap="round" />
        <path d="M-14,8 Q2,22 18,6" style={paint('var(--paper-card)', 'var(--paper-card)', 2)} />
        <path d="M-6,12 L-5,17 M4,14 L4,19 M12,11 L11,15" style={paint(null, INK, 1.6)} />
        <path d="M-32,4 L-46,-6" style={paint(null, INK, 3)} strokeLinecap="round" />
        {holdingPlug ? (
          <g>
            <path d="M30,12 L42,2" style={paint(null, INK, 3)} strokeLinecap="round" />
            <rect x="40" y="-12" width="12" height="13" rx="2" style={paint(INK)} />
            <path d="M43,-12 L43,-19 M49,-12 L49,-19" style={paint(null, INK, 2)} strokeLinecap="round" />
            <path d="M46,1 C48,14 40,22 30,26" style={paint(null, INK, 2.2)} strokeLinecap="round" />
          </g>
        ) : (
          <path d="M30,12 L44,4" style={paint(null, INK, 3)} strokeLinecap="round" />
        )}
        <circle cx="-48" cy="20" r="2.5" style={paint(INK)} />
        <circle cx="40" cy="30" r="2" style={paint(INK)} />
      </g>
    </svg>
  );
}

export interface CastLineProps {
  who: CastMember;
  children: ReactNode;
  /** A hand-lettered lead-in above the line, e.g. "Erasmus leans in:" or "99.70%?!". */
  lead?: ReactNode;
  /** Figure size in px (height for Ms. Tally, width for the others). */
  figureSize?: number;
  /** Visual pose for the figure. */
  tallyMood?: TallyMood;
  erasmusMood?: ErasmusMood;
  smudgeHoldingPlug?: boolean;
  /** `alarm` draws the lead-in in red pen. */
  tone?: 'note' | 'alarm';
  className?: string;
}

/** A character with a speech bubble. The caption under the figure names them, so screen readers get the speaker. */
export function CastLine({
  who,
  children,
  lead,
  figureSize,
  tallyMood,
  erasmusMood,
  smudgeHoldingPlug,
  tone = 'note',
  className,
}: CastLineProps) {
  const member = CAST[who];
  return (
    <figure className={`cast-line cast-line--${who}${className ? ` ${className}` : ''}`} data-tone={tone}>
      <div className="cast-line__figure">
        {who === 'boss' && <MsTally mood={tallyMood} size={figureSize ?? 110} />}
        {who === 'mentor' && <Erasmus mood={erasmusMood} size={figureSize ?? 78} />}
        {who === 'troublemaker' && <Smudge size={figureSize ?? 72} holdingPlug={smudgeHoldingPlug} />}
        <figcaption className="cast-line__name">
          {member.name}
          <span className="visually-hidden">, </span>
          <span className="cast-line__role">{member.role}</span>
        </figcaption>
      </div>
      <blockquote className="cast-line__bubble">
        {lead && <div className="cast-line__lead">{lead}</div>}
        <div className="cast-line__text">{children}</div>
      </blockquote>
    </figure>
  );
}
