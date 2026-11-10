/**
 * Main-thread client for the simulation worker.
 *
 *   const evaluation = await runEvaluation(level.id, draft.design);
 *
 * One worker is created lazily and reused. Requests are matched to responses by id, so concurrent calls are fine.
 * If the worker crashes, every pending call rejects and the next call starts a fresh worker.
 */
import type { Design, Evaluation } from '@five-nines/sim';
import type { EvaluateRequest, EvaluateResponse } from './protocol.ts';

interface Pending {
  resolve(evaluation: Evaluation): void;
  reject(error: Error): void;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, Pending>();

function failAll(error: Error): void {
  for (const call of pending.values()) call.reject(error);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'five-nines-sim' });
  created.onmessage = (event: MessageEvent<EvaluateResponse>) => {
    const response = event.data;
    const call = pending.get(response.requestId);
    if (!call) return;
    pending.delete(response.requestId);
    if (response.ok) call.resolve(response.evaluation);
    else call.reject(new Error(response.error));
  };
  const crash = (message: string) => {
    created.terminate();
    if (worker === created) worker = null;
    failAll(new Error(message));
  };
  created.onerror = (event) => {
    event.preventDefault();
    crash(event.message || 'The simulation worker crashed.');
  };
  created.onmessageerror = () => crash('The simulation worker sent an unreadable message.');
  worker = created;
  return created;
}

/** Validates, simulates and grades `design` for the level, off the main thread. */
export function runEvaluation(levelId: string, design: Design): Promise<Evaluation> {
  return new Promise<Evaluation>((resolve, reject) => {
    const requestId = nextRequestId++;
    pending.set(requestId, { resolve, reject });
    const request: EvaluateRequest = { requestId, levelId, design };
    try {
      getWorker().postMessage(request);
    } catch (error) {
      pending.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
