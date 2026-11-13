# Five Nines: Design Proposal

Status: draft for review

Five Nines is a puzzle game that teaches system design. Players build an architecture, run a simulation against a level's requirements, and watch it pass or fail with a clear explanation of why.

---

## 1. Simulation model

### Use a flow model, with sampled requests for latency and visuals

Simulating every request as a discrete event is a poor fit. At 50k req/s over a 5-minute scenario that's about 15M requests per hop. Scaling the traffic down so each simulated request stands for many real ones would distort the tails, which are exactly what we grade. Instead:

- **Fluid queueing model, ticked every ~100ms of simulated time.** Each node tracks how fast work arrives (λ), how fast it can serve it (μ = instances × per-instance capacity) and its backlog: `backlog += (λ − μ)·dt`, never below 0. On top of the backlog, random queueing comes from the standard model of a pool of servers whose requests give up at the timeout (M/M/c+D, which reduces to Erlang C for long timeouts). Unlike plain Erlang C it stays finite at 100% utilization, so latency and timeouts rise continuously up to and through capacity. Above capacity the backlog grows, latency follows from Little's Law, and once the queue is full or the wait passes the timeout, requests become errors.
- **Success and error counts are exact fractions, not samples.** This matters for grading. Checking 99.999% means detecting about 1 bad request in 100k, and sampling can't resolve that.
- **A few hundred sampled "probe" requests per tick** walk the graph using each node's current state. They give us p99 across multiple hops, which has no closed form, and they are the dots the player sees moving.
- **Deterministic.** Use a seeded random generator and failures that the level scripts at fixed times. Compute the whole run up front in a Web Worker, then play it back. That makes scrubbing, instant re-runs and "skip to result" free, and grading reproducible.

The queueing math supplies the most important lesson for free: latency curves up sharply as utilization nears 100%, so players work out "keep it around 70%" on their own.

### Current model simplifications

Known shortcuts in the engine as built. Each one should either stay documented in-game or be removed when a level needs it.

- The timeout applies to time spent waiting in a queue, not to end-to-end latency.
- A request waits the longer of the backlog and its random queueing delay, not their sum: the two are views of the same queue. Above capacity the random part is that of a fully loaded station, since the backlog takes the excess.
- Random queueing is in steady state at the current load, even right after the load changes. At full load that means about one request in λ·timeout times out at once, where a real queue would take a while to build up that far.
- Requests that time out don't use any CPU. Real servers often keep working on requests the client gave up on, which makes overload collapse worse.
- Health checks only detect crashed instances, not overloaded ones. Real health checks that time out under load can remove healthy-but-busy instances and cascade.
- Load balancers retry only refused connections, once, on another instance.
- Every request makes exactly one trip to the data tier (when the level has one): a read or a write, by the level's read share. Each station (app server, cache, database, replica) has its own queue and its own timeout; an app server doesn't hold a vCPU while it waits on the database.
- Caches are cache-aside. Each key's chance of being cached is `min(1 − e^(−p·reads so far), rT ÷ (1 + rT))` for a key with read share p, read r times a second, TTL T; the cache keeps the most popular keys that fit (`memory ÷ value size`). Key popularity is Zipf, summed exactly over the top 64 keys and by Simpson's rule in log space beyond.
- A miss refills its key only when the database answers it, so a key keeps missing for `r × fill delay` reads, where the fill delay is the database's queueing wait in the previous tick. That is the thundering herd: when the database backs up, even popular keys miss again and again. Request coalescing sends only the first of those misses to the database; the rest wait on its fetch (counted like hits for staleness, with the fetch's wait added to their latency).
- A cache restart (a scripted event) empties the busiest cache at once, with no downtime; a replicated cache keeps its contents.
- Without invalidation a write leaves any cached copy in place until its TTL expires. With invalidation on write, a value lives `(1 − e^(−wT)) ÷ w` on average (w = its key's write rate) and every write costs the cache one operation. The race between an invalidation and a refill in flight is ignored.
- The age of a cache hit is taken as uniform over the TTL. A cached value is stale under a level's staleness limit if its key was written since it was cached, more than the limit ago. With invalidation, a hit can only be stale by the lag of the source it was fetched from.
- Shards split the data tier's reads and writes by the shard key's spread: a sequential key (a timestamp) sends everything to the newest shard; a hashed key places its 64 most popular values on shards by a fixed hash and spreads the rest evenly. A hot key event gives one value a share of all operations, on its shard, for a while. Each shard is a database with its own queue.
- Payments go to an external provider with a rate limit, synchronously (calls over the limit fail as `rate_limited`) or through a queue. A queue answers the producer in 2 ms and holds messages in arrival order, refusing new ones when full (`queue_full`). Its workers drain `workers × 30 ÷ provider latency` messages a second, sharing the provider's limit with any direct calls. A message that waits past the level's deadline fails as `deadline_missed`; at the end of the run, messages still queued are projected forward at the drain rate and the ones that would miss the deadline fail too.
- A level has either a data tier or payments, not both.
- The database is costed in read-equivalents: a write costs `readsPerSec ÷ writesPerSec` reads. A replica serves `reads ÷ count` and replays every write at half what it cost the primary. Its lag is `0.2 s ÷ (1 − utilization)` (utilization capped at 98% for this), plus a backlog that grows by `1 − 1/utilization` seconds per second while it's overloaded and drains by `1/utilization − 1` per second after.
- A read-after-write read is stale if its gap since the write (exponential, the level's mean) is under the replica lag and outside the read-your-writes window.

### Workload model

The workload model is what keeps "add a cache" from fixing everything. Each level defines:

- the request rate over time (spikes are part of the scenario)
- the read/write mix
- the **key distribution**: a Zipf skew parameter and the keyspace size. This decides whether a cache helps.
- the static vs. dynamic content fraction (decides whether a CDN helps)
- client regions (for multi-region levels)

### Components (MVP set)

| Component | Key knobs | Honest behaviours to model |
|---|---|---|
| Load balancer | health-check interval, retry on failure | sends traffic to a dead node until the health check catches it |
| App server | size (vertical), count (horizontal) | each server holds DB connections, so many servers can exhaust the DB's connection limit |
| Cache | memory size, TTL, request coalescing, invalidate on write, replicated | hit rate = share of requests that hit the top-C keys (C = how many keys fit in memory). Starts cold, warms up, and a restart wipes it. Built: all knobs; 100k lookups/s at every size; a replica doubles the price |
| DB primary | size | separate read and write capacity, plus a connection limit. Built: size only, reads and writes share one machine (no connection limit yet) |
| Read replicas | size, count, read-your-writes window | serve reads only; replication lag grows with load |
| Shards | size, count (2–16), shard key | a hot key puts all its load on one shard. Built; each shard priced as a database |
| Queue + workers | max depth (queue size), worker count | fast response to the producer, but the backlog has a deadline. Built; $60/month per worker, 30 charges in flight each |
| Payment provider | none (placed so the player draws the call) | refuses calls over its rate limit; free. Built |
| CDN | cache rules | absorbs the static share at the edge with low latency, which cuts load on the servers (the origin) |

### Availability and cost

- **Availability is request-based** (the standard approach from Google's SRE practice): good requests / total requests over the scenario. A request is good if it succeeds and doesn't time out. Example: a 300-second scenario at 10k req/s is 3M requests. Five nines means **at most 30 failures**, which is a concrete and legible budget. Show it as an error-budget bar that drains during the run.
- **Grades:** 99.9% to pass, 99.99% for a star, 99.999% to master the level. Cost efficiency is a possible second axis.
- **Cost** is a monthly $ figure per instance, with real-ish prices. The budget on every level stops the player from simply overprovisioning everything.

### Consistency model

Consistency is taught through the same grading as everything else: **a wrong answer is a bad request**. A read that returns data the level's requirements consider stale fails with the reason `stale_read`. It counts against availability and appears in the postmortem like any other failure. A fast system that shows a user the wrong bank balance hasn't served them.

What the engine needs for this:

- **Read-after-write traffic.** The workload says what share of reads come from a user reading something they just wrote, and how soon after the write (an exponential gap with a level-defined mean). Other reads only care about bounded staleness, if the level sets a limit at all.
- **Replication lag that responds to load.** Replicas apply the primary's writes with a small base lag. The lag grows when a replica is busy or the write rate approaches what it can apply, and it grows without limit if replicas can't keep up. A read served by a replica is stale if the write it needs is newer than the current lag. The chance of that follows from the gap distribution, so it stays an exact fraction like every other failure.
- **Routing choices the player makes:** send reads to the primary, to replicas, or to replicas except for a user's reads within N seconds of their own write ("read-your-writes" pinning). Pinning sends extra load to the primary, which has to be sized for it.
- **Cache staleness.** A cache entry is stale between a write and its expiry (TTL) or invalidation. Invalidating on write keeps the cache correct at the cost of more misses; a long TTL keeps the hit rate high and serves stale data.
- **Delivery semantics.** Queues deliver at least once, so a consumer that crashes mid-task can process a message twice. A duplicate payment counts as a failure (`duplicate_effect`) unless the consumer is idempotent (it records an idempotency key and ignores repeats).

### Keeping the simulation honest

Every level ships with **reference solutions that must pass** and **anti-solutions that must fail** (e.g. "throw a cache at it", "just max out the instances"). These run as automated tests in CI. It's the single most important tool for a solo developer tuning content.

---

## 2. First levels

Grading is by outcome, so any design that meets the requirements passes. The reference solution only appears in the debrief.

1. **Hello, Traffic** (vertical scaling, utilization)
   - Requirements: traffic climbs to 350 req/s, p99 < 75ms, $250/month.
   - Intended solution: one large server (44% busy). Each wrong size fails a different check: small overloads, medium is never overloaded but fails latency at about 88% utilization, and xlarge blows the budget. Introduces the latency curve.
2. **Scale Out** (horizontal scaling, load balancing)
   - Requirements: 5k req/s. The largest single instance can't handle it, or costs more than several smaller ones.
   - Intended solution: a load balancer plus N app servers.
3. **Pull the Plug** (redundancy)
   - Scenario: an app server dies at t=60s.
   - The trap: N+1 servers alone still fail. Even with a 5-second health check, a fifth of the traffic goes to the dead node for about 9 seconds: roughly 1% errors over the run, so 99.0% availability.
   - Intended solution: N+1 servers **plus retry-on-failure at the load balancer**. The debrief shows the arithmetic: health checks alone don't get you nines.
4. **Read All About It** (caching)
   - Workload: 6k climbing to 20k req/s over the first minute, a breaking-news spike to 26k at 125–150 s; 95% reads over 2M articles of 100 KB, Zipf 1. p99 ≤ 50 ms, $1,400/month.
   - The biggest database the budget allows (large) does 10k reads/s, about half the reads.
   - Intended solution: an 8 GB cache (80,000 articles, about 79% of reads once warm, 76% over the run) with a 5-minute TTL in front of a large database. Anti-solutions: no cache (with a large or xlarge database), a 2 GB cache (69%, fails in the spike), a 10-second TTL.
5. **Cache Miss** (when caching doesn't help)
   - Workload: 6k climbing to 20k req/s, 96% reads, uniform keys over 100M profiles, so even the biggest cache hits about 1%. Staleness limit 1 s, $2,800/month.
   - Intended solution: a medium primary and three large read replicas (peak lag about 0.8 s). Anti-solutions: the biggest cache, the biggest database alone, two large replicas (they overload, the lag runs away and reads go stale). The debrief shows the player's cache hit rate.
6. **Bank Balance** (read-your-writes consistency)
   - Workload: a banking app, 12k req/s with a payday spike to 20k at 90–130 s, 95% reads. 20% of reads are users checking their balance after a transfer (mean gap 1.5 s). The primary alone can't serve every read. $2,400/month.
   - The traps: sending all reads to replicas shows users their old balance, which fails as stale reads. Sending all reads to the primary overloads it. Pinning with a window shorter than the lag passes at normal load, then fails when a traffic spike makes the lag grow.
   - Intended solution: replicas for reads, read-your-writes pinning with a window longer than the worst-case lag, and a primary sized for the pinned reads: a large primary and two large replicas pinning for 5 s (peak lag about 1.9 s). A 1-second window passes at normal load and fails on payday; a medium primary can't take the pinned reads.
7. **The Write Wall** (sharding)
   - Workload: a social app's writes, 12k climbing to 15k writes/s, no reads. Three shard keys to choose from: time posted (sequential), post ID (1B posts, Zipf 0.9) and user ID (50M users, Zipf 0.6). At 100–140 s a celebrity's post takes 25% of all writes. p99 ≤ 50 ms, $3,500/month.
   - Estimate: 15,000 writes ÷ 4,000 per large shard = 3.75 shards at full load.
   - The traps: the biggest database (xlarge, 8k writes/s) runs at 188%; replicas don't take writes; sharding by time posted sends every write to the newest shard (375%); sharding by post ID is even until the celebrity posts, then one shard runs at 153% for 40 seconds.
   - Intended solution: shard by user ID: five large shards ($3,385 with the app tier) or ten medium ones. Deviation: the hot key is part of the main grade rather than a separate star objective, so the naive key is an anti-solution.
8. **Thundering Herd** (cache stampede)
   - Workload: 4k climbing to 30k req/s, 99% reads over 1M keys (Zipf 1.1); the busiest cache restarts at t=90s. A small cache with a 5-minute TTL catches nearly every read while warm. $2,000/month.
   - Estimate: at 90 s every read misses: 30,450 read-equivalents on a large database, about 305% busy.
   - The traps: a medium database sized for the warm cache (609% at the restart); a large database alone (refills queue behind the misses, so popular keys keep missing and about 12,600 requests time out); coalescing in front of a medium database (times out for about ten seconds); no cache and the biggest database.
   - Intended solutions, all mastered: coalescing misses in front of a large database; a replicated cache in front of a medium one; an xlarge database that absorbs the burst.
9. **Stale Prices** (cache invalidation)
   - Workload: a store catalogue, 6k climbing to 24k req/s, 99.8% reads over 1M products (Zipf 1); prices change 48 times a second. A price may be at most 5 seconds old. $900/month.
   - Estimate: the cache hit rate a medium database needs: 79.6%.
   - The traps: a 60-second TTL hits 83% and serves stale prices to a third of requests; a 5-second TTL hits 67% and overloads the medium database (162%); a 5-second TTL on a large database breaks the budget.
   - Intended solution: invalidate on write with a 5-minute TTL, a small cache and a medium database ($835). A 5-second TTL option was added to the TTL choices for this level's trap.
10. **Flash Sale** (async processing with queues)
    - Scenario: 1k orders/s, then 10k/s for 30 s from t=60s. The payment provider takes 2,500 charges a second at 300 ms each. p99 ≤ 200 ms, every order charged within 2 minutes, $2,100/month.
    - Estimate: 300,000 sale orders must all be charged within 150 s of the sale starting: 2,000 a second.
    - The traps: charging synchronously (300 ms per request, and three charges in four refused during the sale); 10 workers (1,000 a second, so orders miss the deadline from about t=190s); a 100,000-message queue (full twelve seconds into the sale); 30 workers (the provider caps them at 2,500, and the unused five break the budget).
    - Intended solution: a large queue and 22 workers ($1,945). Deviations: the deadline is 2 minutes, not 5 (a 30-second spike never threatens a 5-minute one), and the provider is a component the player places, so the synchronous call is something they draw.
11. **Double Charge** (at-least-once delivery and idempotency, post-MVP)
    - Scenario: the Flash Sale design, but a payment worker crashes mid-batch and its messages are redelivered. Charging a customer twice counts as a failure.
    - Intended solution: idempotent payment processing with an idempotency key. This pays off level 3's note that retrying requests that may already have been processed is a harder problem.
12. **Around the World** (CDNs)
    - Scenario: global users, 70% static assets, p99 < 100ms.
    - Intended solution: a CDN in front of the servers. The origin can't meet the latency from far away.
13. **Capstone: URL Shortener** (multi-region, post-MVP)
    - Scenario: first a whole region fails, then the link between two regions breaks while both stay up (a network partition).
    - Intended solution: 99.9% is achievable in one region, but the five-nines grade requires active-active across regions.
    - The consistency choice during the partition: keep accepting writes in both regions and accept conflicts, or reject writes on one side and lose availability. Short links tolerate the first. A follow-up level with a payments ledger requires the second. This is the CAP theorem made concrete.

Later levels: retry storms (retries multiply load during an outage), a rate limiter, a news feed (fan-out on write vs. fan-out on read), and chat (long-lived connections).

---

## 3. UX

### Build

- Node-graph canvas, a component palette, and an inspector panel for each node's settings.
- A live cost meter that's always visible.
- Show each component's capacity numbers, and its **expected peak utilization** with the arithmetic beside it (built): a gauge in the inspector (green under 70%, amber to 85%, red above, hatched past 100%) and a small dial on each node. It's load ÷ capacity at the level's peak, worked out on paper (`peakLoad` in `sim`): load-balancer fan-out, the best cache hit rate the run allows, the read/write split to the primary and replicas, and what the level's crash leaves. It never predicts p99: utilization is the number to reason with, latency is what the run shows. A queue's gauge reads its backlog against the deadline or its room, whichever is closer, worded as such rather than as p99. In a level whose cache restarts, a database also shows its load the moment the cache comes back empty. The napkin-maths step (below) asks for the arithmetic before the gauge gives it away.

### Estimate step (covers back-of-envelope estimation)

- Before building, the mentor asks one question, e.g. "how many app servers will you need?" or "what cache hit rate do you need to protect the database?" (built). Each level's `estimate` names a quantity worked out from its own numbers (`estimate.ts`); the recorded answer is checked against that working in CI.
- The player answers or skips, and sees the working. An estimate within ±10% earns a bonus mark, kept in saved progress for the Napkin Wizard badge. The step can be reopened from the top bar.
- Not yet: the debrief comparing the estimate to what actually happened.

### Progression and rewards (built)

Pure functions in `packages/web/src/progression/`, over saved progress and run results; the theme only words and draws them.

- **Nines are the currency.** A level pays the nines of its best grade: 3 for a pass, 4 for a star, 5 for mastered (50 across the ten built levels; each new level adds 5). Replaying never pays twice, only a better grade pays the difference. The contents page shows the running total; the grade card ticks it up one nine at a time.
- **Unlocks.** A level opens when the one before it is passed. A chapter also needs enough nines in total: Growing Pains 10, Hypergrowth 22, Worldwide 36 (every earlier page passed plus one, four and six tiers above a pass). A level the player already has a grade on always stays open, so older saves (from builds where everything was open) lose nothing. Locked pages show on the map with a padlock and say what opens them. `?unlock=all` before the `#` opens everything for testing, without touching the save.
- **Badges** (once earned, kept):
  - *Right-sized*: passed for no more than the level's cheapest reference solution costs. Judged by cost rather than by how busy the machines are: sizes come in fixed steps, so a right answer can sit well under the 70% the game teaches (level 1's large server is 44% busy), and a busyness floor would reward running hot. No tolerance: costs are exact catalogue sums. A test checks every level's cheapest reference earns it.
  - *N+1*: passed a level with a scripted crash, the crashed node's survivors never above 85% (the hot line) afterwards.
  - *Penny Pincher*: mastered for at most 80% of the budget.
  - *Five Nines Club*: mastered every level of a chapter.
  - *Napkin Wizard*: the estimate bonus (within 10%) on 3 levels.
  The contents page shows earned and unearned badges with how to earn each; the grade card stamps new ones, handed over by a cast member.
- **Cost as a second score.** The grade card shows the money left under budget, and the boss reacts to it.
- **Saved progress** is versioned inside its key (`five-nines:v1`, version 2 adds badges). A version 1 save loads intact and is awarded the badges its grades and estimates already earn. A save the build can't read is copied to `five-nines:unreadable-backup` before anything could overwrite it, and if that copy fails the game doesn't write at all.

### Juice (built)

Everything respects `prefers-reduced-motion`; sound is off until the player turns it on (a toggle on every screen, kept in its own `five-nines:settings` key).

- The page shakes when the troublemaker breaks a machine during playback (a crash or a cache restart; playing through it, not scrubbing), and the pager buzzes for every strike.
- Easing into the freeze-frame darkens the page around the drawing; the incident, the grade and new badges land as ink stamps.
- Sounds are synthesised with the Web Audio API, no files: a page turn between screens, a pen scratch for hints and estimates, a pencil tick per nine, a stamp for grades, badges and the incident, a pager buzz, and a win chime. The game names the moment (`SoundCue`); the theme supplies the sound.

### Run

- Request dots along the edges, with density proportional to rate. Colour shows type (read, write, cache hit), and failed requests show as red ✕ that drop away.
- Each node shows a utilization ring and a queue-depth bar.
- A timeline strip shows req/s, p99, error rate and the error budget, with scripted events marked ("t=60 app-2 dies").
- Controls: play, 1×/4×/16× speed, and scrub.

### Fail

This should feel like Poly Bridge's slow-motion collapse.

- Automatically slow down and freeze at the moment the SLO breaks.
- Move the camera to the root-cause node and play a short cascade, e.g. *DB primary 140% utilized → queue 4k deep → p99 2.3s → LB timeouts*.
- This needs the engine to **record why each request failed**: queue full, timeout, node down, connection pool exhausted, stale read. The root cause is the one that spent the error budget: the cause with the most failures by the time the budget ran out. Order of onset alone misleads (a trickle of stale reads from replicas nearing full load starts before the overload that actually exhausts the budget).
- Show it as an incident-postmortem card. Engineers will recognize the format.

### Hints and iteration

- A hint ladder: *where* it broke → *why* → the concept → the fix (built, on the grade card of a failed run, one rung at a time). The game derives the failure story from the first failed check and its numbers (`failureStory` in `theme/situations.ts`); the theme words where and why from those numbers and supplies a concept and fix per level and kind of failure. The full reference solution stays in the debrief, after an attempt.
- Latency is explained with real numbers (built): while p99 nears or passes the limit, playback notes which machine was busiest and how busy ("p99 hit 120 ms while app was 87% busy"), and the grade card's hints quote the run's worst second.
- Crashes show the failover arithmetic (built): when the instance died, the health-check interval, when the load balancer took it out of rotation, and the requests lost meanwhile against the 0.1% a pass allows. So shorter health checks visibly shrink the window without closing it.
- Re-running must take one keystroke and leave the layout untouched. Fast iteration is the whole game.

### Debrief

- A card explaining the concept.
- The player's design vs. the reference, side by side: cost, nines, p99.
- An "in real life" note (e.g. Memcache leases for the stampede level).
- An "in the interview, say…" tip.


### Art direction

**The engineer's notebook.** Every screen is a page in a spiral-bound notebook: graph paper, ink doodles of real components, hand-lettered headings. The error budget is a row of tally marks crossed out as requests fail, the postmortem is a sticky note with the root cause circled in red pen, the result is a marked page, and the campaign map is a hand-drawn trail through the chapters. Real component names stay visible next to every doodle.

Text in the notebook is at least 12px as rendered and 4.5:1 against its paper; `test/contrast.test.ts` measures the rewards screens and the chapter 3 readouts from the stylesheets and tokens.

**The cast, by role.** The game only ever asks for a role; the notebook supplies the character:

| Role | What the game asks for | Notebook character |
|---|---|---|
| Boss | the budget brief, the verdict on a graded run | Ms. Tally, a pencil with a tally-marked body |
| Mentor | a hint per failure reason, the take on design checks, the postmortem nudge | Erasmus, an eraser with a moustache |
| Troublemaker | the tease for a level's stress events, credit for crashes | Smudge, an ink blot |

Lines are always worded from what actually happened: the game derives the situation (the level's first crash or spike, the check that failed), the theme only words it.

**The theme boundary.** Everything style-specific (art, character names and lines, words such as "page" for a level, and all CSS, with raw colours only in its tokens) lives in one folder, `packages/web/src/theme/notebook/`. Screens reach it only through `theme/index.ts`, which selects it statically and exposes the slots of the `Theme` contract (`theme/contract.ts`): the cast script and speech bubble, component art, budget meter, postmortem card, grade card, campaign map, badge shelf, small marks and sounds. A new art style is a new folder implementing that contract, plus its favicon and font links in `index.html`. There is no runtime theme switching.

---

## 4. Tech stack and MVP scope

### Stack

- **TypeScript + Vite, running in the browser, static hosting**, with no backend for v1. Save progress in localStorage, and make designs shareable by encoding them in the URL.
- **`sim/` as a pure TypeScript package** with no DOM dependencies. It runs in a Web Worker and is tested heavily with Vitest, including the reference/anti-solution tests for each level. This package is the product. Build it first, headless, with a small command-line runner that grades a level from a JSON design.
- **Levels as data**: JSON or TypeScript files validated with a Zod schema.
- **UI**: React for the panels, React Flow (xyflow) for the graph editor, and a Canvas2D overlay synced to the viewport for the request dots. SVG/DOM can't animate thousands of particles. Zustand for state, uPlot for the timeline.
- **Why not Godot or Unity:** the game is mostly UI and text. Web tooling is better at that and gives shareable links.

### MVP scope

- **In:** the 8 components above, levels 1–10 (including the Bank Balance and Stale Prices consistency levels), the estimate step, run and playback, the failure postmortem, the debrief, and star grading.
- **Out:** accounts, leaderboards, sandbox mode, multi-region, mobile.

### Order of work

1. The engine plus levels 1–3, all headless.
2. Tune the numbers until the anti-solutions fail for the right reasons.
3. The editor and playback.
4. Failure UX.
5. Levels 4–8.

---

## 5. Risks and open questions

### Risks

- **Levels turn into slider-tuning.** If "increase the count until it's green" works, the puzzle is dead. The fix is that every level's answer should be a topology change, enforced by budgets and workload shape. Playtest specifically for this.
- **Calibration.** Real-ish magnitudes matter for transfer to interviews (e.g. Redis ~100k ops/s, Postgres ~10k simple reads/s), but they have to make puzzles that work. Expect most of the tuning time here. The CI tests keep it sane.
- **Unclear root causes in cascading failures.** Blaming the cause that spent the most of the error budget can still mislead when one failure causes another at a different node. Hand-check the postmortem text on every level.
- **Model blind spots.** The model ignores GC pauses, network partitions and noisy neighbours. That's acceptable if an in-game "model assumptions" page says so.

### Decisions

1. **Cost uses real dollars.** Component prices are monthly USD, loosely based on public cloud on-demand prices.
2. **Timeouts and retries become player-configurable in later levels.** Early levels get a single, narrow knob: load-balancer retry on connection failure (level 3).
3. **Data modelling is out of scope.** Five Nines teaches the scaling part of a system design interview.
4. **Grading is by outcome.** Any design that meets the requirements passes. Each level still has an in-game **solutions** section with one or more annotated reference designs. Players can open it after attempting the level to compare against their own design. Levels also list known wrong answers ("anti-solutions"). CI uses them to prove that the obvious mistakes fail, and the debrief can use them as "common traps".
5. **Consistency is part of the curriculum.** Stale reads and duplicate effects count as bad requests (see the consistency model in section 1). The consistency levels are Bank Balance (6), Stale Prices (9), Double Charge (11) and the capstone's network partition (13).

### Open questions

None right now.
