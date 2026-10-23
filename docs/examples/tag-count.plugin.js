/*
 * Tag Count: an example of a plugin installed from a file.
 *
 * Install it from Profile -> Plugins -> Install a plugin -> Choose file.
 * An installed plugin is one file with a single `export default` and no
 * imports: `definePlugin` is already in scope, and Vue comes from api.vue.
 */
export default definePlugin({
  id: 'tag-count',
  name: 'Tag Count',
  version: '1.0.0',
  author: 'SoupDevs',
  description: 'Hides posts with too few tags and adds a button showing how many tags a post has.',
  settings: [
    { key: 'minTags', type: 'number', label: 'Fewest tags', description: 'Posts with fewer tags are skipped (0 keeps all)', default: 0, min: 0, max: 100, step: 1 },
  ],

  setup(api) {
    const { h } = api.vue;
    const countTags = post => String(post.tag_string || '').split(/\s+/).filter(Boolean).length;

    // Drop sparsely tagged posts from each request's results.
    api.on('feed:posts', posts => {
      const min = api.settings.get('minTags');
      if (!min) return; // unchanged
      return posts.filter(post => countTags(post) >= min);
    });

    // A button in the feed's action column.
    api.ui.addToSlot('feed.actions', {
      props: ['post'],
      setup(props) {
        return () => h('button', {
          class: 'w-12 h-12 rounded-full bg-black bg-opacity-70 hover:bg-pink-600 transition-colors backdrop-blur-sm text-xs font-semibold',
          title: 'Tag count',
          onClick: () => api.ui.notify(`${countTags(props.post)} tags`),
        }, String(countTags(props.post)));
      },
    });

    api.settings.onChange(() => api.feed.invalidate());
    api.log.info('ready');
  },
});
