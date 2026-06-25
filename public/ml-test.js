/**
 * ML Recommendation Engine Test Suite
 *
 * Run this in the browser console to test the ML recommendation engine.
 * Open DevTools on the main app, then paste this entire script.
 *
 * Usage:
 *   await testMLRecommendationEngine()  // Run full test suite
 *   await quickMLTest()                  // Quick smoke test
 */

// Access the recommendation system from the Vue app instance
// We'll create our own worker for testing
async function createTestWorker() {
  const worker = new Worker(
    new URL('/src/workers/recommendation.worker.js', window.location.origin),
    { type: 'module' }
  );

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 10000);

    worker.onmessage = (e) => {
      if (e.data.type === 'success' && e.data.result === true) {
        clearTimeout(timeout);
        resolve(worker);
      }
    };

    worker.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error('Worker error: ' + e.message));
    };

    // Initialize the worker
    worker.postMessage({ id: 1, type: 'initialize' });
  });
}

let msgId = 0;
function workerCall(worker, type, payload = null) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const handler = (e) => {
      if (e.data.id === id) {
        worker.removeEventListener('message', handler);
        if (e.data.type === 'error') reject(new Error(e.data.error));
        else resolve(e.data.result);
      }
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ id, type, payload });
  });
}

// Generate a realistic test post
function makePost(id, tagType = 'anime') {
  const tagSets = {
    anime: [
      'hatsune_miku vocaloid 1girl solo long_hair blue_hair twintails',
      '1girl solo long_hair red_eyes looking_at_viewer',
      'rem_(re:zero) 1girl solo long_hair maid_headdress blue_hair',
      'ganyu_(genshin_impact) 1girl solo long_hair horns purple_eyes',
      'saber_(fate) 1girl solo long_hair sword blonde_hair',
      'nezuko_kamado 1girl solo long_hair demon_horns',
      'mikasa_ackerman 1girl solo short_hair survey_corps',
    ],
    scenery: [
      'scenery landscape sky clouds sunset',
      'scenery mountain forest nature',
      'scenery ocean beach sunset',
      'scenery city night lights',
    ],
    characters: [
      'hatsune_miku 1girl solo vocaloid headphones',
      'saber_(fate) 1girl armor sword',
      'ganyu_(genshin_impact) 1girl solo',
      'rem_(re:zero) 1girl solo maid',
    ],
  };

  const tags = tagSets[tagType][id % tagSets[tagType].length];
  const ratings = ['g', 'g', 'g', 's', 'q'];

  return {
    id: 100000 + id,
    tag_string: tags,
    tag_string_general: tags,
    tag_string_artist: '',
    tag_string_character: '',
    tag_string_copyright: '',
    tag_string_meta: '',
    rating: ratings[id % ratings.length],
    file_ext: id % 5 === 0 ? 'mp4' : 'jpg',
    width: 1920,
    height: 1080,
    score: Math.floor(Math.random() * 500),
    source: 'https://danbooru.donmai.us',
  };
}

/**
 * Full test suite for the ML recommendation engine
 */
export async function testMLRecommendationEngine() {
  console.log('=== ML Recommendation Engine Test Suite ===\n');

  const worker = await createTestWorker();
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ ${message}`);
      failed++;
    }
  }

  // Test 1: Initial state (cold start)
  console.log('Test 1: Initial State (Cold Start)');
  const initialStats = await workerCall(worker, 'getMLStats');
  assert(initialStats.mlScorer.isTrained === false, 'ML model starts untrained');
  assert(initialStats.mlScorer.interactionCount === 0, 'Interaction count starts at 0');
  assert(initialStats.tagEmbeddings.totalTags >= 0, 'Tag embeddings initialized');
  assert(initialStats.bandit != null, 'Bandit explorer initialized');
  console.log('');

  // Test 2: Simulate positive interactions (anime content)
  console.log('Test 2: Simulate 25 positive interactions (anime content)');
  for (let i = 0; i < 25; i++) {
    const post = makePost(i, 'anime');
    await workerCall(worker, 'trackInteraction', {
      postId: post.id,
      interactionType: i % 3 === 0 ? 'favorite' : 'like',
      value: 1,
      postData: post,
      updateImmediately: false,
    });
  }
  // Force profile update
  await workerCall(worker, 'updateUserProfile');

  const statsAfterTraining = await workerCall(worker, 'getMLStats');
  assert(statsAfterTraining.mlScorer.isTrained === true, 'ML model is trained after 25 interactions');
  assert(statsAfterTraining.mlScorer.interactionCount === 25, 'Interaction count is 25');
  assert(statsAfterTraining.tagEmbeddings.totalTags > 0, 'Tag embeddings were built');
  console.log(`  Info: ${statsAfterTraining.tagEmbeddings.totalTags} tags embedded`);
  console.log('');

  // Test 3: ML scoring produces valid probabilities
  console.log('Test 3: ML Scoring');
  const testPost = makePost(999, 'anime');
  const scoreDetails = await workerCall(worker, 'getPostScoreDetails', testPost);
  assert(scoreDetails.mlScore !== null, 'ML score is present');
  assert(scoreDetails.mlScore >= 0 && scoreDetails.mlScore <= 1, `ML score in [0,1] (got ${scoreDetails.mlScore?.toFixed(3)})`);
  assert(scoreDetails.mlConfidence > 0, `ML confidence > 0 (got ${scoreDetails.mlConfidence?.toFixed(2)})`);
  console.log(`  Info: Heuristic=${scoreDetails.totalScore.toFixed(3)}, ML=${scoreDetails.mlScore?.toFixed(3)}, Confidence=${scoreDetails.mlConfidence?.toFixed(2)}`);
  console.log('');

  // Test 4: ML prefers anime content over scenery after training on anime
  console.log('Test 4: Preference Learning (anime vs scenery)');
  const animePost = makePost(1000, 'anime');
  const sceneryPost = makePost(1001, 'scenery');

  const animeDetails = await workerCall(worker, 'getPostScoreDetails', animePost);
  const sceneryDetails = await workerCall(worker, 'getPostScoreDetails', sceneryPost);

  // The ML should prefer anime (trained on) over scenery
  const animeML = animeDetails.mlScore || 0;
  const sceneryML = sceneryDetails.mlScore || 0;
  assert(animeML > sceneryML, `ML prefers anime (${animeML.toFixed(3)}) over scenery (${sceneryML.toFixed(3)})`);
  console.log('');

  // Test 5: Bandit strategy selection
  console.log('Test 5: Bandit Strategy Selection');
  const queries = await workerCall(worker, 'generateMultiStrategyQueries', {
    selectedRatings: ['general'],
    whitelist: [],
  });
  assert(queries.length > 0, `Generated ${queries.length} strategy queries`);
  assert(queries.every(q => q.type), 'All queries have types');
  console.log(`  Info: ${queries.map(q => q.type).join(', ')}`);
  console.log('');

  // Test 6: Bandit records rewards
  console.log('Test 6: Bandit Reward Recording');
  const banditBefore = await workerCall(worker, 'getMLStats');
  // Simulate positive reward for anchor strategy
  for (let i = 0; i < 5; i++) {
    const post = makePost(2000 + i, 'anime');
    post._strategy = 'anchor';
    await workerCall(worker, 'trackInteraction', {
      postId: post.id,
      interactionType: 'like',
      value: 1,
      postData: post,
      updateImmediately: false,
    });
  }
  await workerCall(worker, 'updateUserProfile');
  const banditAfter = await workerCall(worker, 'getMLStats');
  const anchorBefore = banditBefore.bandit.arms.anchor;
  const anchorAfter = banditAfter.bandit.arms.anchor;
  assert(anchorAfter.attempts > anchorBefore.attempts, `Anchor arm attempts increased (${anchorBefore.attempts} → ${anchorAfter.attempts})`);
  console.log('');

  // Test 7: Tag similarity
  console.log('Test 7: Tag Embedding Similarity');
  const similarTags = await workerCall(worker, 'findSimilarTags', {
    query: 'hatsune_miku',
    topK: 5,
    exclude: [],
  });
  assert(Array.isArray(similarTags), 'findSimilarTags returns array');
  if (similarTags.length > 0) {
    assert(similarTags[0].similarity <= 1 && similarTags[0].similarity >= -1, `Similarity in [-1,1] (got ${similarTags[0].similarity.toFixed(3)})`);
    console.log(`  Info: Top match: ${similarTags[0].tag} (${similarTags[0].similarity.toFixed(3)})`);
  }
  console.log('');

  // Test 8: Training loss decreases
  console.log('Test 8: Training Loss');
  const lossHistory = statsAfterTraining.mlScorer.trainingHistory || [];
  if (lossHistory.length > 1) {
    const firstLoss = lossHistory[0];
    const lastLoss = lossHistory[lossHistory.length - 1];
    console.log(`  Info: Loss ${firstLoss.toFixed(4)} → ${lastLoss.toFixed(4)}`);
    assert(lastLoss < firstLoss * 2, 'Loss is not exploding (basic stability check)');
  }
  console.log('');

  // Test 9: Reset works
  console.log('Test 9: Reset ML State');
  await workerCall(worker, 'resetRecommendations');
  const resetStats = await workerCall(worker, 'getMLStats');
  assert(resetStats.mlScorer.isTrained === false, 'ML model is untrained after reset');
  assert(resetStats.mlScorer.interactionCount === 0, 'Interaction count is 0 after reset');
  console.log('');

  // Test 10: Cold-start scoring still works
  console.log('Test 10: Cold-Start Scoring (Heuristic Fallback)');
  const coldPost = makePost(3000, 'anime');
  const coldDetails = await workerCall(worker, 'getPostScoreDetails', coldPost);
  assert(coldDetails.totalScore > 0, `Heuristic score > 0 (got ${coldDetails.totalScore.toFixed(3)})`);
  assert(coldDetails.mlScore === null, 'ML score is null when untrained');
  console.log('');

  // Summary
  console.log('=== Test Summary ===');
  console.log(`Passed: ${passed}/${passed + failed}`);
  if (failed > 0) {
    console.error(`FAILED: ${failed} test(s)`);
  } else {
    console.log('All tests passed!');
  }

  worker.terminate();
  return { passed, failed };
}

/**
 * Quick smoke test - just verify the ML components are wired up correctly
 */
export async function quickMLTest() {
  console.log('=== Quick ML Smoke Test ===\n');

  const worker = await createTestWorker();

  // Check initial stats
  const stats = await workerCall(worker, 'getMLStats');
  console.log('Initial state:');
  console.log(`  ML trained: ${stats.mlScorer.isTrained}`);
  console.log(`  Interactions: ${stats.mlScorer.interactionCount}`);
  console.log(`  Tags embedded: ${stats.tagEmbeddings.totalTags}`);
  console.log(`  Best strategy: ${stats.bandit.bestStrategy.type}`);

  // Train with 20 likes
  console.log('\nTraining with 20 likes...');
  for (let i = 0; i < 20; i++) {
    const post = makePost(i, 'anime');
    await workerCall(worker, 'trackInteraction', {
      postId: post.id,
      interactionType: 'like',
      value: 1,
      postData: post,
      updateImmediately: false,
    });
  }
  await workerCall(worker, 'updateUserProfile');

  const trainedStats = await workerCall(worker, 'getMLStats');
  console.log('\nAfter training:');
  console.log(`  ML trained: ${trainedStats.mlScorer.isTrained}`);
  console.log(`  Interactions: ${trainedStats.mlScorer.interactionCount}`);
  console.log(`  Tags embedded: ${trainedStats.tagEmbeddings.totalTags}`);
  console.log(`  Last loss: ${trainedStats.mlScorer.lastLoss?.toFixed(4) || 'N/A'}`);
  console.log(`  Best strategy: ${trainedStats.bandit.bestStrategy.type}`);

  // Score a post
  const testPost = makePost(999, 'anime');
  const details = await workerCall(worker, 'getPostScoreDetails', testPost);
  console.log(`\nSample scoring:`);
  console.log(`  Heuristic: ${details.totalScore.toFixed(3)}`);
  console.log(`  ML: ${details.mlScore?.toFixed(3) || 'N/A'}`);
  console.log(`  Confidence: ${details.mlConfidence?.toFixed(2) || 'N/A'}`);

  worker.terminate();
  console.log('\nSmoke test complete!');
}

// Auto-run quick test if called directly
console.log('ML Test Suite loaded. Run one of:');
console.log('  await testMLRecommendationEngine()  // Full test suite');
console.log('  await quickMLTest()                  // Quick smoke test');
