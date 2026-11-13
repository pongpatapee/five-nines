import { CHAPTERS, LEVELS, type Design, type Level } from '@five-nines/sim';
import { useMemo } from 'react';
import { playCue } from '../audio/sfx.ts';
import type { GradedEvaluation } from '../engine/index.ts';
import { isPassingGrade } from '../format.ts';
import { useReducedMotion } from '../playback/useReducedMotion.ts';
import { useBestGrade } from '../state/index.ts';
import { failoverSituation, failureStory, GradeCard, hintLadder, savingsSituation, type RewardView } from '../theme/index.ts';
import { DebriefPanel } from './DebriefPanel.tsx';
import type { ResultView } from '../screens/levelMode.ts';
import { useReveal, useRunReward } from './useRunReward.ts';

export interface ResultsViewProps {
  level: Level;
  /** The design that was run. */
  design: Design;
  evaluation: GradedEvaluation;
  view: ResultView;
  onViewChange(view: ResultView): void;
  onBackToEditor(): void;
  onReplay(): void;
  /** Go to the next level; null when there is none. Only offered when this attempt passed. */
  onNextLevel: (() => void) | null;
}

/** Result mode: the grade card, or the debrief over the canvas. Records the run and reveals what it paid out. */
export function ResultsView({ level, design, evaluation, view, onViewChange, onBackToEditor, onReplay, onNextLevel }: ResultsViewProps) {
  const reward = useRunReward(level.id, design, evaluation);
  const shown = useReveal(evaluation, reward, useReducedMotion());
  const rewardView: RewardView | null =
    reward && shown
      ? {
          reward,
          shown,
          openedChapters: reward.openedChapterIds.map((id) => {
            const index = CHAPTERS.findIndex((chapter) => chapter.id === id);
            return { number: index + 1, title: CHAPTERS[index]!.title };
          }),
        }
      : null;
  const savings = useMemo(() => savingsSituation(evaluation), [evaluation]);
  const best = useBestGrade(level.id);
  const passed = evaluation.grade !== 'fail';
  const hints = useMemo(() => {
    const story = failureStory(level, design, evaluation);
    return story ? hintLadder(level, story) : null;
  }, [level, design, evaluation]);
  const failover = useMemo(() => failoverSituation(design, evaluation.simulation), [design, evaluation]);

  return (
    <div className="results-overlay" data-view={view}>
      {view === 'grade' ? (
        <GradeCard
          level={level}
          levelNumber={LEVELS.findIndex((l) => l.id === level.id) + 1}
          evaluation={evaluation}
          hints={hints}
          failover={failover}
          onBackToEditor={onBackToEditor}
          onReplay={onReplay}
          onShowDebrief={() => onViewChange('debrief')}
          onNextLevel={passed ? onNextLevel : null}
          reward={rewardView}
          savings={savings}
          onHintRevealed={() => playCue('hint')}
        />
      ) : (
        <DebriefPanel
          level={level}
          spoilers={!isPassingGrade(best)}
          onClose={() => onViewChange('grade')}
          closeLabel="Back to result"
        />
      )}
    </div>
  );
}
