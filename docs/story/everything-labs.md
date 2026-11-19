# Story premise: Everything Labs

Status: premise for review. Builds on the owner's decisions; replaces the four earlier pitches in this folder.

## 1. Premise and tone

You join **Everything Labs** ("Disrupting everything. Literally.") as a Synergy Intern. The company launches a new product every quarter, each one named "Everything ___", and each one bigger than the last. The founder dreams them up on stage. You make them survive launch day. Every chapter opens with an all-hands, runs through a few weeks of everyday work (the concept levels), and ends on launch day (the capstone). Ship it, and the founder hands you a new title. There is no villain. The antagonist is scale, plus the founder's ambition.

**Tone rules**

- Jokes live in the corporate world: all-hands speeches, product names, job titles, memos, coworker asides.
- The engineering is played straight. Numbers, requirements, debriefs, hints and postmortems are never jokes.
- The founder never states a requirement. He speaks in vibes ("millions!"). Only Erasmus says numbers, and his numbers are the level's JSON, exactly.
- Nothing contradicts the sim. If a line says the cache saved the day, the run showed it.
- Events are never timed in story text. "At some point" is the house style, as in the current briefings.
- Funny, not cynical. The founder is sincere and kind. Nobody is stupid for laughs except, gently, the buzzwords.

## 2. Everything Labs and the founder

**The founder: Chad Visionary** (working name). He says "disrupt" constantly. He is optimistic, sincerely grateful to his team, and has no idea how anything works. In the notebook he's a **neon highlighter**: he highlights everything, so nothing stands out.

**Voice guide.** Short declaratives, big nouns, no numbers. He mixes metaphors and never notices.

- "We're not launching a product. We're launching a category."
- "Links are broken. Not technically. Spiritually."
- "Let's not boil the ocean. Let's disrupt it."
- "Our target market is everyone. We'll expand from there."
- "I want this to scale like a rocket. A rocket that's also a platform."
- "I don't want five nines. I want *all* the nines."

**The office.** A converted warehouse with a gong for launches and a wall of framed product boxes (empty, because the products are websites). All-hands happen in "the Amphitheater": three rows of beanbags. The server closet has a sign on the door: "THE CLOUD."

**The cast as margin doodles.** The notebook is the player's own, and the cast are their doodles of coworkers. Game roles don't change.

| Doodle | Who it is at Everything Labs | Game role (unchanged) |
|---|---|---|
| **Ms. Tally** (pencil) | Head of Finance. Keeps the runway spreadsheet; has never been surprised by a bill. | Sets the budget, delivers the verdict |
| **Erasmus** (eraser) | Principal engineer, there since the first server. Sits at the back of every all-hands, writing in the margin. | Translates the hype; hints, design checks, postmortem nudge |
| **Smudge** (ink blot) | Not a person: production itself. The crashed box, the rebooted cache, the viral post. Non-human keeps every coworker on your side. | Owns the stress events |

**Erasmus translates the hype.** Each briefing quotes the founder, then Erasmus's margin note turns it into requirements: "He means 350 requests a second." The joke is the gap. The lesson is that closing it is the first step of every system design interview.

**Recurring coworkers, used sparingly** (briefings and all-hands only, not cast slots):

- **Doug, the Naming Department.** The whole department is Doug. His doodle is a rubber stamp that only says EVERYTHING. He unveils each chapter's product name.
- **Bex, Head of Growth.** A paper airplane. Bex explains where traffic comes from ("I got us into the newsletter!"), so spikes have a human cause without a villain.

## 3. The promotion ladder

One promotion per capstone, handed out by the founder on the gong stage. The title shows on the notebook's cover and contents page.

| When | New title | Founder's announcement |
|---|---|---|
| Start | Synergy Intern | "Welcome to the family. Your title is Synergy Intern. Nobody knows what it means, which means it can mean anything." |
| Everything Links ships (end of Getting Online) | 10x Engineer | "I ran the numbers. Okay, Erasmus ran the numbers. You're a 10x Engineer now." |
| Everything Reviews ships (end of Growing Pains) | Paradigm Architect | "You didn't just shift the paradigm. You built it a house." |
| Everything Tickets ships (end of Hypergrowth) | Chief Disruption Officer | "There's only one CDO at Everything Labs, and it used to be me. I'm promoting myself to Visionary Emeritus." |
| During Worldwide | (being workshopped) | A whiteboard of rejected titles grows each level: "Head of Tomorrow," "VP of Yes," "Chief Officer of Officers." |
| Worldwide capstone ships | Open | One option: Doug finally names something that isn't "Everything ___". His stamp says "ENGINEER." |

## 4. Chapter-by-chapter map

Renames only. Every number below is the level's JSON. "Fit" flags where the story strains.

### Chapter 1: Getting Online (all-hands: Everything Links is coming)

| # | Product / service | In-story event | Founder's hype | Erasmus's translation | Fit |
|---|---|---|---|---|---|
| 1 Hello, Traffic | The Everything Links waitlist API | The teaser site goes live and people join the waitlist | "Today we open the doors to the future of links." | "100 requests a second, rising to 350 within 30 seconds. 10ms of CPU each. One app server, p99 under 75ms." | Clean |
| 2 Scale Out | Same waitlist | Bex gets the waitlist into a popular newsletter | "We're going viral. Organically. I paid for nothing." | "1,000 rising to 5,000 a second. That's 50 vCPUs of work, and the biggest box has 16." | Clean (the JSON already says newsletter) |
| 3 Pull the Plug | Same waitlist, launch week | At some point, a server dies | "Downtime is a mindset." | "Up to 5,000 a second, and one server will crash. Lose any one and still serve everyone." | Clean |
| **Capstone** | **Everything Links** (URL shortener) | Launch day | "Long links are a tax on the human spirit." | See section 5 | New |

### Chapter 2: Growing Pains (all-hands: Everything Reviews is coming)

| # | Product / service | In-story event | Founder's hype | Erasmus's translation | Fit |
|---|---|---|---|---|---|
| 4 Read All About It | **Everything News**, launched because "news is broken" | Steady growth, then a breaking story spikes traffic | "We're not reporting the news. We're disrupting it." | "6,000 climbing to 20,000 a second, a spike to 26,000 for half a minute. 95% read one of 2 million articles; 5% post comments. A few hundred stories get most of the reads." | Clean. 2M articles is a lot for a startup; say it aggregates from everywhere. |
| 5 Cache Miss | **Everything Chat** profile cards | Every message shows the sender's card | "Every conversation is a relationship. Every relationship is a platform." | "20,000 a second, 96% profile reads over 100 million profiles, all equally likely. A profile may be up to 1 second out of date." | Slightly strained. Nobody is popular because you message only your friends. 100M is a leap; the chapter card says "Chat went viral." |
| 6 Bank Balance | **Everything Pay**, a wallet | Payday, at some point, spikes traffic for about 40 seconds | "Money is just information that wants to be free. Not free free. Fee-free." | "12,000 a second, jumping to 20,000 on payday. 95% reads. One read in five is someone checking their balance right after their own transfer." | Clean |
| **Capstone** | **Everything Reviews** (Yelp-like, no geo search) | Launch day | "Opinions are the oil of the attention economy." | See section 5 | New |

### Chapter 3: Hypergrowth (all-hands: Everything Tickets is coming)

| # | Product / service | In-story event | Founder's hype | Erasmus's translation | Fit |
|---|---|---|---|---|---|
| 7 The Write Wall | **Everything Social**, the likes-and-comments service | A celebrity posts, and a quarter of all writes go to that one post | "Engagement is the new oxygen." | "12,000 climbing to 15,000 writes a second, no reads. For 40 seconds, 25% of writes hit one post. Pick the shard key with care." | Good. No reads, so the briefing says this is the reactions service only. |
| 8 Thundering Herd | **Everything Store** opening day | At some point, the cache node restarts | "Shopping, but disrupted." | "4,000 a second at opening, 30,000 a minute later. 99% reads over 1 million items, a few thousand popular. The cache will come back empty at some point." | Clean |
| 9 Stale Prices | Everything Store's "AI-powered dynamic pricing" | The founder's pricing feature goes live | "Our prices now have feelings." | "6,000 climbing to 24,000 a second, 99.8% reads over 1 million products. Prices change 48 times a second. Show none more than 5 seconds old. Budget stops at a medium database." | Good. The pricing feature makes 48 changes a second believable, and the joke is the founder, not the numbers. |
| 10 Flash Sale | The Everything Drop, a 30-second sale | A flash sale opens, at some point, for 30 seconds | "Scarcity is a feature." | "1,000 orders a second, then 10,000 a second for 30 seconds. The payment provider takes 2,500 charges a second, 300 ms each. Accept within 200 ms, charge within 2 minutes." | Clean. Risk: overlaps the Tickets capstone (section 5). |
| **Capstone** | **Everything Tickets** | On-sale day | "Live experiences, now with fewer experiences of waiting." | See section 5 | New |

### Chapter 4: Worldwide (all-hands: Everything Tube is coming)

The planned levels in `docs/design.md` fit as more work: **Double Charge** is an Everything Drop postmortem, **Around the World** is the company going global, and the old URL-shortener capstone's region failure and partition become a callback level, **Everything Links Worldwide** (short links tolerate conflicting writes: the CAP lesson design.md wanted). Capstone: **Everything Tube**.

## 5. Capstone designs

**What the sim supports today** (from `schema.ts`, `validate.ts`, `catalog.ts`):

- One request type per level: the same CPU work, then one read or write (by `readShare`) over one key distribution. Writes follow the reads' skew.
- Several scripted events can combine in one level (`instanceFailure`, `cacheRestart`, `hotKey`). A cache can front shards. Read-after-write, pinning and staleness work across cache and replicas.
- **A level has a data tier or payments, never both** (`LevelSchema.superRefine`).
- S3 (`blobStorage`, on `main`) is priced and drawn, but validation rejects it everywhere; its engine model isn't built.
- No CDN, no regions, no search index.

### Everything Links (Getting Online)

- **Traffic.** Redirects (reads of a short code) and creates (writes of a new link), about 95/5. Skewed: a few links go viral. A launch-day surge, and at some point a server crashes.
- **Components.** ALB, EC2, RDS.
- **Passing design.** ALB with retry on connection failure, N+1 app servers, and a database under about 70% busy at peak. Illustrative numbers, to calibrate in CI: 3,000 req/s, 5ms CPU, 95% redirects. The database sees 2,850 reads plus 150 writes (375 read-equivalents): a small RDS runs at 129%, medium at 65%. Four large EC2, a medium RDS and an ALB cost $1,285 against $1,400. Traps: a small database, no retry, a large database (over budget).
- **Sim fit.** Buildable today, no engine change. Notes:
  - **Content gap: the database.** Chapter 1 never teaches one; level 4 introduces it. I kept it, because a URL shortener without storage isn't one, and sizing a database is level 1's lesson on a new box. Erasmus introduces it ("same 70% rule, different machine"). The alternative, a CPU-only Links, is honest but not recognizably a URL shortener.
  - **Model quirk.** Creates should write new keys, but the sim spreads writes like reads. Harmless here (no cache, no staleness); it matters later.
  - Key generation (base62, collisions) isn't modeled. It belongs in the debrief's interview tip.

### Everything Reviews (Growing Pains)

- **Traffic, ideal.** Business pages (heavily skewed, cacheable), user profiles (uniform, like level 5), and review posts (writes), after which the author reloads the page to see their review (read-after-write).
- **Components.** ALB, EC2, ElastiCache, RDS, RDS read replicas.
- **Passing design.** A cache absorbs the skewed business reads. Replicas take what's left. Read-your-writes pinning, with a window longer than the worst-case lag, keeps an author from missing their own review.
- **Sim fit.** A one-keyspace version is buildable today: about 10M businesses at Zipf around 1, 95% reads, a read-after-write share, a staleness limit, a spike. Cache, replicas and pinning all work together. Gaps:
  - **Request classes.** Skewed businesses plus uniform profiles need two key populations in one level. This is the most useful engine feature for capstones: a workload made of classes, each with its traffic share, CPU, read/write mix and key distribution. Reviews, Tickets and Tube all want it.
  - **Search.** No search index exists. Drop text search along with geo, and frame browsing as reads of category pages.
  - Photos would need S3; leave them for Worldwide.

### Everything Tickets (Hypergrowth)

- **Traffic, ideal.** Event pages (skewed, cached, and at some point the cache restarts); seat availability (changes fast, has a staleness limit, needs invalidation); one show goes huge (a hot key on the shows' shard key); purchases go through a queue to a rate-limited payment provider with a deadline.
- **Components.** ALB, EC2, ElastiCache, RDS shards, SQS, Stripe.
- **Passing design.** Shard by a key that spreads the hot show (user or order, not show). A cache with coalescing (or a replica) survives the restart, invalidate on write keeps seat counts fresh, and a queue with enough workers drains checkout under the provider's cap.
- **Sim fit.** **Not buildable today.** Gaps:
  1. Data and payments can't share a level (`schema.ts`: each request would fail at both and be counted twice). Request classes fix it properly: browse requests use the data tier, checkout requests use payments.
  2. Queues only front the payment provider. Fine for Tickets; generalize before Tube.
- **Interim option**, if Tickets must ship first: data only (shards, cache, restart, hot key, staleness, all supported). It works but drops the queue, the chapter's climax tool. I'd build request classes instead.
- **Overlap with level 10.** Keep the Drop about the queue alone; make the capstone mostly about browsing at scale, with checkout as one piece.

### Worldwide: Everything Tube (recommended over Everything Feed)

- **Traffic.** Video segment GETs (large, static, very skewed), page and metadata reads, uploads (large writes), and a processing job per upload. Users in several regions. At some point a region fails.
- **Components.** CDN, S3, EC2, ALB, RDS, ElastiCache, SQS with workers, multi-region.
- **Passing design.** A CDN serves the segments at the edge. S3 is the origin for video. The app tier and database run in more than one region. A queue feeds the processing workers.
- **Sim fit.** **The most engine work.** A CDN component (static share, edge hit rate, edge latency); regions (client regions, cross-region latency, a region-failure event); the S3 model `catalog.ts` already lists (first-byte latency plus transfer time, per-prefix limits, usage-based cost); object size and egress cost; request classes; generic queue workers.
- **Why Tube over Feed.** Tube uses exactly Worldwide's tools and gives S3 its first job. Feed's lesson is fan-out on write versus read, a different engine feature (write amplification by follower count) that needs no CDN or regions. Feed makes a good post-campaign capstone.

**Roadmap order this implies:** (1) Everything Links, no engine work; (2) request classes, then data and payments together; (3) Reviews and Tickets; (4) CDN, regions and the S3 engine model; (5) Tube.

## 6. Sample copy

**Chapter 1 all-hands**

> *The gong. Chad bounds onto the beanbags.*
>
> "Team. Family. Doug. Look at a link. Any link. It's long. It's ugly. Our links still have *question marks* in them. Today that ends. Doug?"
>
> *Doug lifts a sheet. On the whiteboard, in stamp ink: EVERYTHING LINKS.*
>
> "Short links. For everyone. We open the waitlist today, and we launch when it's ready. It'll be ready soon. It'll scale, obviously. Our new intern is on it."
>
> *Margin, in pencil:* That's you. Start with the waitlist. —E.

**Level 1, Hello, Traffic**

> **Chad:** "The waitlist goes live today. This is the moment the future gets an email address. Expect massive demand. Like, a lot."
>
> **Erasmus, in the margin:** *"A lot" means 100 requests a second, climbing to 350 within 30 seconds. Every request needs 10ms of CPU time. An app server works on one request per vCPU at a time; the rest wait in line.*
>
> *Pick one app server that keeps p99 latency under 75ms.*
>
> *Rule of thumb: keep each server under about 70% busy at peak. Above that, requests wait in line and p99 climbs fast.*
>
> **Ms. Tally:** "$250 a month. Not a cent over."

**Promotion: Everything Links ships**

> *Confetti cannon. Most of it misses.*
>
> "Everything Links is live, and it didn't fall over. I'm told that's rare? I ran the numbers. Okay, Erasmus ran the numbers. Synergy Intern, you are now a **10x Engineer**. I don't know what the other nine x's are, but I can feel them."
>
> *Doug stamps a new business card. It says EVERYTHING.*
>
> *Margin:* Shipped, and it held. Well earned. Next quarter is worse. —E.

## 7. Open questions for the owner

1. **The founder's name.** "Chad Visionary" is a working name, and "Chad" carries meme baggage. Alternatives: Rex Momentum, Skyler Boldly. Should the surname be a joke at all?
2. **Level titles.** Keep the 10 titles (they name the concept and still fit) with the product as a subtitle ("Hello, Traffic · Everything Links waitlist"), or retitle in-world?
3. **How the story shows between levels.** Proposal: the all-hands as a chapter title page, a taped-in memo before each level (hype plus translation, which becomes the briefing), the promotion on the capstone's result page. Does the founder become a fourth role in the theme contract, or speak through briefing text only?
4. **A database in chapter 1.** May the Links capstone introduce RDS?
5. **Capstone grading.** Same tiers and one budget? A napkin-math step, and with which quantity? (A "database load at peak" estimate would suit Links; it doesn't exist yet.)
6. **Ship order.** Ship Links first and the other capstones as the engine catches up, or hold them all?
7. **The final title**, and whether Doug's "ENGINEER" stamp is the payoff.
8. **Smudge** as production itself rather than a coworker (recommended, to keep "no villain" true)?
