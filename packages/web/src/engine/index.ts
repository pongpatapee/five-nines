import type { Evaluation } from '@five-nines/sim';

export { runEvaluation } from './client.ts';

/** An evaluation that got as far as simulation and grading. Playback and results only ever see these. */
export type GradedEvaluation = Extract<Evaluation, { status: 'graded' }>;
