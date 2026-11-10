import { LevelSchema, type Level } from '../schema.ts';
import helloTraffic from './01-hello-traffic.json' with { type: 'json' };
import scaleOut from './02-scale-out.json' with { type: 'json' };
import pullThePlug from './03-pull-the-plug.json' with { type: 'json' };
import readAllAboutIt from './04-read-all-about-it.json' with { type: 'json' };
import cacheMiss from './05-cache-miss.json' with { type: 'json' };
import bankBalance from './06-bank-balance.json' with { type: 'json' };

/** Every level in play order. Parsed at import, so a malformed level fails fast. */
export const LEVELS: readonly Level[] = [
  helloTraffic,
  scaleOut,
  pullThePlug,
  readAllAboutIt,
  cacheMiss,
  bankBalance,
].map((raw) => LevelSchema.parse(raw));

export function getLevel(id: string): Level | undefined {
  return LEVELS.find((level) => level.id === id);
}
