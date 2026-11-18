/**
 * The field guide: what the game knows about it. Which entries the player has met (never spoiling ahead), each
 * component's spec table from the catalog, and which entry a napkin question or a hint points to. Pure; the theme
 * words and draws the guide (`FieldGuide`, `fieldGuide` in the theme contract).
 */
import {
  APP_SERVER_SIZES,
  BLOB_STORAGE,
  CACHE,
  CACHE_SIZES,
  COMPONENTS_IN_CAMPAIGN,
  DATABASE_SIZES,
  LOAD_BALANCER,
  PAYMENT_PROVIDER,
  QUEUE,
  QUEUE_SIZES,
  type ComponentKind,
  type EstimateQuantity,
  type Level,
} from '@five-nines/sim';
import { formatCompact, formatCount, formatUsdCents, formatUsdPerMonth } from '../format.ts';
import type { LevelAccess } from '../progression/index.ts';

/** The ideas the guide explains besides the components. */
export const CONCEPT_IDS = ['nines', 'p99', 'utilization', 'errorBudget'] as const;
export type ConceptId = (typeof CONCEPT_IDS)[number];

export type GuideEntryId = ComponentKind | ConceptId;

export function isConceptId(id: GuideEntryId): id is ConceptId {
  return (CONCEPT_IDS as readonly string[]).includes(id);
}

/**
 * The level that introduces each concept: the first page whose play depends on it. Availability, p99 and the 70% rule
 * are all on page 1's requirements and briefing; the error budget becomes the lesson on page 3, where a crash spends it.
 */
export const CONCEPT_INTRODUCED_AT: Readonly<Record<ConceptId, string>> = {
  nines: '01-hello-traffic',
  p99: '01-hello-traffic',
  utilization: '01-hello-traffic',
  errorBudget: '03-pull-the-plug',
};

/**
 * Components in the order a design meets them, for the guide's table of contents: the ones some level offers. A kind
 * in the catalog that no level uses yet (blob storage) has an entry, but no page leads to it, so it is neither shown
 * nor counted as still to come.
 */
export const COMPONENT_ORDER: readonly ComponentKind[] = COMPONENTS_IN_CAMPAIGN;

export interface MetEntries {
  components: readonly ComponentKind[];
  concepts: readonly ConceptId[];
  /** Entries the guide has but the player hasn't met yet. */
  unmet: number;
}

/**
 * What the player has met: the components and concepts of every level they can open. A level the player can't open
 * yet teaches nothing, so its components stay out of the guide. `?unlock=all` opens every level, and so every entry.
 */
export function metEntries(levels: readonly Level[], access: Readonly<Record<string, LevelAccess>>): MetEntries {
  const reached = levels.filter((level) => access[level.id]?.kind === 'open');
  const kinds = new Set(reached.flatMap((level) => level.components));
  const reachedIds = new Set(reached.map((level) => level.id));
  const components = COMPONENT_ORDER.filter((kind) => kinds.has(kind));
  const concepts = CONCEPT_IDS.filter((id) => reachedIds.has(CONCEPT_INTRODUCED_AT[id]));
  return { components, concepts, unmet: COMPONENT_ORDER.length + CONCEPT_IDS.length - components.length - concepts.length };
}

export function isMet(met: MetEntries, id: GuideEntryId): boolean {
  return isConceptId(id) ? met.concepts.includes(id) : met.components.includes(id);
}

/** A component's spec table: column headings and one row per option, every figure from the catalog. */
export interface SpecTable {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

const sizes = <S extends string>(table: Record<S, unknown>) => Object.keys(table) as S[];
const perMonth = formatUsdPerMonth;

export function specTable(kind: ComponentKind): SpecTable {
  switch (kind) {
    case 'appServer':
      return {
        columns: ['Size', 'vCPUs', 'req/s at 1 ms of CPU', 'Price'],
        rows: sizes(APP_SERVER_SIZES).map((size) => {
          const { vcpu, usdPerMonth } = APP_SERVER_SIZES[size];
          return [size, String(vcpu), formatCount(vcpu * 1000), perMonth(usdPerMonth)];
        }),
      };
    case 'loadBalancer':
      return {
        columns: ['Option', 'Passes on', 'Adds', 'Price'],
        rows: [['any', `${formatCount(LOAD_BALANCER.maxRps)} req/s`, `${LOAD_BALANCER.latencyMs} ms`, perMonth(LOAD_BALANCER.usdPerMonth)]],
      };
    case 'cache':
      return {
        columns: ['Size', 'Memory', 'Lookups/s', 'Price', 'Replicated'],
        rows: sizes(CACHE_SIZES).map((size) => {
          const { memoryGb, usdPerMonth } = CACHE_SIZES[size];
          return [
            size,
            `${memoryGb} GB`,
            formatCount(CACHE.opsPerSec),
            perMonth(usdPerMonth),
            perMonth(usdPerMonth * CACHE.replicatedCostFactor),
          ];
        }),
      };
    case 'database':
    case 'readReplicas':
    case 'shards':
      return {
        columns: ['Size', 'Reads/s', 'Writes/s', 'A write costs', kind === 'database' ? 'Price' : kind === 'shards' ? 'Price per shard' : 'Price per replica'],
        rows: sizes(DATABASE_SIZES).map((size) => {
          const { readsPerSec, writesPerSec, usdPerMonth } = DATABASE_SIZES[size];
          return [size, formatCount(readsPerSec), formatCount(writesPerSec), `${readsPerSec / writesPerSec} reads`, perMonth(usdPerMonth)];
        }),
      };
    case 'queue':
      return {
        columns: ['Size', 'Holds', 'Price'],
        rows: [
          ...sizes(QUEUE_SIZES).map((size) => [size, `${formatCompact(QUEUE_SIZES[size].maxDepth)} messages`, perMonth(QUEUE_SIZES[size].usdPerMonth)]),
          ['each worker', `${QUEUE.workerConcurrency} charges in flight`, perMonth(QUEUE.workerUsdPerMonth)],
        ],
      };
    case 'paymentProvider':
      return {
        columns: ['Option', 'Limit', 'Price'],
        rows: [['any', 'set by the level', perMonth(PAYMENT_PROVIDER.usdPerMonth)]],
      };
    case 'blobStorage':
      return {
        columns: ['Use', 'Per key prefix', 'Price'],
        rows: [
          ['reads', `${formatCount(BLOB_STORAGE.readsPerSecPerPrefix)}/s`, `${formatUsdCents(BLOB_STORAGE.usdPerMillionReads)} per million`],
          ['writes', `${formatCount(BLOB_STORAGE.writesPerSecPerPrefix)}/s`, `${formatUsdCents(BLOB_STORAGE.usdPerMillionWrites)} per million`],
          ['storage', 'unlimited', `${formatUsdCents(BLOB_STORAGE.usdPerGbMonth)} per GB a month`],
        ],
      };
  }
}

/** The guide entry that explains the method behind each napkin question. */
export const ESTIMATE_GUIDE_ENTRY: Readonly<Record<EstimateQuantity, GuideEntryId>> = {
  busyVcpusAtPeak: 'appServer',
  serversWithSpare: 'appServer',
  cacheHitRateNeeded: 'cache',
  secondsBetweenKeyReads: 'cache',
  pinnedPrimaryLoad: 'database',
  shardsAtFullLoad: 'shards',
  coldCacheOverload: 'cache',
  queueDrainRateNeeded: 'queue',
};
