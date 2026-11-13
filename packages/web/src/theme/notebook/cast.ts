/**
 * The notebook's cast and everything they say. The game picks the situation (`theme/situations.ts`); this file only
 * words it, so the characters never claim something the simulation didn't do.
 *
 * - Ms. Tally, the budget boss: sets the bar in the briefing and delivers the verdict.
 * - Erasmus, the mentor eraser: voices hints, design checks and the postmortem nudge.
 * - Smudge, the ink-blot troublemaker: owns the level's stress (traffic surges, crashed servers, a rebooted cache, a
 *   post gone viral).
 */
import { COMPONENT_LABELS, type FailureReason, type Grade } from '@five-nines/sim';
import { formatAvailability, formatCount, formatMs, formatPercent, formatUsd } from '../../format.ts';
import {
  NAPKIN_WIZARD_LEVELS,
  N_PLUS_ONE_MAX_AFTER_CRASH,
  PENNY_PINCHER_MAX_SPEND,
  type BadgeId,
} from '../../progression/index.ts';
import { tierPercent } from '../../results/grading.ts';
import type { BadgeCopy, CastRole, CastScript } from '../contract.ts';
import type { LevelStress, LockSituation, SavingsSituation, Verdict } from '../situations.ts';
import { failoverLines, MENTOR_ESTIMATE, MENTOR_LADDER, mentorLatency } from './hints.ts';

const MEMBERS = {
  boss: { name: 'Ms. Tally', title: 'budget boss' },
  mentor: { name: 'Erasmus', title: 'mentor' },
  troublemaker: { name: 'Smudge', title: 'troublemaker' },
} as const;

/** "30 seconds", "about a minute", "about a minute and a half", "about 3 minutes": how a character would say when something happens. */
export function roughly(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} seconds`;
  const halves = Math.round(sec / 30);
  if (halves === 2) return 'about a minute';
  if (halves === 3) return 'about a minute and a half';
  return `about ${Math.round(sec / 60)} minutes`;
}

function troublemakerTease(stress: LevelStress): string {
  switch (stress.kind) {
    case 'crash':
      return `heh. ${roughly(stress.atSec)} in, I unplug your busiest ${COMPONENT_LABELS.appServer.toLowerCase()}.`;
    case 'cacheRestart':
      return `heh. ${roughly(stress.atSec)} in, I reboot your cache. everything it remembered? gone.`;
    case 'hotKey':
      return `heh. ${roughly(stress.atSec)} in, ${stress.label} goes viral: ${formatPercent(stress.share)} of all writes, one key.`;
    case 'readAfterWrite':
      return `heh. ${formatPercent(stress.share)} of reads check something the reader just wrote. I'd love to show them the old version.`;
    case 'staleness':
      return `heh. I'm timing every read. more than ${stress.limitSec === 1 ? '1 second' : `${stress.limitSec} seconds`} out of date and it counts as a failure.`;
    case 'spike':
      return `heh. ${roughly(stress.atSec)} in, I send ${formatCount(stress.peakRps)} req/s your way. all at once.`;
    case 'surge':
      return `heh. traffic climbs from ${formatCount(stress.fromRps)} to ${formatCount(stress.toRps)} req/s. hope you sized up.`;
  }
}

const BOSS_PRAISE: Record<Exclude<Grade, 'fail'>, { exclaim: string; line: string }> = {
  pass: { exclaim: 'Three nines.', line: 'Acceptable. There are more nines to be had.' },
  star: { exclaim: 'Four nines!', line: "I'm almost impressed. Almost." },
  mastered: { exclaim: 'Five nines.', line: 'Under budget, too. Frame this page.' },
};

function bossVerdict(verdict: Verdict): { exclaim: string; line: string } {
  switch (verdict.kind) {
    case 'latency':
      return {
        exclaim: `p99 of ${formatMs(verdict.p99Ms)}?!`,
        line: `The limit was ${formatMs(verdict.requiredMs)}. Customers noticed.`,
      };
    case 'budget':
      return {
        exclaim: `${formatUsd(verdict.costUsdPerMonth)} a month?!`,
        line: `I said ${formatUsd(verdict.budgetUsdPerMonth)}. Not a cent over.`,
      };
    case 'availability':
      return {
        exclaim: `${formatAvailability(verdict.availability)}?!`,
        line: verdict.lostOrders
          ? `Every one of those was a paying customer we turned away. We promised ${tierPercent('pass')}. See me after.`
          : verdict.staleReads
            ? `Customers saw out-of-date data. We promised ${tierPercent('pass')}. See me after.`
            : `We promised ${tierPercent('pass')}. See me after.`,
      };
    case 'praise':
      return BOSS_PRAISE[verdict.grade];
  }
}

const MENTOR_HINTS: Record<FailureReason, string> = {
  instance_down:
    'Ahem. A crashed server refuses connections instantly, no waiting around. So what could cover the gap until the health checks notice?',
  no_healthy_backend:
    'Nothing was left in rotation to take the traffic. How many instances could you lose and still serve everyone?',
  timeout:
    'Requests waited in line until they gave up. That box ran out of capacity. Make it bigger, add more of it, or send fewer requests its way?',
  overloaded: 'More requests arrived than that box can handle. Could the load be spread out instead?',
  stale_read:
    'Someone read an old copy. Replicas and caches both run behind the latest write: which reads can afford that, and what could tell a copy its value changed?',
  rate_limited:
    "The provider said no: you called faster than it allows. Does the customer have to wait for the charge, or could it happen a moment later?",
  queue_full: 'The queue ran out of room and turned orders away. Did it need more room, or faster draining?',
  deadline_missed:
    'Orders sat in the queue past the deadline. How fast must the workers drain it to clear the spike in time?',
};

/** Ms. Tally on the money left over. Fails get a grudging "at least". */
function bossSavings({ savedUsdPerMonth, share, grade }: SavingsSituation): string {
  const saved = formatUsd(savedUsdPerMonth);
  if (grade === 'fail') {
    return savedUsdPerMonth > 0 ? `At least it was cheap: ${saved} a month under budget.` : 'At least it was on budget.';
  }
  if (savedUsdPerMonth <= 0) return 'Every last cent of the budget. Bold. Do not make it a habit.';
  if (share >= 1 - PENNY_PINCHER_MAX_SPEND) return `${saved} a month to spare. Now that's engineering.`;
  if (share >= 0.05) return `${saved} a month under budget. I'll take it.`;
  return `${saved} under. Cutting it fine, but under.`;
}

const BADGES: Record<BadgeId, BadgeCopy> = {
  rightSized: {
    name: 'Right-sized',
    how: 'Pass a page for no more than its cheapest reference design costs.',
    role: 'boss',
    line: 'Exactly what it needed and not a cent more. Lovely.',
  },
  nPlusOne: {
    name: 'N+1',
    how: `Pass a page through a crash, with the surviving servers never over ${formatPercent(N_PLUS_ONE_MAX_AFTER_CRASH)} busy.`,
    role: 'troublemaker',
    line: 'hmph. I pulled the plug and nobody even broke a sweat.',
  },
  pennyPincher: {
    name: 'Penny Pincher',
    how: `Master a page spending at most ${formatPercent(PENNY_PINCHER_MAX_SPEND)} of its budget.`,
    role: 'boss',
    line: 'Five nines and change left over? Frame this receipt.',
  },
  fiveNinesClub: {
    name: 'Five Nines Club',
    how: 'Master every page in a chapter.',
    role: 'mentor',
    line: 'A whole chapter at 99.999%. Welcome to the club, kid.',
  },
  napkinWizard: {
    name: 'Napkin Wizard',
    how: `Get the napkin maths within 10% on ${NAPKIN_WIZARD_LEVELS} pages.`,
    role: 'mentor',
    line: `${NAPKIN_WIZARD_LEVELS} napkins, ${NAPKIN_WIZARD_LEVELS} bullseyes. No calculator? I'm impressed.`,
  },
};

function lockedLevel(situation: LockSituation): { role: CastRole; line: string } {
  switch (situation.kind) {
    case 'previousLevel':
      return { role: 'mentor', line: `One page at a time, kid. Pass p.${situation.levelNumber}, ${situation.title}, first.` };
    case 'chapter': {
      const more = situation.needed - situation.have;
      return {
        role: 'boss',
        line: `Chapter ${situation.chapterNumber} costs ${situation.needed} nines. You have ${situation.have}: earn ${more} more. Stars on earlier pages count.`,
      };
    }
  }
}

export const NOTEBOOK_SCRIPT: CastScript = {
  members: MEMBERS,
  bossBrief: (level) => `${formatUsd(level.requirements.budgetUsdPerMonth)} a month. Not a cent over.`,
  bossVerdict,
  troublemakerTease,
  troublemakerCrash: (nodeId, instance) => `${MEMBERS.troublemaker.name} pulls the plug on ${nodeId} instance ${instance + 1}`,
  troublemakerCacheRestart: (nodeId) => `${MEMBERS.troublemaker.name} reboots ${nodeId}`,
  troublemakerHotKey: (label) => `${MEMBERS.troublemaker.name} makes ${label} go viral`,
  mentorHints: MENTOR_HINTS,
  mentorSignOff: "Mistakes rub out. That's what I'm for.",
  mentorWelcome: 'Rule one, kid: every box you draw can break. Plan for it.',
  mentorPostmortemLead: `${MEMBERS.mentor.name} leans in:`,
  mentorChecks: ({ errors, warnings }) => {
    if (errors > 0) {
      return errors === 1
        ? "One thing stops this from running. Fix the red one and we'll see what breaks."
        : `${errors} things stop this from running. Start from the clients and work along the flow.`;
    }
    if (warnings > 0) return `Only warnings. It'll run, but read them before ${MEMBERS.boss.name} does.`;
    return "Looks runnable to me. Press Run and let's see what breaks.";
  },
  mentorLadder: MENTOR_LADDER,
  mentorLatency,
  failoverLines,
  mentorEstimate: MENTOR_ESTIMATE,
  bossSavings,
  badges: BADGES,
  lockedLevel,
  chapterOpened: (chapterNumber, title) => `Chapter ${chapterNumber}, ${title}, is open.`,
};
