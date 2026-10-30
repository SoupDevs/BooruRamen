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
 * feedFilters.js
 * What decides which posts may enter the feed besides the search itself
 * (whitelist, blacklist, media type): the user's override rules and the
 * plugins that are on, since a plugin can change what the feed fetches and
 * keeps. When any of it changes, posts queued under the old rules no longer
 * apply and the feed is filled again.
 */

const sorted = list => (Array.isArray(list) ? [...list].map(String).sort() : []);

/**
 * @param {Object} settings - the settings store (or a plain object shaped like it)
 * @param {Object[]} plugins - plugin records ({ id, enabled })
 * @returns {string} equal for equal filters, whatever the order
 */
export function feedFilterSignature(settings = {}, plugins = []) {
  return JSON.stringify({
    alwaysInclude: sorted(settings.tagAlwaysInclude),
    neverInclude: sorted(settings.tagNeverInclude),
    neverIncludeOptions: sorted(settings.overrideNeverInclude),
    plugins: sorted((plugins || []).filter(plugin => plugin && plugin.enabled).map(plugin => plugin.id)),
  });
}
