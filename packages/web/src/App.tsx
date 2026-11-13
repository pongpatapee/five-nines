import { getLevel } from '@five-nines/sim';
import { LevelScreen } from './screens/LevelScreen.tsx';
import { LevelSelect } from './screens/LevelSelect.tsx';
import { NotFound } from './screens/NotFound.tsx';
import { Shell } from './theme/index.ts';
import { useRoute } from './routing.ts';

export function App() {
  return (
    <Shell>
      <Screen />
    </Shell>
  );
}

function Screen() {
  const route = useRoute();
  if (route.name === 'levels') return <LevelSelect />;
  const level = getLevel(route.levelId);
  if (!level) return <NotFound levelId={route.levelId} />;
  // Keyed so every level starts from a fresh mode state.
  return <LevelScreen key={level.id} level={level} />;
}
