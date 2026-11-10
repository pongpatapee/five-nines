/**
 * The simulation worker. Evaluating a design takes long enough (hundreds of milliseconds for a 3-minute run) that it
 * mustn't block the UI thread. Stateless: one request in, one response out.
 */
import { evaluateDesign, getLevel } from '@five-nines/sim';
import type { EvaluateRequest, EvaluateResponse } from './protocol.ts';

/** The parts of `DedicatedWorkerGlobalScope` we use. (The DOM and WebWorker libs can't be loaded together.) */
interface WorkerScope {
  onmessage: ((event: MessageEvent<EvaluateRequest>) => void) | null;
  postMessage(message: EvaluateResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { requestId, levelId, design } = event.data;
  let response: EvaluateResponse;
  try {
    const level = getLevel(levelId);
    if (!level) throw new Error(`Unknown level "${levelId}".`);
    response = { requestId, ok: true, evaluation: evaluateDesign(level, design) };
  } catch (error) {
    response = { requestId, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  scope.postMessage(response);
};
