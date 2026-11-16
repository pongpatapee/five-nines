import { CHAPTERS, LEVELS, type Design, type Level } from '@five-nines/sim';
import { useMemo } from 'react';
import type { GradedEvaluation } from '../engine/index.ts';
import { useReducedMotion } from '../playback/useReducedMotion.ts';
import { GuideLink } from '../guide/FieldGuideProvider.tsx';
import { cast, failoverSituation, GradeCard, savingsSituation, type RewardView } from '../theme/index.ts';
import type { Hints } from '../screens/useHints.ts';
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
  /** The failed run's hints, shared with the top bar's hints dialog. Null when the run passed. */
  hints: Hints | null;
  /** The solution page, behind a confirm while it costs something. */
  onShowSolution(): void;
  /** Whether seeing the solution now would cap the level (progression/peek.ts). */
  solutionCosts: boolean;
  peeked: boolean;
  onLoadSolution(design: Design): void;
  onSwitchBack: (() => void) | null;
}

/** Result mode: the grade card, or the debrief over the canvas. Records the run and reveals what it paid out. */
export function ResultsView({
  level,
  design,
  evaluation,
  view,
  onViewChange,
  onBackToEditor,
  onReplay,
  onNextLevel,
  hints,
  onShowSolution,
  solutionCosts,
  peeked,
  onLoadSolution,
  onSwitchBack,
}: ResultsViewProps) {
  const reward = useRunReward(level, evaluation);
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
  const passed = evaluation.grade !== 'fail';
  const failover = useMemo(() => failoverSituation(design, evaluation.simulation), [design, evaluation]);

  return (
    <div className="results-overlay" data-view={view}>
      {view === 'grade' ? (
        <GradeCard
          level={level}
          levelNumber={LEVELS.findIndex((l) => l.id === level.id) + 1}
          evaluation={evaluation}
          hints={
            hints && hints.ladder.kind === 'run'
              ? {
                  ladder: hints.ladder,
                  shown: hints.shown,
                  onReveal: hints.reveal,
                  footer: hints.ladder.guide ? <GuideLink entry={hints.ladder.guide} /> : undefined,
                }
              : null
          }
          failover={failover}
          onBackToEditor={onBackToEditor}
          onReplay={onReplay}
          onShowDebrief={onShowSolution}
          solutionLabel={solutionCosts ? cast.giveUp.show : cast.giveUp.showFree}
          onNextLevel={passed ? onNextLevel : null}
          reward={rewardView}
          savings={savings}
        />
      ) : (
        <DebriefPanel
          level={level}
          peeked={peeked}
          onClose={() => onViewChange('grade')}
          closeLabel="Back to result"
          onLoad={onLoadSolution}
          onSwitchBack={onSwitchBack}
        />
      )}
    </div>
  );
}
