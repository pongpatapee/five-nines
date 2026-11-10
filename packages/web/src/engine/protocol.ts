import type { Design, Evaluation } from '@five-nines/sim';

/** Main thread → worker. */
export interface EvaluateRequest {
  requestId: number;
  levelId: string;
  design: Design;
}

/** Worker → main thread. */
export type EvaluateResponse =
  | { requestId: number; ok: true; evaluation: Evaluation }
  | { requestId: number; ok: false; error: string };
