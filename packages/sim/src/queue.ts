/**
 * One queueing station: a pool of identical workers in front of a fluid backlog. App-server instances, databases,
 * read replicas and caches are all stations; they differ only in how many workers they have and how long a unit of
 * work takes.
 *
 * Each tick, the arrivals join the backlog and the station clears what its capacity allows. Work that couldn't be
 * cleared before the timeout fails now, attributed to this tick's arrivals. On top of that backlog, random queueing
 * comes from the M/M/c model with timeouts (`queueDelay`), which stays finite at full load.
 *
 * The backlog and the random wait are two views of one queue: the backlog is the part a sustained overload or a spike
 * builds up, the random wait what the queue holds in steady state. A request waits whichever is longer. Above capacity
 * the random part is that of a fully loaded station, because the backlog takes the excess: so delay and failures are
 * continuous through 100% utilization, and a station overflowing at its timeout fails only the excess.
 */
import { TICK_SEC } from './catalog.ts';
import { queueDelay, sampleTruncatedExponential, type Rng } from './math.ts';

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
  /** Chance of waiting for a free worker at all, from random queueing. */
  waitProbability: number;
  /** Chance that random queueing alone keeps the request waiting past the timeout. */
  lateProbability: number;
  /** cμ − λ (0 at or above capacity): random waits that end in time are exponential at this rate, truncated. */
  decayRate: number;
}

export const DOWN_TICK: StationTick = {
  up: false,
  overflowFraction: 1,
  backlogWaitSec: 0,
  waitProbability: 0,
  lateProbability: 0,
  decayRate: 0,
};

export const IDLE_TICK: StationTick = {
  up: true,
  overflowFraction: 0,
  backlogWaitSec: 0,
  waitProbability: 0,
  lateProbability: 0,
  decayRate: 0,
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

  // Random queueing, at no more than full load: above it, the backlog carries the excess.
  const delay = queueDelay(servers, Math.min(arrivalRps, capacityRps), 1 / meanServiceSec, timeoutSec);

  return {
    tick: {
      up: true,
      overflowFraction: arriving > 0 ? overflow / arriving : 0,
      backlogWaitSec: backlog / capacityRps,
      ...delay,
    },
    failed: overflow + (arriving - overflow) * delay.lateProbability,
  };
}

/**
 * Walks one sampled request through a station: its queueing delay in seconds, or null if it failed there (rejected
 * by the overflow, or waited past the timeout). The caller adds the service time.
 */
export function probeWait(tick: StationTick, rng: Rng, timeoutSec: number): number | null {
  if (!tick.up || rng() < tick.overflowFraction) return null;
  const u = rng();
  if (u < tick.lateProbability) return null;
  const randomWaitSec = u < tick.waitProbability ? sampleTruncatedExponential(rng, tick.decayRate, timeoutSec) : 0;
  return Math.max(tick.backlogWaitSec, randomWaitSec);
}
