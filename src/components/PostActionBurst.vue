<!--
  BooruRamen - A personalized booru browser
  Copyright (C) 2025 SoupDevs

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->
<template>
  <!--
    Quick feedback for an interaction, played over the media of the post it
    belongs to and fading away on its own. Decorative only: it never takes
    pointer events, so taps keep reaching the media underneath, and it fills
    whatever positioned box it is dropped into.
  -->
  <div class="absolute inset-0 z-20 flex items-center justify-center pointer-events-none" aria-hidden="true">
    <!-- Satellites scatter from the centre; hearts read as "liked" much more
         clearly as a small flock than as one lonely glyph. -->
    <span
      v-for="satellite in satellites"
      :key="satellite.id"
      class="post-burst__satellite text-white"
      :style="satelliteStyle(satellite)"
    >
      <Heart class="w-full h-full" fill="currentColor" />
    </span>

    <component
      :is="icon"
      :size="96"
      fill="currentColor"
      stroke-width="0"
      class="post-burst__icon"
      :class="[iconClass, `post-burst--${type}`]"
    />
  </div>
</template>

<script>
import { Heart, Star, ThumbsDown } from 'lucide-vue-next';

// Radius of the satellite scatter, in CSS pixels.
const SATELLITE_RADIUS = 104;

const ICONS = {
  like: Heart,
  dislike: ThumbsDown,
  favorite: Star
};

const ICON_CLASSES = {
  like: 'text-white',
  dislike: 'text-white',
  favorite: 'text-yellow-400'
};

export default {
  name: 'PostActionBurst',
  components: { Heart },
  props: {
    // like | dislike | favorite
    type: {
      type: String,
      required: true
    }
  },
  computed: {
    icon() {
      return ICONS[this.type] || Heart;
    },
    iconClass() {
      return ICON_CLASSES[this.type] || ICON_CLASSES.like;
    },
    satellites() {
      if (this.type !== 'like') return [];
      return Array.from({ length: 6 }, (unused, index) => {
        const angle = (Math.PI * 2 * index) / 6 + Math.PI / 6;
        return {
          id: index,
          dx: Math.round(Math.cos(angle) * SATELLITE_RADIUS),
          dy: Math.round(Math.sin(angle) * SATELLITE_RADIUS),
          size: index % 2 === 0 ? 22 : 16,
          delay: (index % 3) * 0.04
        };
      });
    }
  },
  methods: {
    satelliteStyle(satellite) {
      return {
        width: `${satellite.size}px`,
        height: `${satellite.size}px`,
        animationDelay: `${satellite.delay}s`,
        '--burst-dx': `${satellite.dx}px`,
        '--burst-dy': `${satellite.dy}px`
      };
    }
  }
};
</script>

<style scoped>
.post-burst__icon {
  animation: post-burst-pop 850ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
  filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.55));
}

/* Dislike borrows the same pop but sags a little on the way out. */
.post-burst__icon.post-burst--dislike {
  animation-name: post-burst-pop-sag;
}

/* Favorite spins as it lands. */
.post-burst__icon.post-burst--favorite {
  animation-name: post-burst-pop-spin;
}

.post-burst__satellite {
  position: absolute;
  top: 50%;
  left: 50%;
  margin: -8px 0 0 -8px;
  animation: post-burst-scatter 850ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5));
}

@keyframes post-burst-pop {
  0% {
    transform: scale(0.3);
    opacity: 0;
  }
  20% {
    transform: scale(1.25);
    opacity: 1;
  }
  40% {
    transform: scale(0.94);
  }
  60% {
    transform: scale(1.04);
  }
  75% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(1.12);
    opacity: 0;
  }
}

@keyframes post-burst-pop-sag {
  0% {
    transform: scale(0.3) rotate(6deg);
    opacity: 0;
  }
  20% {
    transform: scale(1.2) rotate(-8deg);
    opacity: 1;
  }
  45% {
    transform: scale(0.96) rotate(-4deg);
  }
  75% {
    transform: scale(1) rotate(-4deg);
    opacity: 1;
  }
  100% {
    transform: translateY(18px) scale(0.9) rotate(-4deg);
    opacity: 0;
  }
}

@keyframes post-burst-pop-spin {
  0% {
    transform: scale(0.3) rotate(-60deg);
    opacity: 0;
  }
  25% {
    transform: scale(1.2) rotate(0deg);
    opacity: 1;
  }
  45% {
    transform: scale(0.95) rotate(10deg);
  }
  75% {
    transform: scale(1) rotate(6deg);
    opacity: 1;
  }
  100% {
    transform: scale(1.1) rotate(6deg);
    opacity: 0;
  }
}

@keyframes post-burst-scatter {
  0% {
    transform: translate(0, 0) scale(0.2);
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  60% {
    transform: translate(calc(var(--burst-dx) * 0.6), calc(var(--burst-dy) * 0.6)) scale(1);
    opacity: 1;
  }
  100% {
    transform: translate(var(--burst-dx), var(--burst-dy)) scale(0.9);
    opacity: 0;
  }
}
</style>