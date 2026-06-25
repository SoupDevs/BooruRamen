import StorageService from '../services/StorageService';

// Constants for recommendation system
const INTERACTION_WEIGHTS = {
    like: 1.0,
    dislike: -1.0,
    favorite: 2.0,
    view: 0.2,
    timeSpent: 0.1 // Weight per second spent viewing content
};

// Tag categories for embedding generation
const TAG_CATEGORIES = [
    'artist', 'copyright', 'character', 'general', 'meta'
];

export const COMMON_TAGS = [
    '1girl', '1boy', '2girls', '2boys', 'solo', 'comic', 'monochrome',
    'greyscale', 'unknown_artist', 'text', 'commentary', 'translated',
    'multiple_girls', 'multiple_boys', 'scenery', 'original', 'highres',
    'absurdres', 'check_commentary', 'photo', 'parody',
    'long_hair', 'breasts', 'large_breasts', 'looking_at_user', 'short_hair',
    'animated', 'tagme', 'copyright_request', 'spoiler', 'source_request',
    'artist_request', 'character_request', 'cosplay_request', 'check_character',
    'duplicate', 'sound', 'looking_at_viewer', 'looking_at_another',
    'simple_background'
];

class RecommendationWorkerCore {
    constructor() {
        this.userEmbedding = null;
        this.rawTagScores = {};
        this.rawRatingPreferences = { general: 0, sensitive: 0, questionable: 0, explicit: 0 };
        this.rawMediaTypePreferences = { image: 0, video: 0 };
        this.tagScores = {};
        this.tagEngagement = {};
        this.tagCategories = {};
        this.ratingPreferences = null;
        this.mediaTypePreferences = null;
        this.avoidedTags = [...COMMON_TAGS];
        this.lastUpdateTime = 0;
        this.postScoreCache = new Map();
        this.strategyCursors = {};
        this.exhaustedStrategies = new Set();
    }

    async initialize() {
        this.strategyCursors = {};
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            this.strategyCursors = {};
            this.exhaustedStrategies = new Set();
            await this.updateUserProfile();

            if (this.updateInterval) clearInterval(this.updateInterval);
            this.updateInterval = setInterval(() => this.updateUserProfile(), 5 * 60 * 1000);
        })();

        return this.initPromise;
    }

    resetExploreSession() {
        this.strategyCursors = {};
        this.exhaustedStrategies = new Set();
    }

    applyDecay(hoursPassed) {
        const decayFactor = Math.exp(-0.05 * hoursPassed);
        for (const tag in this.rawTagScores) {
            this.rawTagScores[tag] *= decayFactor;
            if (Math.abs(this.rawTagScores[tag]) < 0.01) delete this.rawTagScores[tag];
        }
        for (const rating in this.rawRatingPreferences) {
            this.rawRatingPreferences[rating] *= decayFactor;
        }
        for (const type in this.rawMediaTypePreferences) {
            this.rawMediaTypePreferences[type] *= decayFactor;
        }
    }

    async updateUserProfile() {
        const preferences = await StorageService.getPreferences();
        if (preferences.avoidedTags && Array.isArray(preferences.avoidedTags)) {
            this.avoidedTags = preferences.avoidedTags;
        } else {
            this.avoidedTags = [...COMMON_TAGS];
        }

        const resetTimestamp = preferences.recommendationResetTime || 0;
        const now = Date.now();
        let interactions = [];
        let isIncremental = false;

        const snapshot = await StorageService.getProfileSnapshot();

        if (snapshot && (!resetTimestamp || snapshot.timestamp > resetTimestamp)) {
            this.rawTagScores = snapshot.rawTagScores || snapshot.tagScores || {};
            this.tagEngagement = snapshot.tagEngagement || {};
            this.tagCategories = snapshot.tagCategories || {};
            this.rawRatingPreferences = snapshot.ratingPreferences || { general: 0, sensitive: 0, questionable: 0, explicit: 0 };
            this.rawMediaTypePreferences = snapshot.mediaTypePreferences || { image: 0, video: 0 };
            this.lastUpdateTime = snapshot.timestamp || 0;

            const hoursSinceSnapshot = (now - this.lastUpdateTime) / (1000 * 60 * 60);
            if (hoursSinceSnapshot > 0) this.applyDecay(hoursSinceSnapshot);

            interactions = await StorageService.getRecentInteractions(this.lastUpdateTime);
            isIncremental = true;
        } else {
            this.initializeDefaultProfile();
            interactions = await StorageService.getInteractions();
            if (resetTimestamp > 0) {
                interactions = interactions.filter(i => i.timestamp > resetTimestamp);
            }
        }

        if (interactions.length === 0 && !isIncremental) {
            this.normalizeScores();
            return;
        }

        interactions.forEach(interaction => {
            const ageInHours = (now - interaction.timestamp) / (1000 * 60 * 60);
            const recencyWeight = Math.exp(-0.05 * ageInHours);
            let weight = INTERACTION_WEIGHTS[interaction.type] || 0;
            weight *= recencyWeight;

            if (interaction.type === 'timeSpent') {
                weight *= (interaction.value / 1000);
            }

            if (interaction.metadata && interaction.metadata.post) {
                this.updateProfileWithPost(interaction.metadata.post, weight);
            }
        });

        this.lastUpdateTime = now;
        await StorageService.storeProfileSnapshot({
            timestamp: now,
            rawTagScores: this.rawTagScores,
            tagEngagement: this.tagEngagement,
            tagCategories: this.tagCategories,
            ratingPreferences: this.rawRatingPreferences,
            mediaTypePreferences: this.rawMediaTypePreferences
        });

        this.normalizeScores();
    }

    updateProfileWithPost(post, weight) {
        const avoidedSet = new Set(this.avoidedTags || []);
        const processTag = (tag, category) => {
            if (!tag || avoidedSet.has(tag)) return;
            if (this.rawTagScores[tag] === undefined) {
                this.rawTagScores[tag] = 0;
                this.tagCategories[tag] = category;
            }
            if (this.tagEngagement[tag] === undefined) {
                this.tagEngagement[tag] = 0;
            }
            this.rawTagScores[tag] += weight;
            this.tagEngagement[tag] += Math.abs(weight);
        };

        TAG_CATEGORIES.forEach(category => {
            const tagString = post[`tag_string_${category}`] || '';
            if (tagString) tagString.split(' ').forEach(tag => processTag(tag, category));
        });

        const generalTags = post.tag_string || '';
        if (generalTags) {
            generalTags.split(' ').forEach(tag => {
                if (avoidedSet.has(tag)) return;
                if (tag && this.tagCategories[tag] === undefined) {
                    processTag(tag, 'general');
                } else if (tag && this.tagCategories[tag] === 'general') {
                    this.rawTagScores[tag] += weight;
                    this.tagEngagement[tag] += Math.abs(weight);
                }
            });
        }

        if (post.rating) {
            if (this.rawRatingPreferences[post.rating] === undefined) this.rawRatingPreferences[post.rating] = 0;
            this.rawRatingPreferences[post.rating] += weight;
        }

        if (post.file_ext) {
            const isVideo = ['mp4', 'webm'].includes(post.file_ext);
            const type = isVideo ? 'video' : 'image';
            this.rawMediaTypePreferences[type] += weight;
        }
    }

    normalizeScores() {
        this.tagScores = {};
        const tagScoreValues = Object.values(this.rawTagScores);
        if (tagScoreValues.length > 0) {
            const maxTagScore = Math.max(...tagScoreValues.map(Math.abs));
            if (maxTagScore > 0) {
                for (const tag in this.rawTagScores) {
                    this.tagScores[tag] = this.rawTagScores[tag] / maxTagScore;
                }
            } else {
                this.tagScores = { ...this.rawTagScores };
            }
        }

        this.ratingPreferences = {};
        const totalRatingScore = Object.values(this.rawRatingPreferences).reduce((sum, val) => sum + Math.max(0, val), 0);
        if (totalRatingScore > 0) {
            for (const rating in this.rawRatingPreferences) {
                this.ratingPreferences[rating] = Math.max(0, this.rawRatingPreferences[rating]) / totalRatingScore;
            }
        } else {
            const ratings = Object.keys(this.rawRatingPreferences);
            ratings.forEach(rating => this.ratingPreferences[rating] = 1 / ratings.length);
        }

        this.mediaTypePreferences = {};
        const totalMediaScore = Math.max(0.001, this.rawMediaTypePreferences.image + this.rawMediaTypePreferences.video);
        this.mediaTypePreferences.image = this.rawMediaTypePreferences.image / totalMediaScore;
        this.mediaTypePreferences.video = this.rawMediaTypePreferences.video / totalMediaScore;
    }

    initializeDefaultProfile() {
        this.rawTagScores = {};
        this.tagScores = {};
        this.tagEngagement = {};
        this.tagCategories = {};

        this.rawRatingPreferences = { general: 1.0, sensitive: 0.0, questionable: 0, explicit: 0 };
        this.ratingPreferences = { ...this.rawRatingPreferences };

        this.rawMediaTypePreferences = { image: 0.8, video: 0.2 };
        this.mediaTypePreferences = { ...this.rawMediaTypePreferences };

        this.lastUpdateTime = Date.now();
    }

    async resetRecommendations() {
        const resetTime = Date.now();
        await StorageService.storePreferences({ recommendationResetTime: resetTime });

        const preferences = await StorageService.getPreferences();
        if (preferences.avoidedTags && Array.isArray(preferences.avoidedTags)) {
            this.avoidedTags = preferences.avoidedTags;
        } else {
            this.avoidedTags = [...COMMON_TAGS];
        }

        this.initializeDefaultProfile();
        this.postScoreCache.clear();
        this.resetExploreSession();

        await StorageService.storeProfileSnapshot({
            timestamp: resetTime,
            rawTagScores: this.rawTagScores,
            tagEngagement: this.tagEngagement,
            tagCategories: this.tagCategories,
            ratingPreferences: this.rawRatingPreferences,
            mediaTypePreferences: this.rawMediaTypePreferences
        });
    }

    async trackInteraction(postId, interactionType, value, postData, updateImmediately = false) {
        await StorageService.storeInteraction({
            postId,
            type: interactionType,
            value,
            metadata: { post: postData }
        });

        this.postScoreCache.delete(postId);

        if (updateImmediately) {
            await this.updateUserProfile();
        }
    }

    scorePost(post) {
        if (this.postScoreCache.has(post.id)) {
            return this.postScoreCache.get(post.id);
        }
        if (!this.tagScores) {
            this.updateUserProfile();
        }

        let score = 0;
        score += 0.1;

        const CATEGORY_MULTIPLIERS = { character: 2.5, copyright: 2.0, artist: 2.0, general: 0.4, meta: 0.0 };
        const categoryScores = {
            character: { sum: 0, count: 0 },
            copyright: { sum: 0, count: 0 },
            artist: { sum: 0, count: 0 },
            general: { sum: 0, count: 0 },
            meta: { sum: 0, count: 0 }
        };

        let familiarWeight = 0;
        let novelCount = 0;
        const noiseTags = new Set(this.avoidedTags || []);

        const processTag = (tag, category) => {
            if (!tag || noiseTags.has(tag)) return;

            const tagScoreVal = this.tagScores?.[tag] || 0;
            const engagement = this.tagEngagement?.[tag] || 0;
            const resolvedCategory = this.tagCategories?.[tag] || category || 'general';

            if (categoryScores[resolvedCategory]) {
                categoryScores[resolvedCategory].sum += tagScoreVal;
                categoryScores[resolvedCategory].count++;
            }

            if (engagement > 0) {
                if (tagScoreVal > 0.3) {
                    if (['character', 'copyright', 'artist'].includes(resolvedCategory)) {
                        familiarWeight += 1.0;
                    } else {
                        familiarWeight += 0.2;
                    }
                }
            } else {
                novelCount++;
            }
        };

        TAG_CATEGORIES.forEach(category => {
            const tagString = post[`tag_string_${category}`] || '';
            if (tagString) tagString.split(' ').forEach(tag => processTag(tag, category));
        });

        const generalTags = post.tag_string || '';
        if (generalTags) {
            generalTags.split(' ').forEach(tag => {
                if (!TAG_CATEGORIES.some(cat => post[`tag_string_${cat}`]?.includes(tag))) {
                    processTag(tag, 'general');
                }
            });
        }

        let weightedTagScore = 0;
        let totalTagCount = 0;
        for (const [category, data] of Object.entries(categoryScores)) {
            if (data.count > 0) {
                const multiplier = CATEGORY_MULTIPLIERS[category] || 0;
                const avgCategoryScore = data.sum / data.count;
                weightedTagScore += avgCategoryScore * multiplier * data.count;
                totalTagCount += data.count;
            }
        }

        if (totalTagCount > 0) {
            score += (weightedTagScore / totalTagCount) * 3.0;
        }

        if (familiarWeight >= 1.0 && novelCount >= 5) {
            score += 0.25;
        }

        if (post.rating && this.ratingPreferences[post.rating]) {
            score += this.ratingPreferences[post.rating] * 2.0;
        }

        if (post.file_ext) {
            const isVideo = ['mp4', 'webm'].includes(post.file_ext);
            score += this.mediaTypePreferences[isVideo ? 'video' : 'image'] * 1.5;
        }

        score += Math.random() * 0.2;

        this.postScoreCache.set(post.id, score);
        return score;
    }

    scorePosts(posts) {
        return posts.map(post => ({ post, score: this.scorePost(post) }));
    }

    getPostScoreDetails(post) {
        if (!this.tagScores) this.initializeDefaultProfile();

        const details = {
            totalScore: 0, baseScore: 0.1, ratingScore: 0, mediaScore: 0,
            tagScore: 0, discoveryBonus: 0, familiarWeight: 0, novelTagCount: 0,
            contributingTags: []
        };

        details.totalScore += details.baseScore;
        let tagScoreSum = 0;
        let tagCount = 0;
        const contributors = [];
        const noiseTags = new Set(this.avoidedTags || []);

        const processTag = (tag, category) => {
            if (!tag || noiseTags.has(tag)) return;
            const tagScoreValue = this.tagScores[tag] || 0;
            const tagEngagementValue = this.tagEngagement?.[tag] || 0;
            const storedCategory = this.tagCategories?.[tag] || category || 'general';

            if (this.tagScores[tag] !== undefined) {
                tagCount++;
                tagScoreSum += tagScoreValue;
                contributors.push({ tag, score: tagScoreValue, category: storedCategory });
            }

            if (tagEngagementValue > 0) {
                if (tagScoreValue > 0.3) {
                    if (['character', 'copyright', 'artist'].includes(storedCategory)) {
                        details.familiarWeight += 1.0;
                    } else {
                        details.familiarWeight += 0.2;
                    }
                }
            } else {
                details.novelTagCount++;
            }
        };

        TAG_CATEGORIES.forEach(category => {
            const tagString = post[`tag_string_${category}`] || '';
            if (tagString) tagString.split(' ').forEach(tag => processTag(tag, category));
        });

        const generalTags = post.tag_string || '';
        if (generalTags) {
            generalTags.split(' ').forEach(tag => {
                if (!TAG_CATEGORIES.some(cat => post[`tag_string_${cat}`]?.includes(tag))) {
                    processTag(tag, 'general');
                }
            });
        }

        if (tagCount > 0) {
            details.tagScore = (tagScoreSum / tagCount) * 3.0;
            details.totalScore += details.tagScore;
        }

        details.contributingTags = contributors.sort((a, b) => b.score - a.score).slice(0, 10);

        if (details.familiarWeight >= 1.0 && details.novelTagCount >= 5) {
            details.discoveryBonus = 0.25;
            details.totalScore += details.discoveryBonus;
        }

        if (post.rating && this.ratingPreferences[post.rating]) {
            details.ratingScore = this.ratingPreferences[post.rating] * 2.0;
            details.totalScore += details.ratingScore;
        }

        if (post.file_ext) {
            const isVideo = ['mp4', 'webm'].includes(post.file_ext);
            details.mediaScore = this.mediaTypePreferences[isVideo ? 'video' : 'image'] * 1.5;
            details.totalScore += details.mediaScore;
        }

        return details;
    }

    rankPosts(posts) {
        if (!posts || posts.length === 0) return [];
        const scoredPosts = posts.map(post => {
            let score = this.scorePost(post);
            switch (post._strategy) {
                case 'pivot': score += 0.3; break;
                case 'reach': score += 0.5; break;
                case 'wildcard': score += 0.4; break;
                case 'duo': score += 0.5; break;
            }
            return { post, score };
        });
        scoredPosts.sort((a, b) => b.score - a.score);
        return scoredPosts.map(sp => sp.post);
    }

    summarizeTagScores(limit = 10) {
        const sortedTags = Object.entries(this.tagScores || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit);
        return Object.fromEntries(sortedTags);
    }

    getRecommendedTags(limit = 5) {
        if (!this.tagScores) return [];
        return Object.entries(this.tagScores)
            .filter(([tag, score]) => score > 0 && this.tagCategories[tag] !== 'meta')
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([tag]) => tag);
    }

    getRecommendedRatings() {
        if (!this.ratingPreferences) return ['general'];
        return Object.entries(this.ratingPreferences)
            .filter(([_, pref]) => pref > 0.15)
            .map(([rating]) => rating);
    }

    buildRecommendedQueryParams(includeUserTags = true, exploreMode = false) {
        let tags = [];
        if (includeUserTags && this.tagScores) {
            const recommendedTags = this.getRecommendedTags(1);
            if (recommendedTags.length > 0) tags.push(recommendedTags[0]);
        }
        if (exploreMode && tags.length < 2) {
            const saferStrategies = ['age:<1d', 'age:<3d', 'age:<1w', 'order:rank', 'order:favcount'];
            tags.push(saferStrategies[Math.floor(Math.random() * saferStrategies.length)]);
        }
        return { tags: tags.join(' ') };
    }

    getQueryableTags() {
        return this.getQueryableTagsWithScores().map(item => item.tag);
    }

    getQueryableTagsWithScores() {
        if (!this.tagScores) return [];
        const QUERY_CATEGORY_WEIGHTS = { character: 1.0, copyright: 1.0, artist: 1.0, general: 0.5, meta: 0.0 };
        return Object.entries(this.tagScores)
            .filter(([tag, score]) => score > 0)
            .filter(([tag]) => this.tagCategories[tag] !== 'meta')
            .filter(([tag]) => !this.avoidedTags.includes(tag))
            .filter(([tag]) => tag !== 'video')
            .map(([tag, score]) => {
                const category = this.tagCategories?.[tag] || 'general';
                const weight = QUERY_CATEGORY_WEIGHTS[category] ?? 0.15;
                return { tag, score: score * weight };
            })
            .sort((a, b) => b.score - a.score);
    }

    weightedRandomSelect(candidates, exclude = new Set()) {
        const available = candidates.filter(c => !exclude.has(c.tag) && !this.exhaustedStrategies.has(c.tag));
        if (available.length === 0) return null;
        const totalWeight = available.reduce((sum, c) => sum + Math.max(0.01, c.score), 0);
        let random = Math.random() * totalWeight;
        for (const candidate of available) {
            random -= Math.max(0.01, candidate.score);
            if (random <= 0) return candidate;
        }
        return available[available.length - 1];
    }

    generateMultiStrategyQueries(selectedRatings = ['general'], whitelist = []) {
        const queries = [];
        let topTagsWithScores = this.getQueryableTagsWithScores();
        if (topTagsWithScores.length === 0 && whitelist && whitelist.length > 0) {
            topTagsWithScores = whitelist.slice(0, 10).map((tag, index) => ({
                tag, score: 1.0 - (index * 0.05)
            }));
        }
        topTagsWithScores = topTagsWithScores.filter(t => t.tag !== 'video');
        const tier1Pool = topTagsWithScores.slice(0, 10);
        const tier2Pool = topTagsWithScores.slice(10, 25);
        const usedTags = new Set();
        const anchorTag = this.weightedRandomSelect(tier1Pool, usedTags);
        if (anchorTag && !this.exhaustedStrategies.has(anchorTag.tag)) {
            queries.push({ tags: anchorTag.tag, type: 'anchor', intent: 'Core interest - highest affinity content' });
            usedTags.add(anchorTag.tag);
        }
        const pivotModifiers = ['age:>3mo', 'age:>1y', 'order:rank age:<1mo', 'order:favcount age:<1mo'];
        for (let i = 0; i < 2; i++) {
            const pivotTag = this.weightedRandomSelect(tier1Pool, usedTags);
            if (pivotTag) {
                const modifier = pivotModifiers[Math.floor(Math.random() * pivotModifiers.length)];
                const pivotQuery = `${pivotTag.tag} ${modifier}`;
                if (!this.exhaustedStrategies.has(pivotQuery)) {
                    queries.push({ tags: pivotQuery, type: 'pivot', intent: `Core interest "${pivotTag.tag}" + modifier` });
                    usedTags.add(pivotTag.tag);
                }
            }
        }
        if (tier2Pool.length > 0) {
            const reachTag = this.weightedRandomSelect(tier2Pool, usedTags);
            if (reachTag && !this.exhaustedStrategies.has(reachTag.tag)) {
                queries.push({ tags: reachTag.tag, type: 'reach', intent: 'Secondary interest - expanding horizons' });
                usedTags.add(reachTag.tag);
            }
        }
        const wildcardOptions = ['order:rank age:<1mo', 'order:popular age:<1mo'];
        const wildcardQuery = wildcardOptions[Math.floor(Math.random() * wildcardOptions.length)];
        if (!this.exhaustedStrategies.has(wildcardQuery)) {
            queries.push({ tags: wildcardQuery, type: 'wildcard', intent: 'Global discovery - trending content' });
        }
        if (queries.length === 0) {
            const fallbacks = ['order:rank age:<1mo', 'order:popular age:<1mo', 'age:<1w'];
            for (const fb of fallbacks) {
                if (!this.exhaustedStrategies.has(fb)) {
                    queries.push({ tags: fb, type: 'fallback', intent: 'Emergency fallback' });
                    break;
                }
            }
        }
        return queries.filter((query, index, self) => self.findIndex(q => q.tags === query.tags) === index);
    }

    selectNextBestPost(postPool) {
        if (!postPool || postPool.length === 0) return { nextPost: null, remainingPosts: [] };
        const scoredPosts = postPool.map(post => ({ post, score: this.scorePost(post) }));
        scoredPosts.sort((a, b) => b.score - a.score);
        const [best, ...rest] = scoredPosts;
        return { nextPost: best.post, remainingPosts: rest.map(item => item.post) };
    }

    // Method to manage exhausted strategies mapping
    updateExhausted(tag) {
        this.exhaustedStrategies.add(tag);
    }
}

const core = new RecommendationWorkerCore();

// Handle incoming messages
self.onmessage = async (e) => {
    const { id, type, payload } = e.data;

    try {
        let result;
        switch (type) {
            case 'initialize':
                await core.initialize();
                result = true;
                break;
            case 'resetExploreSession':
                core.resetExploreSession();
                result = true;
                break;
            case 'updateUserProfile':
                await core.updateUserProfile();
                result = true;
                break;
            case 'resetRecommendations':
                await core.resetRecommendations();
                result = true;
                break;
            case 'trackInteraction':
                await core.trackInteraction(payload.postId, payload.interactionType, payload.value, payload.postData, payload.updateImmediately);
                result = true;
                break;
            case 'scorePost':
                result = core.scorePost(payload);
                break;
            case 'scorePosts':
                result = core.scorePosts(payload);
                break;
            case 'getPostScoreDetails':
                result = core.getPostScoreDetails(payload);
                break;
            case 'rankPosts':
                result = core.rankPosts(payload);
                break;
            case 'summarizeTagScores':
                result = core.summarizeTagScores(payload);
                break;
            case 'getRecommendedTags':
                result = core.getRecommendedTags(payload);
                break;
            case 'getRecommendedRatings':
                result = core.getRecommendedRatings();
                break;
            case 'buildRecommendedQueryParams':
                result = core.buildRecommendedQueryParams(payload.includeUserTags, payload.exploreMode);
                break;
            case 'getQueryableTags':
                result = core.getQueryableTags();
                break;
            case 'getQueryableTagsWithScores':
                result = core.getQueryableTagsWithScores();
                break;
            case 'generateMultiStrategyQueries':
                result = core.generateMultiStrategyQueries(payload.selectedRatings, payload.whitelist);
                break;
            case 'selectNextBestPost':
                result = core.selectNextBestPost(payload);
                break;
            case 'updateExhausted':
                core.updateExhausted(payload);
                result = true;
                break;
            case 'getExhaustedStrategies':
                result = Array.from(core.exhaustedStrategies);
                break;
            default:
                throw new Error(`Unknown message type: ${type}`);
        }

        self.postMessage({ id, type: 'success', result });
    } catch (error) {
        console.error(`[RecommendationWorker] Error processing ${type}:`, error);
        self.postMessage({ id, type: 'error', error: error.message || String(error) });
    }
};
