/**
 * Standard booru tag-type colours (Danbooru's dark-theme palette), shared by
 * every place that colour-codes tags by category.
 */
export const TAG_COLORS = {
  artist: '#ff8a8b',
  copyright: '#c797ff',
  character: '#35c64a',
  general: '#009be6',
  meta: '#ead084',
};

export const tagColor = category => TAG_COLORS[category] || TAG_COLORS.general;
