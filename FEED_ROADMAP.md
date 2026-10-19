# Feed & Recommendation Roadmap

Scoping document, written 2026-10-19 against `edeee93`.
`RECOMMENDATION_ENGINE_ANALYSIS.md` predates the ML scorer, bandit, session learner and Deep Dive, so treat it as historical.

## Status (PR #185)

| Item | State |
|---|---|
| 1.1 Active-only watch time, 1.2 log fast skips | Done (`WatchTimer.js`) |
| 1.3 Normalised dwell, 1.4 implicit actions, 1.5 one signal module | Done (`signals.js`) |
| 1.6 Impression log | Done through stored `_score` / `_explore` / `_strategy` on each impression |
| 2.1 Bandit credit, 2.2 strategy bonuses | Done |
| 2.3 Multi-objective heads | Done (engagement / not-skip / positive); also fixed a 16× too-small learning rate |
| 2.4 Uncertainty-driven exploration | Done (neural-linear posterior, tag-evidence fallback) |
| 2.5 Diversity, 2.6 satiation and negative momentum | Done (`Diversity.js`, `SessionInterest`) |
| 2.6 SASRec-style sequence model | Not done: satiation + negative momentum first; revisit once Feed Quality data shows a need |
| 2.7 Two-speed profile | Done (180-day core, dormant favourites resurface via reach) |
| 3.1 Global tag graph, 3.2 adjacent arm, 3.3 personalised trending | Done (`GlobalTagGraph.js`) |
| 3.4 Noise tags | Partly: queries are IDF-weighted; the avoided-tags list stays as a user setting |
| 3.5 AI tags in the graph | Done (the graph learns from `learningPost`, which merges AI tags) |
| 4.1 Candidate pool, 4.2 profile off fetch path, 4.3 frozen runway, 4.4 no dead-end, 4.5 seen-filter | Done |
| 4.6 Readiness-aware ordering | Not done |
| 5 Measurement | Done: Feed Quality card on Profile Analytics (skip/engaged rates, progressive-validation AUC, sessions, per-strategy and discovery yield) |

## Where the engine stands

The pipeline is already more than most hobby recommenders:

| Layer | File | What it does |
|---|---|---|
| Candidate generation | `src/workers/recommendation.worker.js:731` | Thompson-sampled strategies (anchor / pivot / reach / wildcard) turn top tags into booru queries |
| Long-term profile | `recommendation.worker.js:120` | Decayed tag / rating / media affinities (30-day half-life) |
| Tag space | `src/services/TagEmbedding.js` | PMI + random projection over the user's own positive posts |
| Ranker | `src/services/MLScorer.js` | 179-feature MLP (tag embeddings, affinities, visual descriptors, pHash), online SGD + replay |
| Session learner | `src/services/SessionInterest.js` | Fast in-session tag/visual centroid, 5-min half-life, blended up to 25% |
| Deep Dive | `src/services/DeepDiveInterest.js` | Anchor-post similarity mode |
| Feed assembly | `src/services/RecommendationSystem.js:236` | Fetch all strategies, dedupe, score, 60/40 ranked/discovery interleave |
| Runway | `src/views/FeedView.vue` | Virtualised snap feed, prefetch at 4 screens, re-rank on interaction |

The weak points are not the model size. They are **signal quality**, **credit assignment**, **how exploration is chosen**, and **pipeline latency**. Fixing those first makes every later ML upgrade pay off more.

---

## Phase 1: Make the implicit signal trustworthy (highest leverage, low effort)

The model can only be as good as its labels. Several labels are currently wrong in ways that matter.

### 1.1 Watch time counts idle and backgrounded time
`App.vue:687-705` measures wall-clock from post change to post change. There is no `visibilitychange`, blur, or idle handling in `App.vue`, and `accumulatedWatchTime` is only ever reset, never accumulated. Leaving the app on a post for ten minutes logs the strongest possible positive (`SessionInterest.js:565` caps at 30 s → signal 1.0).

**Do:** pause the clock on `document.hidden`, window blur, and after N seconds with no pointer/scroll activity on an image; accumulate only active time.

### 1.2 The fastest skips are thrown away
`App.vue:698` only logs `timeSpent > 1000`. A sub-second flick is the clearest "not interested" signal the app gets, and it never reaches the profile, ML, or the bandit.

**Do:** log every impression, including sub-second ones, as a skip.

### 1.3 Dwell is not normalised
`interactionSignal` (`SessionInterest.js:565`) and `timeSpentLabel` (`MLScorer.js:83`) treat 10 s the same on a still image and on a 90 s video. Users also differ: a fast scroller's 4 s may be a strong positive.

**Do:**
- Videos: use completion ratio and loop count (`timeupdate` / `ended` already flow through `FeedView.vue:802`).
- Images: convert dwell to a percentile of the user's rolling dwell distribution per media type (keep a small histogram in the profile snapshot).

### 1.4 Capture the implicit actions that already exist in the UI
None of these currently feed learning, yet each is a stronger signal than dwell:

| Signal | Where it happens | Suggested weight |
|---|---|---|
| Starting a Deep Dive on a post | `RecommendationSystem.setDeepDive` | ≈ favorite |
| Download / share | `DownloadService`, `ShareSheet.vue` | ≈ like–favorite |
| Opening details sidebar or comments | `App.vue:877`, `PostDetailsSidebar.vue` | mild positive |
| Tapping a tag | `TagSection.vue` | positive for that tag specifically |
| Unmuting, scrubbing, rewatch / loop | `FeedView.vue` video handlers | positive |
| Scrolling back up to a post | `determineCurrentPost` index going down | strong positive |
| Report / block | `ReportService` | strong negative |

### 1.5 One signal definition instead of three
The label mapping is duplicated in `SessionInterest.js:559`, `MLScorer.js:53` and `recommendation.worker.js:197-206`, with different numbers. Consolidate into one `signals.js` module so adding 1.3 and 1.4 is a single change.

### 1.6 Log impressions, not just interactions
Store one row per shown post: strategy, feed position, predicted score, exploration flag, active dwell, and the actions taken on it. This is the foundation for 2.1, 2.2 and the evaluation harness in Phase 4.

---

## Phase 2: Ranking that learns the right thing

### 2.1 Fix bandit credit assignment
- Every event on a post (timeSpent, like, favorite) is credited separately (`recommendation.worker.js:220-235`), so a liked post counts 2–3×.
- Interactions with no `_strategy` are credited to the current best arm (`:229-234`), which makes the leader win more by default: a rich-get-richer loop.
- `duo` is referenced in `rankPosts` and dedupe but no strategy produces it.

**Do:** one reward per impression (aggregated from 1.6), no credit for strategy-less posts, remove `duo`.

### 2.2 Remove static strategy bonuses
`rankPosts` (`recommendation.worker.js:652-657`) adds +0.3 to +0.5 by strategy. ML scores sit in [0, 1], so this bonus overrides the model on every re-rank. Exploration should be a deliberate slot (2.4), not a constant offset.

### 2.3 Multi-objective value model
The MLP regresses one soft label that mixes "skip", "watched a while" and "liked" (`MLScorer.js:53-77`). Production short-video rankers predict these separately and combine them:

```
value = w1·P(not skip) + w2·E[normalised dwell] + w3·P(like) + w4·P(fav/download/share)
```

Keep the shared trunk and add 3–4 sigmoid heads. The model stays tiny, the weights become tunable, and it can tell "watches but never likes" apart from "likes everything quickly".

### 2.4 Uncertainty-driven exploration instead of "bottom 40%"
`RecommendationSystem.js:482-515` fills every 4th slot from the **lowest-scored** 40% of candidates. That shows content the model is confident is bad, which costs retention and teaches little.

**Do:** pick exploration slots by upper confidence, not low score. Cheap options that fit the current MLP:
- **Neural-linear Thompson sampling:** a Bayesian linear layer on the 16-d last hidden layer; sample weights per feed build.
- **Small ensemble (3–5 heads)** and use their disagreement as uncertainty.

Then the explore slot gets "might be great, not sure yet", which is exactly the "branch out into what they'll probably enjoy" goal.

### 2.5 Diversity re-ranking
Nothing stops five posts in a row from the same artist or character. Add an MMR / sliding-window pass after scoring in `getCuratedExploreFeed` and `rankPosts`: penalise candidates similar (tag embedding + pHash) to the last ~5 shown, and cap repeats per artist/character/copyright inside a window.

### 2.6 Session model with fatigue
`SessionInterest` is a decaying bag of tags. Two upgrades:
- **Satiation:** repeated exposure to the same cluster within a session should lower its in-session value even when liked; this is what keeps a binge from turning stale.
- **Negative momentum:** consecutive skips in a cluster should pull it down fast and boost exploration weight for the next few slots.

A later step is a small attention model over the last ~30 impressions (SASRec-style), but satiation plus negative momentum captures most of the gain at a fraction of the cost.

### 2.7 Two-speed long-term profile
The 30-day half-life (`SessionInterest.js:557`) slowly erases long-standing favourites during a phase. Keep a slow "core" profile (≈ 6-month half-life) alongside the current one, and occasionally resurface dormant core interests as an exploration source.

---

## Phase 3: Exploration toward trends the user will probably like

### 3.1 Learn a tag graph from everything fetched, not just what was liked
`TagEmbedding.js:131-170` only builds co-occurrence from the user's positives, so it knows nothing about tags the user hasn't engaged with yet, which is exactly where discovery happens. Every candidate batch is a free, unlabeled corpus.

**Do:** maintain a second, global co-occurrence table from all fetched posts (capped, decayed), and build embeddings from it. Use the user's affinities as a vector in that space.

### 3.2 "Adjacent interest" strategy
New bandit arm: take a top interest, find its nearest neighbours in the global graph (3.1) that the user has little exposure to, and query those. This is the direct implementation of "branch out into what they're most likely to enjoy".

### 3.3 Personalised trending instead of global trending
The wildcard arm queries `order:rank age:<1mo` globally (`recommendation.worker.js:787`). Replace it with trending **within the user's neighbourhood**:
- Query `<neighbour tag> order:rank age:<1w`.
- Track tag velocity by comparing tag frequency in recent candidate batches with the longer-term global table; promote tags that are rising and close to the user's vector.
- Danbooru exposes related-tag and post-count endpoints that can seed this where the adapter supports it (`BooruAdapters.js` already wraps autocomplete).

### 3.4 Replace the hand-written noise-tag list
`COMMON_TAGS` is hard-coded in two places (`RecommendationSystem.js:27`, `recommendation.worker.js:15`) and silently removes tags like `long_hair` from learning for everyone. Use corpus IDF from 3.1 to downweight ubiquitous tags automatically; keep only true metadata tags (`highres`, `commentary`, `*_request`) on a fixed list.

### 3.5 Lean harder on the local AI tagger and visual features
WD tagger output and composition/pHash features exist but mostly sit inside the MLP. Using AI tags in the tag graph (3.1) and in candidate queries would let the engine discover visual styles the booru tags miss, and help sources with poor tagging.

---

## Phase 4: Seamless scrolling

### 4.1 Stream candidates into a ranked pool
`getCuratedExploreFeed` waits for every strategy with `Promise.all` (`RecommendationSystem.js:389`), so the slowest booru request gates the whole batch, and `FeedView.vue:505` can loop that up to 15 times. Instead, keep a background candidate pool of ~40–60 scored posts, insert each query's results as it lands, and let the feed pull from the pool. The runway then almost never waits on the network.

### 4.2 Take profile updates off the fetch path
Every feed fetch calls `updateUserProfile()` (`RecommendationSystem.js:247`), which re-reads interactions, hydrates image analysis and writes the full snapshot (model weights + embeddings + bandit) to IndexedDB (`recommendation.worker.js:308`). Update incrementally in `trackInteraction` and debounce snapshot writes.

### 4.3 Don't reshuffle what is already preloading
`scheduleSessionRanking` (`FeedView.vue:349`) re-ranks from `currentPostIndex + 1`. The next post's video may already be buffered, and swapping it out wastes that and causes a visible load. Freeze the next 2 slots and re-rank only beyond them.

### 4.4 Never dead-end
One empty fetch round sets `hasMorePosts = false` (`FeedView.vue:544`) and the feed ends. Escalate instead: relax modifiers, widen age ranges, switch to adjacent/trending arms, then global popular. Show the end row only when all fallbacks are exhausted.

### 4.5 Cheaper seen-filter
Each fetch rebuilds `blockedKeys` from the entire view history (`FeedView.vue:435-452`), which grows without bound. Keep an in-memory set that is updated incrementally (or a Bloom filter for very long histories).

### 4.6 Readiness-aware ordering
When the top two candidates score within a small margin, prefer the one whose media is already buffered. Demote posts that fail to load and don't count a load failure as a skip.

---

## Phase 5: Measure it

None of the above can be tuned confidently without numbers, and there is no offline evaluation today (the `tests/` folder covers behaviour, not ranking quality).

- **Replay evaluation:** train on interactions up to time T, score the impressions after T, report AUC, NDCG@10 and calibration. Run it from `MLDiagnosticsView.vue`, which already exists.
- **Retention metrics on-device:** session length, skip rate, time to first like, likes per 100 impressions, sessions per day. Surface them in `ProfileAnalyticsView.vue`, so changes can be compared before and after.
- **Exploration yield:** share of explore-slot posts that turn into positives, per arm. This is the number that tells you whether the engine is finding new interests or only shuffling old ones.

---

## Suggested order

| # | Item | Effort | Why now |
|---|---|---|---|
| 1 | 1.1 idle/background dwell, 1.2 log fast skips | S | Fixes wrong labels everywhere downstream |
| 2 | 1.5 single signal module, 1.6 impression log | S–M | Prerequisite for most of the rest |
| 3 | 4.3 freeze preload window, 4.4 no dead-end, 4.2 profile off fetch path | S | Immediate scrolling feel |
| 4 | 2.1 bandit credit, 2.2 remove strategy bonuses | S | Removes biases that fight the model |
| 5 | 1.3 normalised dwell, 1.4 extra implicit actions | M | Much richer interest detection with no user effort |
| 6 | 5 replay evaluation harness | M | Needed before tuning the model |
| 7 | 2.5 diversity, 2.6 satiation/negative momentum | M | Retention: fewer stale streaks |
| 8 | 2.4 uncertainty-driven exploration | M | Exploration that finds likely wins |
| 9 | 3.1 global tag graph, 3.2 adjacent arm, 3.3 personalised trending, 3.4 IDF | M–L | The "branch out into trends" goal |
| 10 | 4.1 streaming candidate pool | M–L | Near-zero waits |
| 11 | 2.3 multi-objective heads, 2.7 two-speed profile, 3.5 AI tags in graph | L | Model upgrades once signals and evaluation are solid |
