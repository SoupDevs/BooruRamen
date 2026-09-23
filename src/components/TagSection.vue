<template>
  <div v-if="tags.length > 0">
    <h3 class="text-sm font-medium text-gray-400">{{ title }}</h3>
    <div class="flex flex-wrap gap-1 mt-1">
      <span 
        v-for="tag in visibleTags" 
        :key="tag"
        class="px-2 py-0.5 rounded text-xs cursor-pointer hover:opacity-80 transition-opacity"
        :class="colorClass"
        :data-tag="tag"
        :title="`Add '${tag}' to whitelist`"
        @click="$emit('tag-click', tag, $event)"
      >
        {{ tag }}
      </span>
      <button 
        v-if="tags.length > limit && !expanded" 
        @click="expanded = true"
        class="px-2 py-0.5 rounded text-xs bg-gray-600 hover:bg-gray-500 transition-colors"
      >
        +{{ tags.length - limit }} more
      </button>
      <button 
        v-if="expanded" 
        @click="expanded = false"
        class="px-2 py-0.5 rounded text-xs bg-gray-600 hover:bg-gray-500 transition-colors"
      >
        Show less
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'TagSection',
  // tag-click fires with the tag name so the host (the Post Details sidebar)
  // can send it straight to the whitelist.
  emits: ['tag-click'],
  props: {
    title: String,
    tagString: String,
    colorClass: String,
    limit: {
      type: Number,
      default: 30
    }
  },
  data() {
    return {
      expanded: false
    }
  },
  computed: {
    tags() {
      if (!this.tagString) return [];
      // To deduplicate properly we must convert to a Set to remove any duplicate overlapping tags
      return [...new Set(this.tagString.split(' ').filter(t => t.trim().length > 0))];
    },
    visibleTags() {
      if (this.expanded) return this.tags;
      return this.tags.slice(0, this.limit);
    }
  },
  watch: {
    tagString() {
      // Collapse when post changes
      this.expanded = false;
    }
  }
}
</script>
