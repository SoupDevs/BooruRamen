# Recommendation Engine Analysis & Modernization Plan

## Current Architecture Overview

The recommendation engine in BooruRamen follows a **proxy-worker pattern**:

- **`RecommendationSystem.js`** — Main-thread proxy that delegates all heavy computation to a Web Worker
- **`recommendation.worker.js`** — Contains `RecommendationWorkerCore`, the actual scoring/ranking logic
- **`StorageService.js`** — IndexedDB persistence via Dexie.js for interactions, profile snapshots, view history
- **`interactions.js`** — Pinia store wrapping StorageService for reactive UI state

### Data Flow

1. **Interaction tracking**: User actions (like/dislike/favorite/view/timeSpent) → `StorageService.storeInteraction()` → IndexedDB
2. **Profile building**: On init or every 5 min, `updateUserProfile()` loads interactions, extracts tags per category (artist/copyright/character/general/meta), applies time-decay (`e^(-0.05 * hours)`), and normalizes to [-1, 1]
3. **Scoring**: `scorePost()` computes a weighted score per post using category multipliers (character=2.5x, copyright=2.0x, artist=2.0x, general=0.4x, meta=0.0x), rating preference, media type preference, familiar/novel bonus, and random noise
4. **Query generation**: `generateMultiStrategyQueries()` picks tags via weighted random selection from top-25 pool, building anchor/pivot/reach/wildcard strategies
5. **Feed assembly**: `getCuratedExploreFeed()` runs multiple strategies in parallel, deduplicates, scores all posts, splits into ranked (top 60%) and discovery (bottom 40%) buckets, interleaves every 4th position with discovery

### Scoring Formula Breakdown

```
score = 0.1 (base)
      + weightedTagScore * 3.0
      + ratingPreference * 2.0
      + mediaTypePreference * 1.5
      + discoveryBonus (0.25 if familiar && novel)
      + random(0, 0.2)

where weightedTagScore = Σ(avgCategoryScore * categoryMultiplier * count) / totalCount
```

---

## Critical Weaknesses

### 1. No Machine Learning — Pure Heuristic Scoring
The engine is entirely hand-tuned weights. There's no model learning from user behavior patterns. The category multipliers (2.5x, 2.0x, 0.4x) are fixed constants, not learned from data.

### 2. Tag Scoring is Primitive
- Tag scores are simply accumulated: `rawTagScores[tag] += weight` for every interaction
- Normalization is just `score / max(|scores|)` — a simple min-max to [-1, 1]
- No TF-IDF, no embeddings, no collaborative filtering
- Tag relationships/co-occurrences are completely ignored

### 3. Cold Start Problem
New users get a default profile (`general: 1.0`, `image: 0.8, video: 0.2`). There's no onboarding flow, no popular content seeding, no demographic-based defaults.

### 4. Exploration Strategy is Shallow
- `generateMultiStrategyQueries()` uses weighted random selection from top tags
- "Exploration" just means picking a random modifier (`age:>3mo`, `order:rank`, etc.)
- No true content-based exploration or diversity optimization
- The "discovery bucket" (bottom 40% of scored posts) is just lower-scored items, not genuinely diverse content

### 5. Performance Concerns for Mobile
- `scorePost()` iterates ALL tags of EVERY post with multiple string splits and Set lookups
- `getCuratedExploreFeed()` fetches from multiple strategies (up to 5 API calls), then scores ALL returned posts client-side
- The `postScoreCache` is in-memory only, cleared on every interaction
- `updateUserProfile()` reprocesses ALL interactions from scratch (though it tries incremental)
- No lazy evaluation — scoring happens on the full candidate set

### 6. No Session Context
The engine has no concept of session intent drift. If a user starts viewing anime characters and shifts to landscapes, the engine continues recommending based on historical averages.

### 7. Tag Caching is Underutilized
`GelbooruTagCache.js` exists but is only used for category lookup during scoring. There's no pre-computed tag similarity or clustering.

---

## Evaluation of Improvement Paths

### Path A: Enhanced Heuristics (Low Effort, Low Impact)
**What**: Tune weights, add tag co-occurrence tracking, improve exploration modifiers.
**Pros**: No new infrastructure, works in the Web Worker as-is.
**Cons**: Still fundamentally limited by manual tuning. Diminishing returns.
**Verdict**: Not worth it as a primary path.

### Path B: On-Device Lightweight ML (Medium Effort, High Impact)
**What**: Train a small neural network or logistic regression model in the Web Worker using TensorFlow.js or a hand-rolled approach.
- **Feature vector**: Tag embeddings (pre-trained or co-occurrence based), user history window, time-of-day, session length
- **Model**: Simple 2-layer MLP predicting engagement probability
- **Training**: Online learning from user interactions (like = positive label, dislike = negative, view+time = weak positive)
- **Inference**: <5ms per post on mobile

**Pros**:
- True personalization, learns individual preferences
- Can discover non-obvious tag correlations
- Runs entirely offline (privacy-friendly)
- Small model (<100KB) has negligible memory impact

**Cons**:
- Requires embedding infrastructure or feature engineering
- Cold-start still needs handling
- Training data sparsity for new users
- Need to manage model versioning in IndexedDB

**Verdict**: **RECOMMENDED as primary path.** Best effort-to-impact ratio for mobile.

### Path C: Server-Side Collaborative Filtering (High Effort, Very High Impact)
**What**: Move recommendation to a server, train matrix factorization or transformer models on aggregate user data.
**Pros**: Can leverage cross-user patterns, much more powerful.
**Cons**: Requires server infrastructure, breaks offline-first architecture, privacy concerns, network latency on mobile.
**Verdict**: Not aligned with current architecture. Future possibility but not now.

### Path D: Embedding-Based Similarity (Medium Effort, Medium-High Impact)
**What**: Use pre-computed tag embeddings (e.g., from a trained Word2Vec/Node2Vec on booru tag co-occurrence) to compute semantic similarity between user profile and candidate posts.
**Pros**: Can find semantically related content even with no direct tag overlap. No training needed at runtime.
**Cons**: Requires offline pre-computation of embeddings. Static (doesn't personalize per user). Large storage for embedding table.
**Verdict**: Good complement to Path B, not a standalone solution.

### Path E: Multi-Armed Bandit for Exploration (Low-Medium Effort, Medium Impact)
**What**: Replace the fixed ranked/discovery interleaving with a contextual bandit (e.g., Thompson Sampling) that optimizes exploration vs exploitation per session.
**Pros**: Mathematically optimal exploration. Naturally adapts to user response.
**Cons**: Doesn't solve the underlying scoring quality issue. Needs per-post features.
**Verdict**: Good addition on top of Path B.

---

## Recommended Architecture (Path B + E)

### Phase 1: Feature Engineering & Embeddings
1. **Tag co-occurrence matrix** — Build from user's own interaction history + optionally a pre-computed matrix from public booru data. Tags that frequently appear together get high similarity.
2. **User interest vector** — Weighted average of tag embeddings from positive interactions, with time decay.
3. **Post feature vector** — Concatenation of tag embedding averages + metadata features (rating, media type, resolution, artist familiarity).

### Phase 2: Lightweight Scoring Model
Replace `scorePost()` with a small logistic regression or 2-layer MLP:

```
Input: [user_interest_vector (64d), post_feature_vector (64d), context_features (8d)]
Hidden: 32 units, ReLU
Output: engagement probability (sigmoid)
```

- Trained online via SGD on user interactions
- Model weights stored in IndexedDB
- Inference: ~2ms per post on mobile
- Fallback to current heuristic when < 50 interactions (cold start)

### Phase 3: Smart Exploration via Bandit
- Maintain per-tag "uncertainty" estimates
- Use Thompson Sampling to select which strategy to explore
- Reward signal: did user engage (like/favorite/time-spent) with explored content?
- Naturally shifts from exploration to exploitation as confidence grows

### Phase 4: Performance Optimizations
1. **Pre-filtering**: Before full scoring, filter posts with < 3 matching tags to user's top-50 interests (cheap O(1) set intersection)
2. **Batch scoring**: Score posts in chunks of 20 via `requestIdleCallback` to avoid jank
3. **Incremental updates**: Only re-score new posts when user profile changes, not the entire cache
4. **Model quantization**: Use 8-bit quantized weights for the MLP (4x memory reduction)

---

## Mobile Performance Budget

| Operation | Current Budget | Target Budget |
|-----------|---------------|---------------|
| Score single post | ~0.5ms | ~2ms (ML inference) |
| Score 100 posts | ~50ms | ~200ms (batched) |
| Profile update | ~100ms | ~150ms (incremental) |
| Query generation | ~5ms | ~10ms (bandit) |
| Total feed assembly | ~200ms | ~500ms |
| Memory (model) | 0 | ~200KB |
| Memory (cache) | ~5MB | ~10MB |

The ML approach adds ~300ms to feed assembly but provides significantly better personalization. The 200KB model size is negligible on modern devices.

---

## Implementation Priority

1. **Tag co-occurrence features** (immediate, 1-2 days) — Highest ROI, no new dependencies
2. **Lightweight MLP scorer** (3-5 days) — Core improvement
3. **Thompson Sampling exploration** (2-3 days) — Complements the scorer
4. **Performance optimizations** (1-2 days) — Ensures smooth mobile experience
5. **Cold-start onboarding** (1-2 days) — Improves new user retention

Total estimated effort: ~2-3 weeks for one developer.
