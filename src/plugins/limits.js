/*
 * BooruRamen - A personalized booru browser
 * Copyright (C) 2025 SoupDevs
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
/**
 * limits.js
 * Bounds on what plugins can do to the feed. Dependency-free so the
 * recommendation worker can import it.
 */

/** Most strategy queries the feed will send per batch after plugins. */
export const MAX_PLUGIN_QUERIES = 12;
/** Ranking multipliers from plugins are clamped to [0, MAX_SCORE_WEIGHT]. */
export const MAX_SCORE_WEIGHT = 4;
