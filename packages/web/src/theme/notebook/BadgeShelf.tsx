import { BADGE_IDS, type BadgeId } from '../../progression/index.ts';
import type { BadgeShelfProps } from '../contract.ts';
import { NOTEBOOK_SCRIPT } from './cast.ts';
import { BadgeSeal } from './ink.tsx';

/** Each badge's mark inside its seal. */
export const BADGE_GLYPHS: Readonly<Record<BadgeId, string>> = {
  rightSized: 'fit',
  nPlusOne: 'N+1',
  pennyPincher: '$',
  fiveNinesClub: '5×9',
  napkinWizard: '≈',
};

/** The badges as stamps on an index card: inked when earned (with where), pencilled outlines with how to earn the rest. */
export function BadgeShelf({ earned, levelLabel }: BadgeShelfProps) {
  const count = BADGE_IDS.filter((id) => earned[id] !== undefined).length;
  return (
    <section className="badge-shelf" aria-labelledby="badge-shelf-title">
      <h2 id="badge-shelf-title" className="hand badge-shelf__title">
        badges <span className="badge-shelf__count num">{count} / {BADGE_IDS.length}</span>
      </h2>
      <ul className="badge-shelf__list">
        {BADGE_IDS.map((id) => {
          const copy = NOTEBOOK_SCRIPT.badges[id];
          const record = earned[id];
          return (
            <li key={id} className="badge-shelf__badge" data-earned={record !== undefined}>
              <BadgeSeal glyph={BADGE_GLYPHS[id]} earned={record !== undefined} size={48} />
              <div className="badge-shelf__text">
                <b className="badge-shelf__name">
                  {copy.name}
                  <span className="visually-hidden">{record ? ', earned' : ', not earned yet'}</span>
                </b>
                <span className="badge-shelf__how">
                  {record ? (record.levelId ? `Earned on ${levelLabel(record.levelId)}.` : 'Earned.') : copy.how}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
