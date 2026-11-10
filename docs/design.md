# Five Nines: Design Proposal

Status: draft for review

Five Nines is a puzzle game that teaches system design. Players build an architecture, run a simulation against a level's requirements, and watch it pass or fail with a clear explanation of why.

---

## 1. Simulation model

### Use a flow model, with sampled requests for latency and visuals

Simulating every request as a discrete event is a poor fit. At 50k req/s over a 5-minute scenario that's about 15M requests per hop. Scaling the traffic down so each simulated request stands for many real ones would distort the tails, which are exactly what we grade. Instead:

- **Fluid queueing model, ticked every ~100ms of simulated time.** Each node tracks how fast work arrives (λ), how fast it can serve it (μ = instances × per-instance capacity) and its backlog: `backlog += (λ − μ)·dt`, never below 0. Below capacity, waiting time comes from the standard queueing formula for a pool of servers (M/M/c, Erlang C). Above capacity the backlog grows, latency follows from Little's Law, and once the queue is full or the wait passes the timeout, requests become errors.
- **Success and error counts are exact fractions, not samples.** This matters for grading. Checking 99.999% means detecting about 1 bad request in 100k, and sampling can't resolve that.
- **A few hundred sampled "probe" requests per tick** walk the graph using each node's current state. They give us p99 across multiple hops, which has no closed form, and they are the dots the player sees moving.
- **Deterministic.** Use a seeded random generator and failures that the level scripts at fixed times. Compute the whole run up front in a Web Worker, then play it back. That makes scrubbing, instant re-runs and "skip to result" free, and grading reproducible.

The queueing math supplies the most important lesson for free: latency curves up sharply as utilization nears 100%, so players work out "keep it around 70%" on their own.

### Current model simplifications

Known shortcuts in the engine as built. Each one should either stay documented in-game or be removed when a level needs it.

- The timeout applies to time spent waiting in a queue, not to end-to-end latency.
- Requests that time out don't use any CPU. Real servers often keep working on requests the client gave up on, which makes overload collapse worse.
- Health checks only detect crashed instances, not overloaded ones. Real health checks that time out under load can remove healthy-but-busy instances and cascade.
- Load balancers retry only refused connections, once, on another instance.

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
| Cache | memory size, TTL, request coalescing | hit rate = share of requests that hit the top-C keys (C = how many keys fit in memory). Starts cold, warms up, and a restart wipes it |
| DB primary | size | separate read and write capacity, plus a connection limit |
| Read replicas | count | serve reads only; replication lag grows with write load |
| Shards | count, shard key | a hot key puts all its load on one shard |
| Queue + workers | worker count, max depth | fast response to the producer, but the backlog has a deadline |
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
   - Intended solution: one large server (44% busy). Each wrong size fails a different check: small overloads, medium is never overloaded but fails latency at 87% utilization, and xlarge blows the budget. Introduces the latency curve.
2. **Scale Out** (horizontal scaling, load balancing)
   - Requirements: 5k req/s. The largest single instance can't handle it, or costs more than several smaller ones.
   - Intended solution: a load balancer plus N app servers.
3. **Pull the Plug** (redundancy)
   - Scenario: an app server dies at t=60s.
   - The trap: N+1 servers alone still fail. Even with a 5-second health check, a fifth of the traffic goes to the dead node for about 9 seconds: roughly 1% errors over the run, so 99.0% availability.
   - Intended solution: N+1 servers **plus retry-on-failure at the load balancer**. The debrief shows the arithmetic: health checks alone don't get you nines.
4. **Read All About It** (caching)
   - Workload: 20k req/s, 95% reads, heavily skewed keys. The database the budget allows tops out at 5k reads/s.
   - Intended solution: a cache sized to hit about 80%.
5. **Cache Miss** (when caching doesn't help)
   - Workload: same traffic, but uniform keys over a huge keyspace, so a cache the budget allows hits about 3%.
   - Intended solution: read replicas, since the requirements tolerate 1s of staleness. The debrief shows the player's cache hit rate.
6. **Bank Balance** (read-your-writes consistency)
   - Workload: a banking app, 90% reads. 20% of reads are users checking their balance a second or two after a transfer. The primary alone can't serve every read.
   - The traps: sending all reads to replicas shows users their old balance, which fails as stale reads. Sending all reads to the primary overloads it. Pinning with a window shorter than the lag passes at normal load, then fails when a traffic spike makes the lag grow.
   - Intended solution: replicas for reads, read-your-writes pinning with a window longer than the worst-case lag, and a primary sized for the pinned reads.
7. **The Write Wall** (sharding)
   - Workload: 15k writes/s. Replicas don't help with writes.
   - Intended solution: shard by user ID.
   - Star objective: survive a "celebrity" hot key, which punishes a naive shard key.
8. **Thundering Herd** (cache stampede)
   - Scenario: the cache node restarts at t=90s and the burst of misses crushes the database.
   - Intended solution: request coalescing, a replicated cache, or protective capacity, all within budget.
9. **Stale Prices** (cache invalidation)
   - Workload: a store catalogue that's cache-friendly, but prices change often. Requirements: a price may be at most 5 seconds old.
   - The traps: a 60-second TTL gives a great hit rate and serves wrong prices. A 5-second TTL is correct, but the hit rate drops and the database overloads.
   - Intended solution: invalidate the cache entry on every price write, keeping a long TTL as a safety net.
10. **Flash Sale** (async processing with queues)
    - Scenario: 10× order spike for 30s. The downstream payment provider has a hard rate limit.
    - Requirements: accept orders within 200ms, process them within 5 minutes.
    - Intended solution: a queue plus enough workers to drain the backlog before the deadline.
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
- Show each component's capacity numbers, but **not** projected utilization. Doing that arithmetic is the skill being taught.

### Estimate step (covers back-of-envelope estimation)

- Before building, the level asks one or two questions, e.g. "how many app servers will you need?" or "what cache hit rate do you need to protect the database?"
- An estimate within ±25% earns a bonus. The debrief compares the estimate to what actually happened.

### Run

- Request dots along the edges, with density proportional to rate. Colour shows type (read, write, cache hit), and failed requests show as red ✕ that drop away.
- Each node shows a utilization ring and a queue-depth bar.
- A timeline strip shows req/s, p99, error rate and the error budget, with scripted events marked ("t=60 app-2 dies").
- Controls: play, 1×/4×/16× speed, and scrub.

### Fail

This should feel like Poly Bridge's slow-motion collapse.

- Automatically slow down and freeze at the moment the SLO breaks.
- Move the camera to the root-cause node and play a short cascade, e.g. *DB primary 140% utilized → queue 4k deep → p99 2.3s → LB timeouts*.
- This needs the engine to **record why each request failed**: queue full, timeout, node down, connection pool exhausted, stale read. The first cause in time wins, so the player sees the cause rather than just the symptom.
- Show it as an incident-postmortem card. Engineers will recognize the format.

### Hints and iteration

- A hint ladder: *where* it broke → *why* → the concept → the full solution.
- Re-running must take one keystroke and leave the layout untouched. Fast iteration is the whole game.

### Debrief

- A card explaining the concept.
- The player's design vs. the reference, side by side: cost, nines, p99.
- An "in real life" note (e.g. Memcache leases for the stampede level).
- An "in the interview, say…" tip.

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
- **Unclear root causes in cascading failures.** The "first cause wins" heuristic will sometimes mislead. Hand-check the postmortem text on every level.
- **Model blind spots.** The model ignores GC pauses, network partitions and noisy neighbours. That's acceptable if an in-game "model assumptions" page says so.

### Decisions

1. **Cost uses real dollars.** Component prices are monthly USD, loosely based on public cloud on-demand prices.
2. **Timeouts and retries become player-configurable in later levels.** Early levels get a single, narrow knob: load-balancer retry on connection failure (level 3).
3. **Data modelling is out of scope.** Five Nines teaches the scaling part of a system design interview.
4. **Grading is by outcome.** Any design that meets the requirements passes. Each level still has an in-game **solutions** section with one or more annotated reference designs. Players can open it after attempting the level to compare against their own design. Levels also list known wrong answers ("anti-solutions"). CI uses them to prove that the obvious mistakes fail, and the debrief can use them as "common traps".
5. **Consistency is part of the curriculum.** Stale reads and duplicate effects count as bad requests (see the consistency model in section 1). The consistency levels are Bank Balance (6), Stale Prices (9), Double Charge (11) and the capstone's network partition (13).

### Open questions

None right now.
