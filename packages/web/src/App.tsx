import { getLevel, type Level } from '@five-nines/sim';
import { useEffect, useRef } from 'react';
import { playCue } from './audio/sfx.ts';
import { useLevelAccess } from './screens/campaign.ts';
import { LevelScreen } from './screens/LevelScreen.tsx';
import { LevelSelect } from './screens/LevelSelect.tsx';
import { LockedLevel } from './screens/LockedLevel.tsx';
import { NotFound } from './screens/NotFound.tsx';
import { Shell } from './theme/index.ts';
import { routeHref, useRoute } from './routing.ts';

export function App() {
  return (
    <Shell>
      <Screen />
    </Shell>
  );
}

function Screen() {
  const route = useRoute();
  usePageTurn(routeHref(route));
  if (route.name === 'levels') return <LevelSelect />;
  const level = getLevel(route.levelId);
  if (!level) return <NotFound levelId={route.levelId} />;
  // Keyed so every level starts from a fresh mode state.
  return <LevelGate key={level.id} level={level} />;
}

/** A level opens only once the player has earned it (`progression/unlocks.ts`). */
function LevelGate({ level }: { level: Level }) {
  const access = useLevelAccess(level.id);
  if (access.kind !== 'open') return <LockedLevel level={level} access={access} />;
  return <LevelScreen level={level} />;
}

/** The page-turn sound when the player moves between screens (not on the first load). */
function usePageTurn(page: string) {
  const previous = useRef(page);
  useEffect(() => {
    if (previous.current === page) return;
    previous.current = page;
    playCue('navigate');
  }, [page]);
}
