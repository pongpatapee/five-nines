/**
 * The napkin-maths step: the working behind each level's estimate question, from the level's own numbers. The
 * working carries every number in it, so the mentor can show the arithmetic after the player answers.
 */
import { APP_SERVER_SIZES, DATABASE_SIZES, type AppServerSize, type DatabaseSize } from './catalog.ts';
import { peakRps } from './peak-load.ts';
import type { Estimate, Level } from './schema.ts';

/** An estimate within this share of the answer, either side, earns the bonus mark. */
export const ESTIMATE_TOLERANCE = 0.1;

export type EstimateWorking =
  | { quantity: 'busyVcpusAtPeak'; peakRps: number; cpuMsPerRequest: number; result: number }
  | {
      quantity: 'serversWithSpare';
      size: AppServerSize;
      peakRps: number;
      vcpu: number;
      cpuMsPerRequest: number;
      /** Requests per second one server handles flat out. */
      perServerRps: number;
      /** Servers needed to carry the peak, before the spare. */
      needed: number;
      result: number;
    }
  | {
      quantity: 'cacheHitRateNeeded';
      databaseSize: DatabaseSize;
      peakRps: number;
      readsPerSec: number;
      writesPerSec: number;
      databaseReadsPerSec: number;
      /** How many reads one write costs the database. */
      writeCost: number;
      /** Reads the database has room for once the writes are paid for. */
      readsLeft: number;
      /** Percent. */
      result: number;
    }
  | { quantity: 'readsAtPeak'; peakRps: number; readShare: number; result: number }
  | {
      quantity: 'readAfterWriteReadsAtPeak';
      peakRps: number;
      readShare: number;
      readAfterWriteShare: number;
      result: number;
    };

/** Works out the level's estimate question from its workload. Null when the level has no estimate. */
export function estimateWorking(level: Level): EstimateWorking | null {
  const estimate = level.estimate;
  return estimate ? workEstimate(level, estimate) : null;
}

export function workEstimate(level: Level, estimate: Estimate): EstimateWorking {
  const peak = peakRps(level);
  const { cpuMsPerRequest, data } = level.workload;
  const readShare = data?.readShare ?? 0;
  switch (estimate.quantity) {
    case 'busyVcpusAtPeak':
      return { quantity: estimate.quantity, peakRps: peak, cpuMsPerRequest, result: (peak * cpuMsPerRequest) / 1000 };
    case 'serversWithSpare': {
      const { vcpu } = APP_SERVER_SIZES[estimate.size];
      const perServerRps = (vcpu * 1000) / cpuMsPerRequest;
      const needed = Math.ceil(peak / perServerRps);
      return {
        quantity: estimate.quantity,
        size: estimate.size,
        peakRps: peak,
        vcpu,
        cpuMsPerRequest,
        perServerRps,
        needed,
        result: needed + 1,
      };
    }
    case 'cacheHitRateNeeded': {
      const db = DATABASE_SIZES[estimate.databaseSize];
      const readsPerSec = peak * readShare;
      const writesPerSec = peak - readsPerSec;
      const writeCost = db.readsPerSec / db.writesPerSec;
      const readsLeft = db.readsPerSec - writesPerSec * writeCost;
      const hitRate = readsPerSec > 0 ? Math.min(1, Math.max(0, 1 - readsLeft / readsPerSec)) : 0;
      return {
        quantity: estimate.quantity,
        databaseSize: estimate.databaseSize,
        peakRps: peak,
        readsPerSec,
        writesPerSec,
        databaseReadsPerSec: db.readsPerSec,
        writeCost,
        readsLeft,
        result: hitRate * 100,
      };
    }
    case 'readsAtPeak':
      return { quantity: estimate.quantity, peakRps: peak, readShare, result: peak * readShare };
    case 'readAfterWriteReadsAtPeak': {
      const share = data?.readAfterWrite?.share ?? 0;
      return {
        quantity: estimate.quantity,
        peakRps: peak,
        readShare,
        readAfterWriteShare: share,
        result: peak * readShare * share,
      };
    }
  }
}

/** Whether a guess is close enough for the bonus mark: within `ESTIMATE_TOLERANCE` of the answer. */
export function isCloseEstimate(guess: number, answer: number): boolean {
  if (!Number.isFinite(guess)) return false;
  return Math.abs(guess - answer) <= ESTIMATE_TOLERANCE * Math.abs(answer) + 1e-9;
}
