import { CHAPTERS, getLevel, type Level } from '@five-nines/sim';
import { useEffect, useRef, useState } from 'react';
import { playCue } from './audio/sfx.ts';
import { AllHandsScreen, allHandsNextLevel, chapterOf } from './screens/AllHandsScreen.tsx';
import { useLevelAccess } from './screens/campaign.ts';
import { LevelScreen } from './screens/LevelScreen.tsx';
import { LevelSelect } from './screens/LevelSelect.tsx';
import { LockedLevel } from './screens/LockedLevel.tsx';
import { NotFound } from './screens/NotFound.tsx';
import { TitleScreen } from './screens/TitleScreen.tsx';
import { progressStore, useBestGrades } from './state/index.ts';
import { Shell, story } from './theme/index.ts';
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
  switch (route.name) {
    case 'title':
      return <TitleScreen />;
    case 'levels':
      return <LevelSelect />;
    case 'allHands':
      return <AllHandsRoute key={route.chapterId} chapterId={route.chapterId} />;
    case 'level': {
      const level = getLevel(route.levelId);
      if (!level) return <NotFound id={route.levelId} />;
      // Keyed so every level starts from a fresh mode state.
      return <LevelGate key={level.id} level={level} />;
    }
  }
}

/**
 * A level opens only once the player has earned it (`progression/unlocks.ts`). The first time the player opens a
 * level in a chapter, the chapter's all-hands comes first.
 */
function LevelGate({ level }: { level: Level }) {
  const access = useLevelAccess(level.id);
  const chapter = chapterOf(level.id);
  const scene = chapter ? story.allHands(chapter.id) : null;
  // Decided once, as the level opens: the all-hands marks itself seen as it shows, and stays until the player moves on.
  const [intro, setIntro] = useState(() => chapter !== undefined && scene !== null && !progressStore.getState().seenAllHands[chapter.id]);
  if (access.kind !== 'open') return <LockedLevel level={level} access={access} />;
  if (intro && chapter && scene) {
    return <AllHandsScreen chapter={chapter} scene={scene} next={level} onContinue={() => setIntro(false)} />;
  }
  return <LevelScreen level={level} />;
}

/** `#/all-hands/<chapter id>`: a chapter's all-hands again, from the contents page. */
function AllHandsRoute({ chapterId }: { chapterId: string }) {
  const best = useBestGrades();
  const chapter = CHAPTERS.find((c) => c.id === chapterId);
  const scene = chapter ? story.allHands(chapter.id) : null;
  const next = chapter ? allHandsNextLevel(chapter, best) : undefined;
  if (!chapter || !scene || !next) return <NotFound id={chapterId} kind="chapter" />;
  return <AllHandsScreen chapter={chapter} scene={scene} next={next} />;
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
