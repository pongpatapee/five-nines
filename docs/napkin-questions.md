# Napkin questions: before and after

The napkin-maths question on every page, before and after the rewrite, for review. Every number in the "after" column is
worked out from the level's data by the game (`napkinSolution` in `packages/sim/src/estimate.ts`), and worded by the
notebook theme (`packages/web/src/theme/notebook/hints.ts`). The rules every question follows are in
`docs/design.md`, "Estimate step": self-contained, an easy and relevant warm-up, and an answer that informs a design
decision.

Levels 1, 2, 3 and 7 are unchanged. Level 10 keeps its question and states its assumption.

## 1. Hello, Traffic (unchanged)

- **Question:** Before you draw anything: at the peak, 350 requests a second each need 10 ms of CPU. How many vCPUs
  does that keep busy?
- **Answer:** 3.5 vCPUs.
- **Takeaway:** that's the work, not the size to buy: at least 4.1 vCPUs to stay under 85% busy, 5 to be comfortable.

## 2. Scale Out (unchanged)

- **Question:** Before you draw anything: at the peak, 5,000 requests a second each need 10 ms of CPU. How many vCPUs
  does that keep busy?
- **Answer:** 50 vCPUs.
- **Takeaway:** at least 58.8 vCPUs under the hot line, 71.4 to be comfortable; more than any one server has.

## 3. Pull the Plug (unchanged)

- **Question:** Napkin first. With xlarge servers (16 vCPUs, 10 ms of CPU per request), how many do you need so that
  losing any one still serves 5,000 req/s?
- **Answer:** 5 servers.
- **Takeaway:** all 5 up, each is 62.5% busy; after one dies, the 4 left are 78% busy.

## 4. Read All About It

- **Before:** Napkin first. At the peak, what share of reads must a cache catch so that a large database (10,000 reads a
  second, one write costs 2.5 reads) keeps up? (72.7%)
- **After:** After the writes, a large database has room for 6,750 reads a second. At the peak, 24,700 reads arrive.
  What share must the cache catch?
- **Answer:** 72.7%.
- **Worked steps:** the peak, 26,000 req/s; 26,000 × 95% = 24,700 reads and 1,300 writes; one write costs 10,000 ÷ 4,000
  = 2.5 reads; 1,300 × 2.5 = 3,250, so 10,000 − 3,250 = 6,750 reads of room; 6,750 ÷ 24,700 = 27.3% can go to the
  database; 100% − 27.3% = 72.7%.
- **Takeaway:** at exactly 72.7% the database is 100% busy; 78.7% keeps it at 85%, 84.8% at a comfortable 70%.
- **Why:** the write-cost step moves out of the question into the worked solution (and the field guide); the question
  is the one-step division a player can do on a napkin.

## 5. Cache Miss

- **Before:** Napkin first. Traffic peaks at 20,000 requests a second, and 96% of them read a profile. How many reads a
  second does the database have to serve at the peak, before you add any cache or replica? (19,200 reads/s)
- **After:** 100 million profiles, all equally likely, and 19,200 reads a second at the peak. On average, how long
  between two reads of the same profile?
- **Answer:** 5,208 seconds (about 87 minutes). Answers within 10% earn the bonus; the player may type seconds,
  minutes or hours ("87 min", "1.5 h").
- **Worked steps:** the peak, 20,000 req/s; 20,000 × 96% = 19,200 reads; reads spread evenly, so 100,000,000 ÷ 19,200 =
  5,208 s between two reads of one profile.
- **Takeaway:** even the longest expiry on offer, 1 hour (3,600 s), runs out first, so a cached copy is almost always
  gone before anyone asks for it again: even the biggest cache catches about 2% of reads. Add read replicas instead.
- **Why:** the old question asked for a number the player then had no use for; the new one explains why the cache, the
  obvious move, doesn't work here.

## 6. Bank Balance

- **Before:** Napkin first. On payday traffic peaks at 20,000 requests a second. 95% are reads, and 20% of those reads
  are users checking a transfer they just made. How many reads a second is that? Those are the reads that can't afford
  a stale copy. (3,800 reads/s)
- **After:** 3,800 reads a second are users checking a transfer they just made, so they must read from the primary. The
  primary also takes 1,000 writes a second, and each costs as much as 2.5 reads. A large primary does 10,000 reads a
  second. How busy is it?
- **Answer:** 63%.
- **Worked steps:** the peak, 20,000 req/s; 19,000 reads and 1,000 writes; 19,000 × 20% = 3,800 reads of a fresh
  write; 3,800 + 1,000 × 2.5 = 6,300 reads' worth; 6,300 ÷ 10,000 = 63%.
- **Takeaway:** 63% is under the 70% line, so a large primary is enough for the fresh reads and the writes; a medium
  one would be 126% busy.
- **Why:** the old answer was a step towards the design; the new one sizes the primary, the decision the level turns on.

## 7. The Write Wall (unchanged)

- **Question:** Napkin first. A large database takes 4,000 writes a second. How many large shards' worth of work do
  15,000 writes a second make, if they spread evenly?
- **Answer:** 3.75 shards.
- **Takeaway:** 4 would each run 94% busy, past the hot line; 5 run 75% each, if the shard key spreads the writes
  evenly.

## 8. Thundering Herd

- **Before:** Napkin first. The cache restarts empty at t=90s, when traffic is 30,000 requests a second: 29,700 reads
  and 300 writes. If every read missed the cache at that moment, how busy would a large database be? It does 10,000
  reads a second, and one write costs it as much as 2.5 reads. (304.5%)
- **After:** At 1:30 the cache restarts empty, and 29,700 reads a second fall straight on a large database that
  handles 10,000 reads a second. How many times its capacity is that?
- **Answer:** 2.97 times (about 3×).
- **Worked steps:** at 1:30 the traffic is 30,000 req/s; 30,000 × 99% = 29,700 reads; 29,700 ÷ 10,000 = 2.97× its
  capacity.
- **Takeaway:** about 3 databases' worth of reads at once, with the writes on top: the queue grows every second, refills
  wait behind the misses and even the popular items keep missing. That's the stampede: keep the misses off the database,
  or give it the capacity for that moment.

## 9. Stale Prices

- **Before:** Napkin first. At the peak, what share of reads must a cache catch so that a medium database (5,000 reads
  a second, one write costs 2.5 reads) keeps up? (79.6%)
- **After:** After the writes, a medium database has room for 4,880 reads a second. At the peak, 23,952 reads arrive.
  What share must the cache catch?
- **Answer:** 79.6%.
- **Worked steps:** as level 4, with 24,000 req/s, 99.8% reads (23,952 reads, 48 writes), a write costing 2.5 reads,
  and 5,000 − 120 = 4,880 reads of room.
- **Takeaway:** fresh by expiry alone means a TTL of 5 seconds at most, and then even the biggest cache catches only
  about 67%: short of 79.6%. So invalidate on write, and keep the TTL long.

## 10. Flash Sale

- **Before:** Napkin first. The sale sends 10,000 orders a second for 30 seconds, and each must be charged within 120
  seconds. How many orders a second must the workers charge?
- **After:** Napkin first. The sale sends 10,000 orders a second for 30 seconds, and each must be charged within 2
  minutes. Say the workers start charging as orders arrive, and every order is charged by 2 minutes after the sale
  ends. How many orders a second must they charge?
- **Answer:** 2,000 orders a second.
- **Worked steps:** 10,000 × 30 s = 300,000 orders; the last arrives as the sale ends, so the workers have 30 + 120 =
  150 s; 300,000 ÷ 150 = 2,000 a second.
- **Takeaway:** that's only the sale: normal traffic, 1,000 orders a second, keeps arriving on top.
