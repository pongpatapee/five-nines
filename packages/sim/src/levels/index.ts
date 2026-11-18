import { ComponentKindSchema, LevelSchema, type ComponentKind, type Level } from '../schema.ts';
import helloTraffic from './01-hello-traffic.json' with { type: 'json' };
import scaleOut from './02-scale-out.json' with { type: 'json' };
import pullThePlug from './03-pull-the-plug.json' with { type: 'json' };
import readAllAboutIt from './04-read-all-about-it.json' with { type: 'json' };
import cacheMiss from './05-cache-miss.json' with { type: 'json' };
import bankBalance from './06-bank-balance.json' with { type: 'json' };
import theWriteWall from './07-the-write-wall.json' with { type: 'json' };
import thunderingHerd from './08-thundering-herd.json' with { type: 'json' };
import stalePrices from './09-stale-prices.json' with { type: 'json' };
import flashSale from './10-flash-sale.json' with { type: 'json' };

/** Every level in play order. Parsed at import, so a malformed level fails fast. */
export const LEVELS: readonly Level[] = [
  helloTraffic,
  scaleOut,
  pullThePlug,
  readAllAboutIt,
  cacheMiss,
  bankBalance,
  theWriteWall,
  thunderingHerd,
  stalePrices,
  flashSale,
].map((raw) => LevelSchema.parse(raw));

export function getLevel(id: string): Level | undefined {
  return LEVELS.find((level) => level.id === id);
}

/**
 * The component kinds some level offers, in catalog order. The catalog can hold a kind before any level uses it
 * (blob storage, for now): it is real, priced and drawn, but nothing in the campaign teaches it yet, so the field
 * guide leaves it out instead of promising it.
 */
export const COMPONENTS_IN_CAMPAIGN: readonly ComponentKind[] = ComponentKindSchema.options.filter((kind) =>
  LEVELS.some((level) => level.components.includes(kind)),
);
