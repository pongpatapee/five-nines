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

Levels are listed here by id. Ids are permanent (saves key on them) and numbered in the order levels were written, so play order (`LEVELS`, and the page numbers players see) can differ: Everything Links, id 11, is played fourth, as page 4. Each chapter can end in a **capstone**, its launch day (`Chapter.capstoneId`, which must be the chapter's last level): a product in the story that combines the chapter's lessons, marked "launch day" on the map and on its page.

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
**Capstone, chapter 1: Everything Links** (id `11-everything-links`, page 4; a URL shortener on launch day)
   - Workload: 1k climbing to 3k req/s by 30 s, held for a 3-minute run; 5 ms of CPU each, then one database request: 95% redirects (reads), 5% new links (writes) over 20M links, Zipf 1. At some point the busiest app server crashes. p99 ≤ 40 ms, $1,300/month.
   - It introduces the database ("same 70% rule, different machine") before chapter 2 builds on it. No engine change.
   - Estimate (`databaseBusyAtPeak`, new): 2,850 reads + 150 writes × 2.5 = 3,225 read-equivalents, 64.5% of a medium database (5,000), 129% of a small.
   - The traps: a small database (overloaded: 79.9% available); no retries at the load balancer (95.6%); no spare app server (three large, fine until the crash, then p99 48.7 ms); a large database (32% busy, but $1,585).
   - Intended solutions, both mastered: six medium app servers (63% busy, 75% after the crash) behind an ALB with retries and a medium database, $1,045, p99 32 ms; or four large app servers, $1,285, p99 27 ms. The six-medium design is the cheapest reference, so it earns Right-sized, and N+1. Penny Pincher's line is $1,040, $5 under it, so that badge is out of reach here, on purpose: the budget leaves room for the four-large answer.
   - The debrief's interview tip: short codes from a base-62 counter versus random codes and collisions (not modeled).
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
   - Estimate: at 1:30 every read misses: 29,700 reads a second on a large database that does 10,000, 2.97 times its capacity (with the writes, about 305% busy).
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
13. **Everything Links Worldwide** (multi-region, post-MVP; was the URL-shortener capstone, before Everything Links took chapter 1)
    - Scenario: first a whole region fails, then the link between two regions breaks while both stay up (a network partition).
    - Intended solution: 99.9% is achievable in one region, but the five-nines grade requires active-active across regions.
    - The consistency choice during the partition: keep accepting writes in both regions and accept conflicts, or reject writes on one side and lose availability. Short links tolerate the first. A follow-up level with a payments ledger requires the second. This is the CAP theorem made concrete.

Later levels: retry storms (retries multiply load during an outage), a rate limiter, a news feed (fan-out on write vs. fan-out on read), and chat (long-lived connections).

---

## 3. UX

### Title page (built)

The game opens on the notebook's cover, a glance at the world before the first page (`TitlePage` in the theme contract; screen `screens/TitleScreen.tsx`).

- **What it shows.** A kraft cover with a paper label: the sticky-grade logo, large, and "Five Nines"; under it "An engineer's notebook on scale". Printed on the board, a poster credit: "Starring" small, "Everything Labs" large. Chad Visionary with one line, "I don't want five nines. I want all the nines.", with Ms. Tally, Erasmus and Smudge doodled small beside him. About 25 words beyond the title (26 or 27 with the buttons, budget 28).
- **One way on.** A new player gets "Start your first day", which opens page 1; its chapter's all-hands opens first by itself, as it would from the contents, so there is one way into the story. Anyone who has begun (graded a run or seen an all-hands: `hasStarted` in `screens/campaign.ts`) gets "Continue as <their title>", to the contents. The button has the focus as the page opens, so Enter takes it. A "Contents" link is always beside it, and the sound toggle sits at the top of the page.
- **Routes.** The root (no hash or `#/`) is the title page, and the contents moved to `#/contents`. Deep links (`#/level/…`, `#/all-hands/…`) go straight to their screen, and `?unlock=all` still works. The contents page's wordmark leads back to the cover; the level screen's top-bar logo still leads to the contents. No save fields: whether the player has begun is read from the save as it is.
- **Motion.** The cover settles in and the bubble pops in, in under half a second, and neither waits for the other or holds up Enter. Both are off under `prefers-reduced-motion`.
- **Narrow screens.** The cover's single column may shrink below its content; under 640px the elastic band and the side doodles drop, and under 400px the founder stands above his bubble. Checked at 320, 375 and 606px with no sideways scroll.

### Play first (built for chapter 1)

Players should reach the canvas and press Run within seconds, and learn each idea where it bites: after a failed run, on the canvas, in the debrief and in the field guide, not in a wall of briefing prose.

- **The flow.** Title page ("Start your first day", Enter takes it) → all-hands (one panel, Enter or Esc skips it) → the level, straight onto the canvas → build and Run → a failed run's result opens on the mentor's callout → a pass shows how the design compares with the other designs that pass. Napkin math is opt-in, never a gate. Measured in Chrome: Enter on the all-hands puts the canvas and its Run button on screen in about 70 ms.
- **The all-hands** is one panel: the founder's doodle, Doug's stamp, two or three speech bubbles, and a big "Let's go" that names where it leads. Later chapters' stage directions and margin notes sit small among the bubbles.
- **The briefing card** (`BriefingCard` in the theme contract): one line from the founder, one goal line, one margin line from Erasmus, then the numbers drawn (`NumbersCard`): a sparkline of the level's traffic with its start and peak rates, a chip for the work per request (CPU, the read share, the provider's limit), an icon per event, named never timed, and a badge per requirement (p99, availability, budget, plus staleness, own writes and charging where the level has them). Behind a "more" toggle: a coworker's sticky note, the boss's brief, the plain briefing, the full numbers box, the troublemaker's tease and the component reference card. A level whose memo has no goal line (chapters 2 and 3 today) keeps "more" open, so its longer briefing stays in view; adding a goal line in `story.ts` moves a level onto the play-first card with no code change.
- **The napkin challenge** is a button on the briefing card, "Estimate first for a bonus", which becomes "Napkin bonus earned" once it is. Closing the step unanswered (Esc or "Not now") records nothing; "Skip" still shows the working. The bonus and the Napkin Wizard badge work as before.
- **On the canvas.** Each node's small dial says a word once it passes a line: "busy" from 70%, "too busy" from 85%, "overloaded" past 100% (`ZONE_SHORT_WORDS`; a queue says "building", "near limit", "over limit"). While building it reads the expected peak; during playback it reads the node's busiest machine that second. When the troublemaker strikes, a one-line note is pinned above the node it struck for 12 simulated seconds ("Smudge unplugged instance 2"; `recentStrikes` in `theme/situations.ts`). It sits above the node, clear of the handles on its sides.
- **The callout.** A failed run's result opens with one line from the mentor, worded by `mentorCallout` from the run's `FailureStory`: the node or the requirement that failed, with the run's own numbers ("app was 175% busy, over capacity. Requests queued until they timed out."). The root-cause node stays circled on the canvas behind the grade card. The four-rung hint ladder follows for those who want more.
- **The trade-off line.** After a pass, and only then, so it never spoils: the player's design in a few words with its cost, and every reference solution that chooses differently ("Your design: 6 medium servers (1 spare), load balancer + retries, medium database, $1,045/mo (the reference design). Also passes: 4 large servers (1 spare), …, $1,285/mo"). `designComparison` in `theme/situations.ts` boils each design down to its choices (parts, sizes, counts, cache and replica options, a load balancer and its retries, and in a level with a crash whether the app servers still keep up after losing one, from `peakLoad`); the theme words them.
- **Where the explanations went.** The concepts the old briefings explained now live in the callout (what failed and why), the debrief (three short bullets), and the field guide, which gained two concepts: *Scaling up and out* (from page 2) and *A spare server (N+1)* (from page 3).

### Word budgets (chapter 1, enforced by `test/word-budget.test.ts`)

| Text | Budget | Chapter 1 now |
|---|---|---|
| The founder's line on the briefing card | ≤ 20 words | 11 to 16 |
| The goal line | ≤ 20 words | 10 to 14 |
| Everything visible on the briefing card before "more" (rendered, without the numbers drawn) | ≤ 60 words | 47 to 52 (was 100 to 206 before building, plus the napkin question) |
| All-hands bubbles | ≤ 45 words in all | 40 (was 102 words of scene) |
| The failure callout, on every known wrong answer | ≤ 25 words | 10 to 21 |
| The debrief | ≤ 3 bullets of ≤ 30 words | 3 bullets, 21 to 30 words (was 3 to 5 paragraphs of up to 71) |
| The title page, beyond "Five Nines" (rendered, buttons included, the sound toggle not) | ≤ 28 words | 26 or 27, by the player's title |

Plain American English, short and concrete; only the founder is funny. Later chapters may keep their longer copy until they get goal lines.

### Build

- Node-graph canvas, a component palette, and an inspector panel for each node's settings.
- A live cost meter that's always visible.
- Show each component's capacity numbers, and its **expected peak utilization** with the arithmetic beside it (built): a gauge in the inspector (green under 70%, amber to 85%, red above, hatched past 100%) and a small dial on each node. It's load ÷ capacity at the level's peak, worked out on paper (`peakLoad` in `sim`): load-balancer fan-out, the best cache hit rate the run allows, the read/write split to the primary and replicas, and what the level's crash leaves. It never predicts p99: utilization is the number to reason with, latency is what the run shows. A queue's gauge reads its backlog against the deadline or its room, whichever is closer, worded as such rather than as p99. In a level whose cache restarts, a database also shows its load the moment the cache comes back empty. The napkin-math step (below) asks for the arithmetic before the gauge gives it away.

### Estimate step (covers back-of-envelope estimation)

- Opt-in, from the briefing card's "Estimate first for a bonus" (or the top bar), the mentor asks one question, e.g. "how many app servers will you need?" or "what cache hit rate do you need to protect the database?" (built). It no longer opens by itself on a first visit. Each level's `estimate` names a quantity worked out from its own numbers (`estimate.ts`); the recorded answer is checked against that working in CI.
- The player answers or skips, and sees the working. An estimate within ±10% earns a bonus mark, kept in saved progress for the Napkin Wizard badge. The step can be reopened from the top bar, and once answered or skipped the briefing has a "Show the napkin working" link straight to the working.
- The working is a worked solution, not a formula: `napkinSolution` (`estimate.ts`) lists the steps in order, each with its numbers and result (find the peak, split reads from writes, what one write costs in reads, ...), ending on the answer, plus a takeaway with numbers for the design (headroom to the 70% and 85% lines, whole machines, the hit rate that keeps the database below full). The theme says why each step is taken and writes its arithmetic; the notebook inks numbered steps, runs highlighter over each result and boxes the answer in red pen. CI checks every level's steps end on its answer, and that no step leans on shorthand it never explains ("read-equivalents").
- One question per level, answered as one number, even on the multi-step levels (4, 7, 8): the steps teach the method afterwards, and the question stays a quick napkin guess rather than a form.
- Every question follows three rules, and CI enforces the first:
  1. **Self-contained.** With the level's numbers beside it, the question gives every number the working starts from. `napkinSolution` lists those `givens`; CI checks each is in the question or the numbers box (a component's catalog figure may instead be left to the component the question names, "a large database"), and that every other number in the steps is worked out from the givens.
  2. **An easy, relevant warm-up.** One or two steps from the numbers given; the longer derivation (where those numbers come from) belongs in the worked solution.
  3. **It makes sense.** The answer informs a design decision, and the worked solution's takeaway says which (e.g. level 5: a profile is read once every 87 minutes, longer than any cache expiry, so add replicas rather than a cache).
- A duration may be answered in seconds, minutes or hours ("87 min").
- Not yet: the debrief comparing the estimate to what actually happened.

### The numbers (built)

- Every level has a "the numbers" box, generated from its data (`levelNumbers` in `sim`), never hand-written: on a sticky note under the briefing's story, and again on the napkin-math card. It holds only what the level uses: traffic (start → sustained, plus spikes and how long they last), CPU per request, the request timeout, the read/write split, the share of reads that check the reader's own write, the keys and how popular they are in plain words (only with a cache), the item size (only with a cache), the shard keys on offer (only with shards), the payment provider's limits, what it takes to pass (availability, p99, staleness, budget) and the run length.
- What happens during the run is named, never timed: "an app server will crash", "the cache will restart", "a hot key", "the payment provider refuses calls over its rate limit".
- Component specs stay in the inspector, the palette, the briefing's reference card and the field guide.

### Field guide (built)

- A reference section of the notebook, opened from the top bar on any level, and from "More in the field guide" links in the napkin working, the hints and the inspector of each component.
- It shows only what the player has met: the components of every level they can open, and each concept from the level that introduces it (availability and the nines, p99 and the 70% rule on page 1; the error budget on page 3). Entries still to come are counted, never named. `?unlock=all` opens them all. The game decides what's met (`guide/guide.ts`); a link to an entry not yet met draws nothing.
- Per component: what it does in one sentence, how its capacity works with a worked example (an app server does 1,000 ÷ CPU ms requests a second per vCPU; a database write costs reads/s ÷ writes/s reads; a cache's memory and TTL against how popular the keys are; replicas, shards, queue workers, the provider, the load balancer), its full spec table generated from the catalog, and its gotchas (the cache starts empty; replicas lag most when busy; the balancer sends to a dead server until health checks notice).
- Concepts: the nines, p99, the 70% rule and the error budget, each with one example. Every figure in the worked examples is computed from the catalog.

### Progression and rewards (built)

Pure functions in `packages/web/src/progression/`, over saved progress and run results; the theme only words and draws them.

- **Nines are the currency.** A level pays the nines of its best grade: 3 for a pass, 4 for a star, 5 for mastered (55 across the eleven built levels; each new level adds 5). Replaying never pays twice, only a better grade pays the difference. The contents page shows the running total; the grade card ticks it up one nine at a time.
- **Unlocks.** A level opens when the one before it is passed. A chapter also needs enough nines in total: Growing Pains 13, Hypergrowth 25, Worldwide 39 (every earlier page passed plus one, four and six tiers above a pass; they rose by 3, 3 and 3 when Everything Links joined chapter 1). A level the player already has a grade on always stays open, so older saves (from builds where everything was open) lose nothing. Locked pages show on the map with a padlock and say what opens them. `?unlock=all` before the `#` opens everything for testing, without touching the save.
- **Badges** (once earned, kept):
  - *Right-sized*: passed for no more than the level's cheapest reference solution costs. Judged by cost rather than by how busy the machines are: sizes come in fixed steps, so a right answer can sit well under the 70% the game teaches (level 1's large server is 44% busy), and a busyness floor would reward running hot. No tolerance: costs are exact catalogue sums. A test checks every level's cheapest reference earns it.
  - *N+1*: passed a level with a scripted crash, the crashed node's survivors never above 85% (the hot line) afterwards.
  - *Penny Pincher*: mastered for at most 80% of the budget.
  - *Five Nines Club*: mastered every level of a chapter.
  - *Napkin Wizard*: the estimate bonus (within 10%) on 3 levels.
  The contents page shows earned and unearned badges with how to earn each; the grade card stamps new ones, handed over by a cast member.
- **Promotions** (`progression/promotion.ts`): the player's title climbs once per written chapter, derived from best grades, never saved. The rule, in one place: a chapter promotes when its capstone is passed, or its last level when it has no capstone yet, so a future capstone takes over by data alone. Today: Everything Links (chapter 1), Bank Balance (chapter 2) and Flash Sale (chapter 3). The contents page shows the current title; the run that earns one ends its payout reveal with the founder handing it over, to a gong. The titles and scenes are the theme's (`story.promotions`).
- **Cost as a second score.** The grade card shows the money left under budget, and the boss reacts to it.
- **Saved progress** is versioned inside its key (`five-nines:v1`; version 2 adds badges, 3 peeks and kept designs, 4 the all-hands seen). A version 1 save loads intact and is awarded the badges its grades and estimates already earn. A save the build can't read is copied to `five-nines:unreadable-backup` before anything could overwrite it, and if that copy fails the game doesn't write at all.

### The story (built)

The campaign is a story: **Everything Labs**, a startup that launches a product a quarter, each named "Everything ___" (full premise in `docs/story/everything-labs.md`). The player joins as a Synergy Intern; the founder, Chad Visionary, dreams the products up on stage; the player makes them survive launch day.

- **Arc.** Each chapter opens with an all-hands where the founder unveils the quarter's products, runs through the concept levels (everyday work on those products) and ends on launch day: a capstone where there is one, and a promotion. Chapter 1 is Everything Links (waitlist, going viral, launch week, launch day); chapter 2 News, Chat and Pay; chapter 3 Social, the Store and the Drop.
- **Level titles stay** (they name the concept); the product is a subtitle beside the title on the contents card and the briefing ("Everything Links · launch day").
- **All-hands.** A chapter's title page as one panel ("Play first" above), shown once, the first time the player opens one of its levels (save version 4 records it), and reopenable from its label on the map (`#/all-hands/<chapter id>`).
- **Memos.** Each briefing card opens with the founder's hype, a goal line (chapter 1 so far), then Erasmus's translation as one margin line; the plain briefing sits behind "more". The plain briefing and the numbers box stay the source of truth. Erasmus's translation is worded from `levelNumbers`, and a test checks every number in it is in the numbers box (or is the 70% rule).
- **Tone.** The comedy lives in the founder, the product names and Doug's stamp. Numbers and lessons are played straight and never contradict the sim. The founder never states a number (tested). Events are never timed. Funny, not mean; no real companies or shows referenced.
- **Coworkers in copy only.** Doug (the Naming Department, a rubber stamp that only says EVERYTHING) stamps each product name; Bex (Head of Growth) explains where traffic comes from, on sticky notes. Neither is a cast role.

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

- A hint ladder: *where* it broke → *why* → the concept → the fix (built, one rung at a time). The game derives the failure story from the first failed check and its numbers (`failureStory` in `theme/situations.ts`); the theme words where and why from those numbers and supplies a concept and fix per level and kind of failure.
- Hints are always available (built): a "Hints" button in the top bar on every level, from the start. Before any failed run it shows the level's own ladder about its main trap (`LEVEL_TRAPS` in `theme/situations.ts`): where to look → why it's hard → the concept → the fix, quoting the level's numbers, never a time. After a failed run that run's ladder takes over, on the results card and in the top bar while building, until a run passes. Both show the same rungs: revealing one in either place reveals it in both. Each ladder links to the field-guide entry for its idea and offers the solution at the bottom. CI checks every level has a full ladder of its own.
- Latency is explained with real numbers (built): while p99 nears or passes the limit, playback notes which machine was busiest and how busy ("p99 hit 120 ms while app was 87% busy"), and the grade card's hints quote the run's worst second.
- Crashes show the failover arithmetic (built): when the instance died, the health-check interval, when the load balancer took it out of rotation, and the requests lost meanwhile against the 0.1% a pass allows. So shorter health checks visibly shrink the window without closing it.
- Re-running must take one keystroke and leave the layout untouched. Fast iteration is the whole game.

### Giving up (built)

- "Show me the solution" is always available: in the top bar, at the bottom of the hints and on the results card, with no run needed. Before the level is passed a confirm says what it costs first; after it is passed the solutions are free and the button reads "Debrief & solutions".
- The solution page draws every reference solution on the notebook with its explanation and key numbers (cost, and how busy each part is at the peak), plus the common traps. "Load it onto my canvas" puts a solution on the canvas, keeping the player's own design aside first (saved); "Switch back to my design" puts it back.
- The rules (`progression/peek.ts`): a level is *peeked* when the player confirms seeing its solution while it has no passing grade. A peek is permanent. Runs on a peeked level are credited at most a pass (three nines) and earn no run badges; the best grade is never lowered, so grades from before the peek stay; a pass still opens the next level. Progress badges follow the credited grades (a capped level can't complete a mastered chapter); the Napkin Wizard, earned before building, is unaffected. The map marks peeked pages in pencil, and the results card says when a run was capped.
- Saved progress version 3 records `peeked` and the designs kept aside (`stashedDrafts`); older saves migrate with neither and keep everything else.

### Debrief

- A card explaining the concept.
- The player's design vs. the reference, side by side: cost, nines, p99.
- An "in real life" note (e.g. Memcache leases for the stampede level).
- An "in the interview, say…" tip.


### Art direction

**The engineer's notebook.** Every screen is a page in a spiral-bound notebook: graph paper, ink doodles of real components, hand-lettered headings. The error budget is a row of tally marks crossed out as requests fail, the postmortem is a sticky note with the root cause circled in red pen, the result is a marked page, and the campaign map is a hand-drawn trail through the chapters. Real component names stay visible next to every doodle: each component is labelled with a real-world AWS example (EC2, ALB, ElastiCache, RDS, SQS; Stripe for the payment provider), with the generic concept it teaches (app server, load balancer, cache…) in smaller pencil beside it. Copy that explains a concept keeps the concept's words. The doodles are the silhouettes of the things themselves, and each canvas node's frame follows its doodle: a rack unit, a drum, a chip with pins, a conveyor, a bucket. A node standing for more than one machine (instances, replicas, shards, a replicated cache) has copies of its frame stacked behind it, one card for two and two for three or more.

Text in the notebook is at least 12px as rendered and 4.5:1 against its paper; `test/contrast.test.ts` measures the rewards screens, the chapter 3 readouts, the story's pages and the title page from the stylesheets and tokens. The title page's kraft cover takes ink only: pencil is too light on it.

**The cast, by role.** The game only ever asks for a role; the notebook supplies the character:

| Role | What the game asks for | Notebook character |
|---|---|---|
| Boss | the budget brief, the verdict on a graded run | Ms. Tally, a pencil with a tally-marked body |
| Mentor | a hint per failure reason, the take on design checks, the postmortem nudge | Erasmus, an eraser with a moustache |
| Troublemaker | the tease for a level's stress events, credit for crashes | Smudge, an ink blot: production itself, not a coworker |
| Founder | the story's hype: all-hands, memos, promotions (never a number) | Chad Visionary, a neon highlighter |

Lines are always worded from what actually happened: the game derives the situation (the level's first crash or spike, the check that failed), the theme only words it.

**The theme boundary.** Everything style-specific (art, character names and lines, words such as "page" for a level, and all CSS, with raw colours only in its tokens) lives in one folder, `packages/web/src/theme/notebook/`. Screens reach it only through `theme/index.ts`, which selects it statically and exposes the slots of the `Theme` contract (`theme/contract.ts`): the cast script and speech bubble, the title page, the story script (products, memos, all-hands, promotions) and its all-hands page and memo note, component names and art, budget meter, postmortem card, grade card, campaign map, badge shelf, small marks and sounds. A new art style is a new folder implementing that contract, plus its favicon and font links in `index.html`. There is no runtime theme switching.

---

## 4. Tech stack and MVP scope

### Stack

- **TypeScript + Vite, running in the browser, static hosting**, with no backend for v1. Save progress in localStorage, and make designs shareable by encoding them in the URL.
- **`sim/` as a pure TypeScript package** with no DOM dependencies. It runs in a Web Worker and is tested heavily with Vitest, including the reference/anti-solution tests for each level. This package is the product. Build it first, headless, with a small command-line runner that grades a level from a JSON design.
- **Levels as data**: JSON or TypeScript files validated with a Zod schema.
- **UI**: React for the panels, React Flow (xyflow) for the graph editor, and a Canvas2D overlay synced to the viewport for the request dots. SVG/DOM can't animate thousands of particles. Zustand for state, uPlot for the timeline.
- **Why not Godot or Unity:** the game is mostly UI and text. Web tooling is better at that and gives shareable links.

### MVP scope

- **In:** the 8 components above, levels 1–10 and the Everything Links capstone (including the Bank Balance and Stale Prices consistency levels), the estimate step, run and playback, the failure postmortem, the debrief, and star grading.
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
5. **Consistency is part of the curriculum.** Stale reads and duplicate effects count as bad requests (see the consistency model in section 1). The consistency levels are Bank Balance (6), Stale Prices (9), Double Charge (11) and Everything Links Worldwide's network partition (13).

### Open questions

None right now.
