import { useEffect } from 'react';
import type { GradedEvaluation } from '../engine/index.ts';
import { progressStore } from '../state/index.ts';

/** Records the attempt's grade as the level's best if it beats the stored one. Idempotent, so safe on remount. */
export function useRecordBestGrade(levelId: string, evaluation: GradedEvaluation): void {
  useEffect(() => {
    progressStore.getState().recordGrade(levelId, evaluation.grade);
  }, [levelId, evaluation]);
}
