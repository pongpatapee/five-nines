import { CHAPTERS, LEVELS, type Chapter, type Grade, type Level } from '@five-nines/sim';
import { useEffect, useRef } from 'react';
import { isPassingGrade } from '../format.ts';
import { navigate, routeHref } from '../routing.ts';
import { progressStore } from '../state/index.ts';
import { AllHands, story, words, type AllHandsScene } from '../theme/index.ts';

/** The chapter a level belongs to. */
export function chapterOf(levelId: string): Chapter | undefined {
  return CHAPTERS.find((chapter) => chapter.levelIds.includes(levelId));
}

/** "p.4 · Everything Links". */
function levelLabel(level: Level): string {
  return `${words.levelShort(LEVELS.findIndex((l) => l.id === level.id) + 1)} · ${level.title}`;
}

/** The level a chapter's all-hands leads on to, when reopened: the first not yet passed, else the first. */
export function allHandsNextLevel(chapter: Chapter, best: Readonly<Record<string, Grade>>): Level | undefined {
  const id = chapter.levelIds.find((levelId) => !isPassingGrade(best[levelId])) ?? chapter.levelIds[0];
  return LEVELS.find((level) => level.id === id);
}

/**
 * A chapter's all-hands: one panel, skippable with Enter or Esc. It records itself as seen as soon as it shows, so it
 * opens by itself only once (`LevelGate` in App.tsx); the contents page can bring it back.
 */
export function AllHandsScreen({
  chapter,
  scene,
  next,
  onContinue,
}: {
  chapter: Chapter;
  scene: AllHandsScene;
  /** The level the way on leads to. */
  next: Level;
  /** What the way on does; by default, open `next`. */
  onContinue?: () => void;
}) {
  useEffect(() => progressStore.getState().markAllHandsSeen(chapter.id), [chapter.id]);
  const go = onContinue ?? (() => navigate({ name: 'level', levelId: next.id }));
  // Enter or Esc skips straight to the level. A focused button or link keeps its own Enter.
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const onControl = event.target instanceof HTMLElement && event.target.closest('a, button, input, textarea, select') !== null;
      if (event.key === 'Escape' || (event.key === 'Enter' && !onControl)) {
        event.preventDefault();
        goRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return (
    <AllHands
      scene={scene}
      chapterNumber={CHAPTERS.findIndex((c) => c.id === chapter.id) + 1}
      chapterTitle={chapter.title}
      continueLabel={story.words.continueTo(levelLabel(next))}
      onContinue={go}
      backHref={routeHref({ name: 'levels' })}
    />
  );
}
