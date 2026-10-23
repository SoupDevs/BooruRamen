<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <slot v-if="!entry.failed" />
</template>

<script>
import { reportComponentError } from '../../plugins/ui.js';

/** Contains a plugin component's errors: it is hidden and charged instead. */
export default {
  name: 'PluginBoundary',
  props: {
    entry: { type: Object, required: true },
  },
  errorCaptured(error) {
    reportComponentError(this.entry, error);
    return false;
  },
};
</script>
