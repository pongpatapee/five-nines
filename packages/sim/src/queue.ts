/**
 * One queueing station: a pool of identical workers in front of a fluid backlog. App-server instances, databases,
 * read replicas and caches are all stations; they differ only in how many workers they have and how long a unit of
 * work takes.
 *
 * Each tick, the arrivals join the backlog and the station clears what its capacity allows. Work that couldn't be
 * cleared before the timeout fails now, attributed to this tick's arrivals. Below capacity, random queueing comes
 * from the M/M/c model (Erlang C).
 */
import { TICK_SEC } from './catalog.ts';
import { erlangC, sampleExponential, type Rng } from './math.ts';

export interface StationState {
  up: boolean;
  /** Work waiting for a free worker, in arrival units. */
  backlog: number;
  arrivalRps: number;
  /** Arrival rate divided by capacity. Above 1 means overloaded. */
  utilization: number;
}

/**
 * What a request arriving at a station this tick experiences.
 * Flow accounting and probes both read it, so they agree on who fails.
 */
export interface StationTick {
  up: boolean;
  /** Share of arrivals rejected because the backlog can't be cleared before the timeout. */
  overflowFraction: number;
  /** Wait behind the backlog left over from earlier ticks. */
  backlogWaitSec: number;
  /** Erlang C: chance of waiting for a free worker at all. */
  waitProbability: number;
  /** μ − λ: the rate of the exponential queueing delay for those who wait. */
  drainRate: number;
}

export const DOWN_TICK: StationTick = {
  up: false,
  overflowFraction: 1,
  backlogWaitSec: 0,
  waitProbability: 0,
  drainRate: 0,
};

export const IDLE_TICK: StationTick = {
  up: true,
  overflowFraction: 0,
  backlogWaitSec: 0,
  waitProbability: 0,
  drainRate: 0,
};

export function newStation(): StationState {
  return { up: true, backlog: 0, arrivalRps: 0, utilization: 0 };
}

/**
 * Advances an up station by one tick. `meanServiceSec` is one worker's time per unit of arrival. Returns the tick
 * view and how many arrivals (not a rate) failed by timing out.
 */
export function stepStation(
  state: StationState,
  arrivalRps: number,
  servers: number,
  meanServiceSec: number,
  timeoutSec: number,
): { tick: StationTick; failed: number } {
  const capacityRps = servers / meanServiceSec;
  state.arrivalRps = arrivalRps;
  state.utilization = arrivalRps / capacityRps;

  // Fluid backlog: what can't be served this tick waits. Anything that couldn't be served before the
  // timeout is rejected now, attributed to this tick's arrivals.
  const arriving = arrivalRps * TICK_SEC;
  let backlog = state.backlog + arriving;
  backlog -= Math.min(backlog, capacityRps * TICK_SEC);
  const overflow = Math.max(0, backlog - capacityRps * timeoutSec);
  backlog -= overflow;
  state.backlog = backlog;

  // Random queueing on top of the backlog, from the M/M/c model. Only defined below capacity.
  const backlogWaitSec = backlog / capacityRps;
  let waitProbability = 0;
  let drainRate = 0;
  if (arrivalRps > 0 && arrivalRps < capacityRps) {
    waitProbability = erlangC(servers, arrivalRps * meanServiceSec);
    drainRate = capacityRps - arrivalRps;
  }
  const lateProbability = waitProbability * Math.exp(-drainRate * Math.max(0, timeoutSec - backlogWaitSec));

  return {
    tick: {
      up: true,
      overflowFraction: arriving > 0 ? overflow / arriving : 0,
      backlogWaitSec,
      waitProbability,
      drainRate,
    },
    failed: overflow + (arriving - overflow) * lateProbability,
  };
}

/**
 * Walks one sampled request through a station: its queueing delay in seconds, or null if it failed there (rejected
 * by the overflow, or waited past the timeout). The caller adds the service time.
 */
export function probeWait(tick: StationTick, rng: Rng, timeoutSec: number): number | null {
  if (!tick.up || rng() < tick.overflowFraction) return null;
  let waitSec = tick.backlogWaitSec;
  if (rng() < tick.waitProbability) waitSec += sampleExponential(rng, tick.drainRate);
  return waitSec > timeoutSec ? null : waitSec;
}
