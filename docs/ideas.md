# Five Nines: idea log

Ideas to review later. Nothing here is decided until it moves into `docs/design.md`.
Status: 💡 idea · 👍 liked · ✅ decided · ❌ dropped

Concept mockups: https://claude.ai/artifact/VgNEUw5zPv6DB2LAQDv9mu

---

## Cast 👍

Give each kind of pressure in a level its own character, so a failure becomes a character doing something rather than a random event.

| Role | Purpose in the game | Concept names used so far |
|---|---|---|
| **The boss** | Budget pressure and stakes. Delivers the level's "why" ("we got featured, don't fall over, don't spend money"). Reacts to cost on the result screen. | **Ms. Tally (notebook, chosen)**; Priya (CEO), Option A |
| **The mentor** | Hints in steps (where it broke → why → concept → solution), the napkin-math prompt, and the debrief voice. | **Erasmus (notebook, chosen)**; Mo (senior engineer), Chef Rosa (Option B), AXIOM the flight AI (Option C) |
| **The troublemaker** | Personifies the level's stress events: crashes, traffic spikes, hot keys, cache restarts. Teases the next chapter on the result screen. | **Smudge (notebook, chosen)**; Glitch the chaos gremlin (A), Bandit the raccoon (B), the GREMLIN-9 drone (C) |
| **The player** | A role with a reason to be there: new on-call engineer, pilot, and so on. | |

Open questions:
- 💡 How much dialogue? It could be short chat lines only, with no cutscenes.
- 💡 Should the troublemaker announce events in the briefing ("I might trip over something around minute one")? That's fair warning, and it adds personality.
- 💡 Voiced lines are out of scope for now. Text only.

## Rewards and progression 👍

- 👍 **Nines as the reward currency.** Each level pays out 3, 4 or 5 nines (pass, star, mastered), and nines unlock chapters. This ties scoring straight to the game's name.
- 👍 **A campaign map with chapters** that follow a story arc (e.g. a company growing from garage to worldwide). Each level is a node showing the nines earned.
- 👍 **Badges for good engineering habits**, not grinding:
  - "Right-sized": passed without overprovisioning
  - "N+1": kept spare capacity through a failure
  - "Penny Pincher": mastered while well under budget
  - "Five Nines Club": mastered every level in a chapter
  - 💡 "Napkin Wizard": estimate within 10% on several levels. The estimates are recorded per level in saved progress already; the badge itself isn't built.
- 💡 **A boss level per chapter:** capstone scenarios (URL shortener, region outage) framed as a big event.
- 💡 **Cost as a second score:** money saved under budget shown as a figure the boss reacts to.

## Gameplay and feel 💡

- ✅ **The napkin-math step as a mini-game:** the mentor asks "how many servers will you need?" before you build, with a bonus for being close. It covers back-of-envelope estimation. Built: see "Estimate step" in `docs/design.md`.
- 💡 **Incident chat during the freeze-frame:** the troublemaker admits fault, the boss panics, and the mentor gives hint 1 of 4. (Today the freeze-frame has the mentor's nudge and, after a crash, the failover arithmetic; the full four-step ladder is on the grade card.)
- 💡 **An in-world postmortem:** the incident card styled as a document, a receipt or a damage report, depending on the look.
- 💡 **Juice:** sound effects, a small screen shake on a crash, the slow-motion freeze, a "nines counter" that ticks up on a win, and a buzzing pager.
- 💡 **The error budget as a health bar,** or something themed (Option B's pizza losing slices).
- 💡 **Daily challenge:** one scenario per day, shareable result.
- 💡 **Per-level leaderboards:** the cheapest design that still hits five nines.
- ✅ **Explain latency failures during playback** (from the play-through): a high-utilization server shows why p99 rose. Built: see "Hints and iteration" in `docs/design.md`.

## Visual direction ✅

**G · Engineer's Notebook is the art style** (see "Art direction" in `docs/design.md`). The other options weren't chosen; they're kept here for reference.

| Option | Summary | Status |
|---|---|---|
| A · On-Call | Workplace comedy, sticker-cartoon style, night-indigo with warm accents | ❌ not chosen |
| B · Tiny Kitchen | Cozy diorama; the system as a pizza town (kitchens = servers) | ❌ not chosen |
| C · Mission Control | Neon arcade, CRT sci-fi, alarms and damage reports | ❌ not chosen |
| D · Night Shift Arcade | A's cartoon cast and humour with C's arcade drama: after-hours office turned arcade, warm pink/orange/teal neon. A crash shows "GAME OVER?" with a CONTINUE countdown | ❌ not chosen |
| E · Comic Book Postmortem | Chapters are comic issues; incidents told in panels with halftone shading and "KRZZT!" sound effects; the postmortem is the "Lesson" panel | ❌ not chosen |
| F · Pixel Ops | 16-bit pixel-art building with one floor per chapter; packets as envelopes with legs; a retro dialogue box with a portrait for hints | ❌ not chosen |
| G · Engineer's Notebook | Graph paper and ink doodles; root cause circled in red pen; the error budget as crossed-out tally marks | ✅ chosen |
| H · Toy Data Center | Isometric toy blocks on a game table; requests as marbles; the postmortem as a card you draw from a deck | ❌ not chosen |
| I · Prod Is Down | You're the on-call engineer in a startup's internal ops console. Levels are incident tickets (INC-0001…), nines are SLO badges, the cast talks in an incident channel (VP, staff SRE, a chaos bot), and the crash is a live dashboard with graphs and a postmortem doc | ❌ not chosen: too cluttered |

Principles so far:
- Keep real component names visible. The game teaches interview vocabulary, so any metaphor sits *alongside* the real terms, never instead of them.
- Personality comes from characters, humour and juice, not from hiding the engineering.
