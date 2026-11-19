/**
 * The notebook's story: Everything Labs (docs/story/everything-labs.md). The player joins a startup that launches a
 * product a quarter, each named "Everything ___". The founder, Chad Visionary, dreams them up on stage; the player
 * makes them survive launch day.
 *
 * The rules this file keeps:
 * - Comedy lives in the founder's lines, the product names and Doug's stamp. The engineering is played straight.
 * - The founder never states a number. Erasmus's translations are worded from the level's own numbers
 *   (`levelNumbers`), and every figure in them is in the numbers box beside them (CI checks).
 * - Events are never timed: "at some point".
 * - Doug (the Naming Department) and Bex (Head of Growth) appear only in copy: quoted, or on a sticky note.
 * - Funny, not mean: the founder is sincere and kind, and nobody is stupid for laughs.
 */
import type { LevelNumbers } from '@five-nines/sim';
import { formatCount, formatDuration, formatMs } from '../../format.ts';
import type { AllHandsScene, LevelMemo, Promotion, StoryScript } from '../contract.ts';
import { bigCount, shareText } from './numbers.tsx';

const n = formatCount;

/** "1,000 climbing to 5,000", or "12,000" when the traffic is flat. */
function climb({ traffic }: LevelNumbers): string {
  return traffic.startRps === traffic.sustainedRps
    ? n(traffic.sustainedRps)
    : `${n(traffic.startRps)} climbing to ${n(traffic.sustainedRps)}`;
}

/** The level's first spike, which every level that uses this has. */
function spike({ traffic }: LevelNumbers): { rps: string; sec: string } {
  const first = traffic.spikes[0];
  return { rps: n(first?.rps ?? traffic.sustainedRps), sec: String(first?.durationSec ?? 0) };
}

const reads = (numbers: LevelNumbers) => shareText(numbers.data?.readShare ?? 0);
const writes = (numbers: LevelNumbers) => shareText(1 - (numbers.data?.readShare ?? 0));

interface LevelStory {
  /** What the level works on, beside its title. */
  product: string;
  hype: string;
  translation(numbers: LevelNumbers): string;
  sticky?: { from: string; text: string };
}

/** Per level, by id. */
const LEVELS: Readonly<Record<string, LevelStory>> = {
  '01-hello-traffic': {
    product: 'Everything Links · the waitlist',
    hype: "The waitlist goes live today. This is the moment the future gets an email address. Expect massive demand. Like, a lot.",
    translation: (x) =>
      `"A lot" means ${climb(x)} requests a second, ${formatMs(x.cpuMsPerRequest)} of CPU each. One app server, p99 under ${formatMs(x.requirements.p99Ms)}.`,
  },
  '02-scale-out': {
    product: 'Everything Links · the waitlist goes viral',
    hype: "We're going viral. Organically. I paid for nothing. I'd like to thank Bex, and also the concept of momentum.",
    translation: (x) =>
      `"Viral" means ${climb(x)} requests a second, still ${formatMs(x.cpuMsPerRequest)} of CPU each. Check how much one box can take before you pick one.`,
    sticky: { from: 'Bex, Head of Growth', text: 'I got us into the newsletter!! Everyone reads it. Like, everyone.' },
  },
  '03-pull-the-plug': {
    product: 'Everything Links · launch week',
    hype: "Downtime is a mindset. And we don't have that mindset. We have the other one.",
    translation: (x) =>
      `Same traffic, up to ${n(x.traffic.sustainedRps)} requests a second, and at some point one app server will crash. Lose any one and keep serving everyone.`,
  },
  '11-everything-links': {
    product: 'Everything Links · launch day',
    hype: 'Long links are a tax on the human spirit. Today, we repeal that tax. For everyone. Forever. Starting now-ish.',
    translation: (x) =>
      `Launch day: ${climb(x)} requests a second, ${formatMs(x.cpuMsPerRequest)} of CPU each, then one trip to the database: ${reads(x)} redirects, ${writes(x)} new links. A server will crash. p99 under ${formatMs(x.requirements.p99Ms)}. New machine, same 70% rule.`,
    sticky: { from: 'Doug, Naming Department', text: 'Stamp is inked and ready. EVERYTHING.' },
  },
  '04-read-all-about-it': {
    product: 'Everything News',
    hype: "News is broken. We're not reporting the news. We're disrupting it. We aggregate from everywhere, which is where news comes from.",
    translation: (x) => {
      const { rps, sec } = spike(x);
      return `${climb(x)} requests a second, and when a story breaks, ${rps} for ${sec} s. ${reads(x)} read one of ${bigCount(x.data?.keys?.count ?? 0)} articles, and a few of them get most of the reads.`;
    },
  },
  '05-cache-miss': {
    product: 'Everything Chat · profile cards',
    hype: 'Every conversation is a relationship. Every relationship is a platform. Also, Chat went viral. I did not see that coming. I saw it coming.',
    translation: (x) =>
      `${climb(x)} requests a second, ${reads(x)} of them reading a profile, out of ${bigCount(x.data?.keys?.count ?? 0)}, all equally likely. A profile may be up to ${x.requirements.maxStalenessSec ?? 0} s out of date.`,
  },
  '06-bank-balance': {
    product: 'Everything Pay · the wallet',
    hype: 'Money is just information that wants to be free. Not free free. Fee-free. Legal says I have to stop saying free.',
    translation: (x) => {
      const { rps } = spike(x);
      const own = x.data?.readAfterWrite;
      return `${climb(x)} requests a second, ${rps} on payday. ${reads(x)} reads, and ${shareText(own?.share ?? 0)} of reads are someone checking their balance right after their own transfer. They must see it.`;
    },
  },
  '07-the-write-wall': {
    product: 'Everything Social · reactions',
    hype: "Engagement is the new oxygen. Breathe it in. Then react to it. Then react to the reaction.",
    translation: (x) =>
      `${climb(x)} writes a second, and no reads: this is just the reactions service. At some point one post goes viral. Pick the shard key with care.`,
    sticky: { from: 'Bex, Head of Growth', text: 'A celebrity signed up! Huge. Can we make sure they have a good time?' },
  },
  '08-thundering-herd': {
    product: 'Everything Store · opening day',
    hype: "Shopping, but disrupted. Imagine a store. Now imagine it's everything. That's the name.",
    translation: (x) =>
      `${climb(x)} requests a second on opening day, ${reads(x)} of them reads over ${bigCount(x.data?.keys?.count ?? 0)} items, a few very popular. At some point the cache comes back empty.`,
  },
  '09-stale-prices': {
    product: 'Everything Store · AI-powered pricing',
    hype: 'Our prices now have feelings. AI-powered feelings. They change when they want to. Respect that.',
    translation: (x) =>
      `${climb(x)} requests a second, ${reads(x)} reads over ${bigCount(x.data?.keys?.count ?? 0)} products, and every write is a price change. Show no price more than ${x.requirements.maxStalenessSec ?? 0} s old.`,
  },
  '10-flash-sale': {
    product: 'The Everything Drop · a flash sale',
    hype: "Scarcity is a feature. We're shipping it. There will only be a few. Of everything.",
    translation: (x) => {
      const { rps, sec } = spike(x);
      return `${n(x.traffic.startRps)} orders a second, then ${rps} a second for ${sec} s. The payment provider takes ${n(x.payments?.rateLimitRps ?? 0)} charges a second, ${formatMs(x.payments?.latencyMs ?? 0)} each. Answer within ${formatMs(x.requirements.p99Ms)}, charge every order within ${formatDuration(x.requirements.processWithinSec ?? 0)}.`;
    },
  },
};

/** Each written chapter's all-hands, by chapter id. */
const ALL_HANDS: Readonly<Record<string, AllHandsScene>> = {
  'getting-online': {
    product: 'Everything Links',
    beats: [
      { kind: 'stage', text: 'The gong. Chad bounds onto the beanbags.' },
      {
        kind: 'line',
        role: 'founder',
        text: "Team. Family. Doug. Look at a link. Any link. It's long. It's ugly. Our links still have question marks in them. Today that ends. Doug?",
      },
      { kind: 'stage', text: 'Doug lifts a sheet. On the whiteboard, in stamp ink:' },
      { kind: 'stamp', text: 'Everything Links' },
      {
        kind: 'line',
        role: 'founder',
        text: "Short links. For everyone. We open the waitlist today, and we launch when it's ready. It'll be ready soon. It'll scale, obviously. Our new intern is on it.",
      },
      {
        kind: 'line',
        role: 'founder',
        text: 'Welcome to the family, by the way. Your title is Synergy Intern. Nobody knows what it means, which means it can mean anything.',
      },
      { kind: 'margin', text: "That's you. Start with the waitlist. —E." },
    ],
  },
  'growing-pains': {
    product: 'Everything News, Chat and Pay',
    beats: [
      { kind: 'stage', text: 'The gong, twice. Chad is wearing a second lanyard.' },
      {
        kind: 'line',
        role: 'founder',
        text: "Everything Links works. People are shortening things that were already short. That's how you know. So this quarter we don't launch one product. We launch three. Doug?",
      },
      { kind: 'stage', text: 'Doug stamps the whiteboard three times, without looking.' },
      { kind: 'stamp', text: 'Everything News · Everything Chat · Everything Pay' },
      {
        kind: 'line',
        role: 'founder',
        text: 'News, but disrupted. Chat, but disrupted. Money, but disrupted. Same team, same energy, more data. Data is the new everything.',
      },
      { kind: 'margin', text: 'Three products, one database each, and a lot more reads. One machine at a time. —E.' },
    ],
  },
  hypergrowth: {
    product: 'Everything Social, Store and the Drop',
    beats: [
      { kind: 'stage', text: 'The gong is new. It is larger. Nobody asked about the old gong.' },
      {
        kind: 'line',
        role: 'founder',
        text: "We're not a startup anymore. We're a scale-up. Next year, a scale-sideways. This quarter: a social network, a store, and a sale so fast it's over before it starts. Doug?",
      },
      { kind: 'stamp', text: 'Everything Social · Everything Store · The Everything Drop' },
      {
        kind: 'line',
        role: 'founder',
        text: "Bex says the numbers are going up. I don't look at numbers. I look at the horizon. The horizon is going up too.",
      },
      { kind: 'margin', text: 'More writes than one database takes, caches that forget, and a partner with a rate limit. Hold on. —E.' },
    ],
  },
};

/** The promotion each written chapter hands out, by chapter id (`progression/promotion.ts` decides when). */
const PROMOTIONS: Readonly<Record<string, Promotion>> = {
  'getting-online': {
    title: '10x Engineer',
    beats: [
      { kind: 'stage', text: 'The gong. A confetti cannon. Most of it misses.' },
      {
        kind: 'line',
        role: 'founder',
        text: "Everything Links is live, and it didn't fall over. I'm told that's rare? I ran the numbers. Okay, Erasmus ran the numbers. Synergy Intern, you are now a 10x Engineer. I don't know what the other nine x's are, but I can feel them.",
      },
      { kind: 'stage', text: 'Doug stamps a new business card.' },
      { kind: 'stamp', text: '10x Engineer' },
      { kind: 'margin', text: 'Shipped, and it held. Well earned. Next quarter is worse. —E.' },
    ],
  },
  'growing-pains': {
    title: 'Paradigm Architect',
    beats: [
      { kind: 'stage', text: 'The gong. Chad holds up a tiny cardboard house.' },
      {
        kind: 'line',
        role: 'founder',
        text: "News, Chat and Pay are live, and they held. You didn't just shift the paradigm. You built it a house. You are now a Paradigm Architect. The house is for you. It's a metaphor, but you can keep it.",
      },
      { kind: 'stamp', text: 'Paradigm Architect' },
      { kind: 'margin', text: 'Caches, replicas, and reads that see their own writes. Reading is handled. Writing is next. —E.' },
    ],
  },
  hypergrowth: {
    title: 'Chief Disruption Officer',
    beats: [
      { kind: 'stage', text: 'The big gong. Chad takes a long, emotional pause.' },
      {
        kind: 'line',
        role: 'founder',
        text: "There's only one Chief Disruption Officer at Everything Labs, and it used to be me. It's you now. I'm promoting myself to Visionary Emeritus. I'll still be here. Every day. Visioning.",
      },
      { kind: 'stamp', text: 'Chief Disruption Officer' },
      { kind: 'margin', text: 'Shards, stampedes, invalidation and queues, all through launch traffic. Nothing left to teach you on one region. —E.' },
    ],
  },
};

function memo(levelId: string, numbers: LevelNumbers): LevelMemo | null {
  const story = LEVELS[levelId];
  return story ? { hype: story.hype, translation: story.translation(numbers), sticky: story.sticky ?? null } : null;
}

export const NOTEBOOK_STORY: StoryScript = {
  company: 'Everything Labs',
  product: (levelId) => LEVELS[levelId]?.product ?? null,
  memo,
  allHands: (chapterId) => ALL_HANDS[chapterId] ?? null,
  startingTitle: 'Synergy Intern',
  promotions: PROMOTIONS,
  words: {
    titleLabel: 'Your title',
    capstone: 'launch day',
    replayAllHands: 'all-hands',
    continueTo: (levelLabel) => `On to ${levelLabel}`,
    promoted: 'Promotion',
  },
};
