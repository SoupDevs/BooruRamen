/**
 * signals.js
 * The one definition of what each interaction says about the user's taste.
 *
 * Two scales are derived from it:
 *  - engagementLabel: [0, 1] target for the ML scorer and the strategy bandit
 *    (0 = rejected, ~0.3 = neutral glance, 1 = strongest endorsement).
 *  - interactionSignal: signed weight added to the profile and session tag
 *    affinities (negative for skips and dislikes).
 *
 * timeSpent is normalised before it gets here: the worker turns raw dwell
 * into metadata.engagement using the clip length (videos) or the user's own
 * dwell distribution (images), see dwellEngagement.
 */

export const SKIP_LABEL = 0.1;
export const SKIP_THRESHOLD_MS = 2000;

// Toggles: value 0 is an undo event and carries no preference.
export const TOGGLE_TYPES = ['like', 'favorite', 'dislike'];

// Implicit actions. Each is logged once per post per session with value 1.
const ACTION_LABELS = {
  like: 0.8,
  favorite: 1.0,
  dislike: 0.0,
  view: 0.3,
  download: 0.95,
  share: 0.9,
  deepDive: 0.95,
  revisit: 0.8,
  tagTap: 0.85,
  details: 0.65,
  comments: 0.65,
  unmute: 0.6,
  report: 0.0,
};

const ACTION_SIGNALS = {
  like: 1,
  favorite: 2,
  dislike: -1,
  view: 0.05,
  download: 1.5,
  share: 1.5,
  deepDive: 1.5,
  revisit: 0.8,
  tagTap: 1,
  details: 0.4,
  comments: 0.4,
  unmute: 0.3,
  report: -2,
};

// Gradient importance for the ML scorer. Explicit and deliberate actions are
// rare but carry far more signal than ambient watch time.
export const SAMPLE_WEIGHTS = {
  favorite: 3.0,
  like: 2.5,
  dislike: 3.0,
  view: 1.0,
  timeSpent: 1.0,
  timeSpentSkip: 1.5,
  download: 3.0,
  share: 3.0,
  deepDive: 3.0,
  revisit: 2.0,
  tagTap: 2.0,
  details: 1.5,
  comments: 1.5,
  unmute: 1.2,
  report: 3.0,
};

export const IMPLICIT_ACTIONS = Object.keys(ACTION_LABELS).filter(type => !TOGGLE_TYPES.includes(type) && type !== 'view');

export const isVideoPost = post => ['mp4', 'webm'].includes(post?.file_ext);

/** Legacy dwell mapping: < 2s is a skip, 2s..30s ramps 0.3 -> 0.9. */
export function rawDwellLabel(ms) {
  if (ms < SKIP_THRESHOLD_MS) return SKIP_LABEL;
  return Math.min(0.9, 0.3 + ((ms / 1000 - 2) / 28) * 0.6);
}

/**
 * Running log-normal estimate of how long this user looks at images.
 * Fast scrollers and slow lingerers get the same label for the same relative
 * interest instead of one absolute 30-second scale.
 */
export class DwellBaseline {
  constructor(data = null) {
    this.n = data?.n || 0;
    this.mean = data?.mean ?? Math.log(4000);
    this.variance = data?.variance ?? 1;
  }
  static RATE = 0.05;
  static MIN_SAMPLES = 20;
  get ready() { return this.n >= DwellBaseline.MIN_SAMPLES; }
  observe(ms) {
    if (!(ms > 0)) return;
    const x = Math.log(ms);
    // Plain averages while warming up, then an exponential window so the
    // baseline follows the user's current pace.
    const rate = Math.max(DwellBaseline.RATE, 1 / (this.n + 1));
    const delta = x - this.mean;
    this.mean += rate * delta;
    this.variance = (1 - rate) * (this.variance + rate * delta * delta);
    this.n++;
  }
  zScore(ms) {
    return (Math.log(Math.max(1, ms)) - this.mean) / Math.sqrt(Math.max(0.05, this.variance));
  }
  toSnapshot() { return { n: this.n, mean: this.mean, variance: this.variance }; }
}

/**
 * Dwell -> engagement label in [0, 1].
 * Videos: how much of the clip was watched (loops count as more than one),
 * with long absolute watch time also counting for long videos.
 * Images: where the dwell sits in the user's own distribution.
 */
export function dwellEngagement(ms, { video = false, durationSec = null, baseline = null } = {}) {
  if (video && durationSec > 0) {
    const completion = ms / 1000 / durationSec;
    if (completion >= 1) return Math.min(0.95, 0.75 + 0.2 * Math.min(1, completion - 1));
    if (ms < SKIP_THRESHOLD_MS) return SKIP_LABEL;
    return 0.3 + 0.45 * Math.max(completion, Math.min(1, ms / 60000));
  }
  if (!video && baseline?.ready) {
    if (ms < 1000) return SKIP_LABEL;
    const z = baseline.zScore(ms);
    if (z < -1 && ms < SKIP_THRESHOLD_MS) return SKIP_LABEL;
    return Math.max(0.15, Math.min(0.9, 0.3 + 0.6 / (1 + Math.exp(-1.7 * (z - 0.5)))));
  }
  return rawDwellLabel(ms);
}

/** [0, 1] engagement label, or undefined when the event carries no signal. */
export function engagementLabel(type, value, engagement = null) {
  if (TOGGLE_TYPES.includes(type) && !value) return undefined;
  if (type === 'timeSpent') return Number.isFinite(engagement) ? engagement : rawDwellLabel(value);
  return ACTION_LABELS[type];
}

/** Signed profile weight. */
export function interactionSignal(type, value, engagement = null) {
  if (TOGGLE_TYPES.includes(type) && !value) return 0;
  if (type === 'timeSpent') {
    const label = engagementLabel(type, value, engagement);
    if (label <= SKIP_LABEL + 1e-9) return -0.2;
    return Math.max(-0.2, Math.min(1, (label - 0.3) / 0.6));
  }
  return ACTION_SIGNALS[type] || 0;
}

/** Positive enough to teach tag co-occurrence. */
export function isPositiveEngagement(type, value, engagement = null) {
  if (type === 'timeSpent' && !Number.isFinite(engagement)) return value > 5000;
  const label = engagementLabel(type, value, engagement);
  return label !== undefined && label >= 0.6;
}

// Deliberate actions earn a larger share of lasting profile weight than
// ambient watch time (see SessionInterest.record).
export const DELIBERATE_TYPES = ['like', 'favorite', 'dislike', 'download', 'share', 'deepDive', 'tagTap', 'report'];

/** A copy of the post that only carries one tag (for tag taps). */
export function focusPostOnTag(post, tag) {
  const focused = { ...post, tag_string: tag };
  for (const category of ['artist', 'copyright', 'character', 'general', 'meta']) {
    const tags = (post[`tag_string_${category}`] || '').split(/\s+/);
    focused[`tag_string_${category}`] = tags.includes(tag) ? tag : '';
  }
  return focused;
}
