/**
 * TasteNarrative.js
 * Writes the taste analysis up as plain sentences, with rules and templates
 * (no language model). Every sentence is backed by a number from
 * TasteAnalysis, and a sentence is only written when its evidence is strong
 * enough to be worth saying.
 */

export const MIN_IMPRESSIONS_FOR_STORY = 15;

const pct = value => `${Math.round(value * 100)}%`;

/** "zenless_zone_zero" -> "Zenless Zone Zero"; artists keep their handle. */
export function tagLabel(entry) {
  const tag = typeof entry === 'string' ? entry : entry.tag;
  const category = typeof entry === 'string' ? 'general' : entry.category;
  const spaced = tag.replace(/_/g, ' ').trim();
  if (category === 'copyright' || category === 'character') {
    return spaced.replace(/(^|[\s(])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
  }
  return spaced;
}

export function joinList(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// Tag names inside sentences are wrapped in invisible markers carrying their
// category, so the page can colour them; splitSegments() takes them apart and
// plainText() drops them.
const OPEN = '\u0001', SEP = '\u0002', CLOSE = '\u0003';
// eslint-disable-next-line no-control-regex -- the markers are control characters on purpose
const MARKED = /\u0001([a-z]+)\u0002([^\u0003]*)\u0003/g;
export const markTag = entry => `${OPEN}${entry.category || 'general'}${SEP}${tagLabel(entry)}${CLOSE}`;

/** "You like ⟨Elden Ring⟩." -> [{ text: 'You like ' }, { text: 'Elden Ring', category: 'copyright' }, { text: '.' }] */
export function splitSegments(sentence) {
  const segments = [];
  let last = 0;
  for (const match of sentence.matchAll(MARKED)) {
    if (match.index > last) segments.push({ text: sentence.slice(last, match.index) });
    segments.push({ text: match[2], category: match[1] });
    last = match.index + match[0].length;
  }
  if (last < sentence.length) segments.push({ text: sentence.slice(last) });
  return segments;
}

export const plainText = sentence => sentence.replace(MARKED, '$2');

const names = entries => joinList(entries.map(markTag));
const plural = (entries, one, many) => (entries.length === 1 ? one : many);

function partOfDay(hour) {
  if (hour < 5) return 'late at night';
  if (hour < 12) return 'in the morning';
  if (hour < 17) return 'in the afternoon';
  if (hour < 21) return 'in the evening';
  return 'at night';
}

function clock(hour) {
  const suffix = hour < 12 ? 'am' : 'pm';
  return `${hour % 12 || 12}${suffix}`;
}

/**
 * @param {ReturnType<import('./TasteAnalysis.js').analyzeTaste>} analysis
 * @returns {{ ready: boolean, sections: Array<{ title: string, sentences: string[] }> }}
 */
export function describeTaste(analysis) {
  const { topByCategory, engagement, rising, fading, newInterests, avoidedTags, baseRate, deepDives } = analysis;
  if (engagement.impressions < MIN_IMPRESSIONS_FOR_STORY) {
    return {
      ready: false,
      sections: [{ title: 'Still getting to know you', sentences: [
        `So far you've looked at ${engagement.impressions} ${engagement.impressions === 1 ? 'post' : 'posts'}. After about ${MIN_IMPRESSIONS_FOR_STORY}, this page starts describing what you like and why.`,
      ] }],
    };
  }

  const sections = [];

  // What you like
  const like = [];
  const series = topByCategory.copyright.slice(0, 3);
  const characters = topByCategory.character.slice(0, 2);
  const artists = topByCategory.artist.slice(0, 3);
  const themes = topByCategory.general.slice(0, 3);
  if (series.length && characters.length) like.push(`You mostly come here for ${names(series)}, and especially ${names(characters)}.`);
  else if (series.length) like.push(`You mostly come here for ${names(series)}.`);
  else if (characters.length) like.push(`The characters you keep coming back to are ${names(characters)}.`);
  if (artists.length) {
    const lead = artists[0];
    like.push(`Among artists, ${names(artists)} land most reliably: you engage with ${pct(lead.rate)} of ${markTag(lead)}'s posts, against ${pct(baseRate)} of posts overall.`);
  }
  if (themes.length) like.push(`${series.length || characters.length ? 'Beyond specific series, you' : 'You'} gravitate toward ${names(themes)}.`);
  if (avoidedTags.length) {
    const worst = avoidedTags[0];
    like.push(`You reliably pass on ${names(avoidedTags.slice(0, 3))}; you skipped ${pct(worst.skips / worst.impressions)} of the ${markTag(worst)} posts you were shown.`);
  }
  if (like.length) sections.push({ title: 'What you like', sentences: like });

  // How you engage
  const style = [];
  if (engagement.skipRate !== null) {
    if (engagement.skipRate >= 0.6) style.push(`You scroll fast and decide quickly: ${pct(engagement.skipRate)} of posts get less than a couple of seconds.`);
    else if (engagement.skipRate <= 0.3) style.push(`You take your time: only ${pct(engagement.skipRate)} of posts get skipped within a couple of seconds.`);
    else style.push(`You give most posts a fair look, skipping about ${pct(engagement.skipRate)} of them within a couple of seconds.`);
  }
  if (engagement.silentShare !== null && engagement.positiveRate) {
    if (engagement.silentShare >= 0.5) style.push(`Most of what you enjoy, you never like: ${pct(engagement.silentShare)} of the posts that held your attention got no like or favourite, so the feed learns mostly from how long you stay.`);
    else style.push(`You're generous with likes: ${pct(1 - engagement.silentShare)} of the posts that held your attention also got a like or favourite.`);
  }
  const { images, videos } = engagement;
  if (images.count >= 10 && videos.count >= 10) {
    const finish = videos.completionRate !== null ? `, and you watch ${pct(videos.completionRate)} of clips to the end${videos.rewatchRate >= 0.1 ? `, rewatching ${pct(videos.rewatchRate)}` : ''}` : '';
    if (videos.positiveRate > images.positiveRate * 1.2) style.push(`Videos hold you better than images (${pct(videos.positiveRate)} engaged versus ${pct(images.positiveRate)})${finish}.`);
    else if (images.positiveRate > videos.positiveRate * 1.2) style.push(`Images hold you better than videos (${pct(images.positiveRate)} engaged versus ${pct(videos.positiveRate)})${finish}.`);
    else style.push(`Images and videos hold you about equally well${finish}.`);
  } else if (videos.count >= 10 && videos.completionRate !== null) {
    style.push(`You watch ${pct(videos.completionRate)} of clips to the end.`);
  }
  const { actions } = engagement;
  const deeds = [
    actions.download && `saved ${actions.download} ${actions.download === 1 ? 'post' : 'posts'}`,
    actions.share && `shared ${actions.share}`,
    actions.revisit && `scrolled back for a second look ${actions.revisit} ${actions.revisit === 1 ? 'time' : 'times'}`,
  ].filter(Boolean);
  if (deeds.length) style.push(`You've ${joinList(deeds)}. The feed treats ${deeds.length === 1 ? 'that' : 'those'} as a stronger signal than a like.`);
  if (style.length) sections.push({ title: 'How you engage', sentences: style });

  // What's changing
  const change = [];
  if (newInterests.length) change.push(`New this week: ${names(newInterests)}.`);
  if (rising.length) change.push(`Lately you've been warming up to ${names(rising.slice(0, 3))}.`);
  if (fading.length) change.push(`${names(fading.slice(0, 3))} ${plural(fading.slice(0, 3), 'has', 'have')} gone quiet compared with last month; the feed will still bring ${plural(fading.slice(0, 3), 'it', 'them')} back now and then.`);
  if (deepDives.length) {
    const last = deepDives[deepDives.length - 1].post;
    const category = ['character', 'copyright', 'artist'].find(name => (last[`tag_string_${name}`] || '').trim());
    const anchor = category && last[`tag_string_${category}`].split(/\s+/).filter(Boolean)[0];
    change.push(`You've taken ${deepDives.length} Deep ${deepDives.length === 1 ? 'Dive' : 'Dives'}${anchor ? `, most recently around ${markTag({ tag: anchor, category })}` : ''}. Dives stay mostly separate from your feed.`);
  }
  if (change.length) sections.push({ title: "What's changing", sentences: change });

  // When you browse
  const rhythm = [];
  const total = engagement.hours.reduce((sum, count) => sum + count, 0);
  if (total >= 20) {
    let bestStart = 0, best = -1;
    for (let start = 0; start < 24; start++) {
      const windowCount = [0, 1, 2].reduce((sum, offset) => sum + engagement.hours[(start + offset) % 24], 0);
      if (windowCount > best) { best = windowCount; bestStart = start; }
    }
    const peak = (bestStart + 1) % 24;
    const posts = Math.round(engagement.sessions.medianPosts || 0);
    const sessionPart = posts > 1 ? `, usually looking through about ${posts} posts at a time` : '';
    rhythm.push(`You browse most ${partOfDay(peak)}, around ${clock(peak)}${sessionPart}.`);
  }
  if (engagement.daysActive) {
    const minutes = Math.max(1, Math.round(engagement.activeMinutes));
    rhythm.push(`All told, you've spent about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} actually looking at posts, across ${engagement.daysActive} ${engagement.daysActive === 1 ? 'day' : 'days'}.`);
  }
  if (rhythm.length) sections.push({ title: 'When you browse', sentences: rhythm });

  // A sentence can open with a lower-case tag ("tree and outdoors have...").
  const capitalise = sentence => (sentence.startsWith(OPEN)
    // eslint-disable-next-line no-control-regex -- see MARKED
    ? sentence.replace(/^(\u0001[a-z]+\u0002)(.)/, (_, head, letter) => head + letter.toUpperCase())
    : sentence.charAt(0).toUpperCase() + sentence.slice(1));
  for (const section of sections) section.sentences = section.sentences.map(capitalise);
  return { ready: true, sections };
}

/** Short evidence line for one tag, e.g. "Liked 4 · watched 9 to the end · skipped 2 of 31". */
export function tagEvidence(entry) {
  const a = entry.actions;
  return [
    a.favorite && `favourited ${a.favorite}`,
    a.like && `liked ${a.like}`,
    a.download && `saved ${a.download}`,
    a.share && `shared ${a.share}`,
    a.revisit && `revisited ${a.revisit}`,
    entry.completions && `watched ${entry.completions} to the end`,
    `engaged with ${entry.positives} of ${entry.impressions}`,
    entry.skips && `skipped ${entry.skips}`,
  ].filter(Boolean).join(' · ').replace(/^./, letter => letter.toUpperCase());
}
