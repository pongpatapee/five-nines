import { LEVELS, type Level } from '@five-nines/sim';
import type { GradedEvaluation } from '../engine/index.ts';
import { isPassingGrade } from '../format.ts';
import { useBestGrade } from '../state/index.ts';
import { GradeCard } from '../theme/index.ts';
import { DebriefPanel } from './DebriefPanel.tsx';
import type { ResultView } from '../screens/levelMode.ts';
import { useRecordBestGrade } from './useRecordBestGrade.ts';

export interface ResultsViewProps {
  level: Level;
  evaluation: GradedEvaluation;
  view: ResultView;
  onViewChange(view: ResultView): void;
  onBackToEditor(): void;
  onReplay(): void;
  /** Go to the next level; null when there is none. Only offered when this attempt passed. */
  onNextLevel: (() => void) | null;
}

/** Result mode: the grade card, or the debrief over the canvas. Records the best grade. */
export function ResultsView({ level, evaluation, view, onViewChange, onBackToEditor, onReplay, onNextLevel }: ResultsViewProps) {
  useRecordBestGrade(level.id, evaluation);
  const best = useBestGrade(level.id);
  const passed = evaluation.grade !== 'fail';

  return (
    <div className="results-overlay" data-view={view}>
      {view === 'grade' ? (
        <GradeCard
          level={level}
          levelNumber={LEVELS.findIndex((l) => l.id === level.id) + 1}
          evaluation={evaluation}
          onBackToEditor={onBackToEditor}
          onReplay={onReplay}
          onShowDebrief={() => onViewChange('debrief')}
          onNextLevel={passed ? onNextLevel : null}
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
