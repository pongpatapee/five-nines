/**
 * The engineer's notebook: graph paper, ink doodles, red pen and a cast of stationery (docs/design.md, "Art
 * direction"). Everything style-specific lives in this folder: art, copy, and the stylesheets, whose raw colours are
 * all in `styles/tokens.css`.
 */
import type { Theme } from '../contract.ts';
import { BudgetMeter } from './BudgetMeter.tsx';
import { CampaignMap } from './CampaignMap.tsx';
import { NOTEBOOK_SCRIPT } from './cast.ts';
import { CastLine } from './Characters.tsx';
import { ComponentDoodle } from './doodles.tsx';
import { GradeCard } from './GradeCard.tsx';
import { Cross, HandArrow, HandBox, NinesDots, RootCauseCircle, Tick } from './ink.tsx';
import { PostmortemCard } from './PostmortemCard.tsx';
import { Shell } from './Shell.tsx';
// In cascade order: later sheets override earlier ones at equal specificity.
import './styles/tokens.css';
import './styles/global.css';
import './styles/canvas.css';
import './styles/notebook.css';
import './styles/editor.css';
import './styles/playback.css';
import './styles/results.css';
import './styles/screens.css';

export const notebookTheme: Theme = {
  Shell,
  cast: NOTEBOOK_SCRIPT,
  CastLine,
  words: {
    level: 'page',
    levelShort: (levelNumber) => `p.${levelNumber}`,
    home: 'contents',
    homeLong: 'table of contents',
    tagline: "an engineer's field notebook",
  },
  ComponentArt: ComponentDoodle,
  BudgetMeter,
  PostmortemCard,
  GradeCard,
  CampaignMap,
  marks: {
    Arrow: HandArrow,
    Checkbox: HandBox,
    Met: Tick,
    NotMet: Cross,
    Nines: NinesDots,
    RootCause: RootCauseCircle,
  },
};
