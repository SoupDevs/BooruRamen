<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <div v-if="entries.length" :data-plugin-slot="name">
    <PluginBoundary v-for="entry in entries" :key="entry.key" :entry="entry">
      <component :is="entry.component" v-bind="slotProps" />
    </PluginBoundary>
  </div>
</template>

<script>
import { uiState } from '../../plugins/ui.js';
import PluginBoundary from './PluginBoundary.vue';

/**
 * Where plugins can draw: renders every plugin component registered for
 * this slot, passing slotProps on. Classes go on the wrapper. Renders nothing when there are
 * none, so placing a slot costs nothing.
 */
export default {
  name: 'PluginSlot',
  components: { PluginBoundary },
  props: {
    name: { type: String, required: true },
    /** Passed to every plugin component in the slot. */
    slotProps: { type: Object, default: () => ({}) },
  },
  computed: {
    entries() {
      return (uiState.slots[this.name] || []).filter(entry => !entry.failed);
    },
  },
};
</script>
