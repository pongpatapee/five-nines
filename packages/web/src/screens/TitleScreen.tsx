import { CHAPTERS } from '@five-nines/sim';
import { SoundToggle } from '../audio/SoundToggle.tsx';
import { navigate, routeHref, type Route } from '../routing.ts';
import { useBestGrades, useProgress } from '../state/index.ts';
import { TitlePage } from '../theme/index.ts';
import { hasStarted, playerTitle } from './campaign.ts';
import { useWayOnKeys } from './wayOn.ts';

/**
 * The root: the title page the game opens on. A new player starts at chapter 1's first level, whose all-hands opens
 * first by itself (`LevelGate` in App.tsx), so there is one way into the story. Anyone who has begun continues to the
 * contents. Enter takes the way on.
 */
export function TitleScreen() {
  const best = useBestGrades();
  const seenAllHands = useProgress((state) => state.seenAllHands);
  const started = hasStarted(best, seenAllHands);
  const way: Route = started ? { name: 'levels' } : { name: 'level', levelId: CHAPTERS[0]!.levelIds[0]! };
  useWayOnKeys(() => navigate(way), { escape: false });
  return (
    <TitlePage
      playerTitle={started ? playerTitle(best) : null}
      goHref={routeHref(way)}
      contentsHref={routeHref({ name: 'levels' })}
      sound={<SoundToggle />}
    />
  );
}
