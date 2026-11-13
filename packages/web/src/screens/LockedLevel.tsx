import { CHAPTERS, LEVELS, type Level } from '@five-nines/sim';
import type { LevelAccess } from '../progression/index.ts';
import { routeHref } from '../routing.ts';
import { cast, CastLine, lockSituation, marks, words } from '../theme/index.ts';

/** A level the player hasn't opened yet: what opens it, said by the cast, and the way back. */
export function LockedLevel({ level, access }: { level: Level; access: Exclude<LevelAccess, { kind: 'open' }> }) {
  const index = LEVELS.findIndex((l) => l.id === level.id);
  const { role, line } = cast.lockedLevel(lockSituation(access, LEVELS, CHAPTERS)!);
  const previous = access.kind === 'previousLevel' ? access.levelId : null;
  return (
    <main className="locked-level">
      <h1 className="hand locked-level__title">
        {words.levelShort(index + 1)} · {level.title}
      </h1>
      <p className="locked-level__concept muted">{level.concept}</p>
      <CastLine role={role} size={88} tone="alarm" lead="Locked" className="locked-level__line">
        {line}
      </CastLine>
      <div className="locked-level__actions">
        {previous && (
          <a className="btn btn--primary" href={routeHref({ name: 'level', levelId: previous })}>
            Go to {words.levelShort(LEVELS.findIndex((l) => l.id === previous) + 1)}
            <marks.Arrow width={30} />
          </a>
        )}
        <a className="btn" href={routeHref({ name: 'levels' })}>
          Back to the {words.homeLong}
        </a>
      </div>
    </main>
  );
}
