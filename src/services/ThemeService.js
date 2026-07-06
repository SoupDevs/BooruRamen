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
 * ThemeService
 *
 * Themes are expressed as CSS variables holding "R G B" channel triples
 * (e.g. --c-accent-600: "219 39 119"). tailwind.config.js remaps the
 * gray/pink/black/white palettes onto these variables, so every existing
 * utility class (bg-gray-800, text-pink-400, bg-black, ...) retails
 * opacity-modifier support while becoming themeable.
 *
 * A theme provides:
 *  - black:    the app background color (bg-black)
 *  - white:    the primary text color (text-white)
 *  - onAccent: text color placed on filled accent elements
 *  - gray:     full gray scale (50-900, plus 750 used for hover states)
 *  - accent:   full accent scale (replaces pink 50-900)
 *  - font:     a font id from FONT_STACKS, or a raw font-family string
 */

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
    const to = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
}

/** "R G B" channel triple used by the CSS variables */
function toTriple(hex) {
    return hexToRgb(hex).join(' ');
}

/** Mix two hex colors; t = 0 returns a, t = 1 returns b */
function mix(a, b, t) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    return rgbToHex(ca.map((v, i) => v + (cb[i] - v) * t));
}

function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return [h, s, l];
}

function hslToRgb([h, s, l]) {
    if (s === 0) {
        const v = l * 255;
        return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        hue2rgb(p, q, h + 1 / 3) * 255,
        hue2rgb(p, q, h) * 255,
        hue2rgb(p, q, h - 1 / 3) * 255
    ];
}

/** Shift lightness by delta (percentage points, -100..100) */
function shiftLightness(hex, delta) {
    const hsl = rgbToHsl(hexToRgb(hex));
    hsl[2] = Math.max(0, Math.min(1, hsl[2] + delta / 100));
    return rgbToHex(hslToRgb(hsl));
}

/** WCAG relative luminance, 0 (black) .. 1 (white) */
function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

export const FONT_STACKS = {
    sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    serif: "'Tiempos Text', ui-serif, Georgia, Cambria, 'Times New Roman', serif",
    mono: "ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace"
};

export const FONT_OPTIONS = [
    { id: 'sans', label: 'Sans-serif (Default)' },
    { id: 'serif', label: 'Serif' },
    { id: 'mono', label: 'Monospace' }
];

function resolveFontStack(font) {
    return FONT_STACKS[font] || font || FONT_STACKS.sans;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const THEME_PRESETS = {
    default: {
        label: 'Default',
        description: 'The classic BooruRamen look',
        font: 'sans',
        colors: {
            black: '#000000',
            white: '#ffffff',
            onAccent: '#ffffff',
            gray: {
                50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db',
                400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151',
                750: '#2b3544', 800: '#1f2937', 900: '#111827'
            },
            accent: {
                50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4',
                400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d',
                800: '#9d174d', 900: '#831843'
            }
        }
    },

    blackwhite: {
        label: 'Black & White',
        description: 'High-contrast monochrome',
        font: 'sans',
        colors: {
            black: '#000000',
            white: '#ffffff',
            onAccent: '#000000',
            gray: {
                50: '#fafafa', 100: '#f0f0f0', 200: '#e0e0e0', 300: '#c7c7c7',
                400: '#9e9e9e', 500: '#6e6e6e', 600: '#3a3a3a', 700: '#242424',
                750: '#1d1d1d', 800: '#161616', 900: '#0d0d0d'
            },
            accent: {
                50: '#ffffff', 100: '#fcfcfc', 200: '#f5f5f5', 300: '#ededed',
                400: '#e3e3e3', 500: '#d9d9d9', 600: '#cfcfcf', 700: '#b3b3b3',
                800: '#8f8f8f', 900: '#6b6b6b'
            }
        }
    },

    terminal: {
        label: 'Terminal',
        description: 'Green phosphor on black',
        font: 'mono',
        colors: {
            black: '#050505',
            white: '#d7e0d7',
            onAccent: '#04110a',
            gray: {
                50: '#e8f0e8', 100: '#d2dcd2', 200: '#b6c2b6', 300: '#93a093',
                400: '#6f7a6f', 500: '#4f584f', 600: '#2c332c', 700: '#1f241f',
                750: '#181c18', 800: '#131613', 900: '#0c0f0c'
            },
            accent: {
                50: '#eaffea', 100: '#d3ffd8', 200: '#a8ffb4', 300: '#7dff92',
                400: '#4fff70', 500: '#2bf55a', 600: '#00e64d', 700: '#00bf3f',
                800: '#009934', 900: '#00702a'
            }
        }
    },

    claude: {
        label: 'Claude',
        description: 'Warm ivory and terracotta',
        font: 'serif',
        colors: {
            black: '#faf9f5',
            white: '#141413',
            onAccent: '#ffffff',
            gray: {
                50: '#21201c', 100: '#2b2a25', 200: '#3e3d36', 300: '#55544b',
                400: '#6f6e63', 500: '#87867c', 600: '#cbc6b5', 700: '#e0dcce',
                750: '#eae7dc', 800: '#f0eee6', 900: '#f5f4ed'
            },
            accent: {
                50: '#fbf0ea', 100: '#f7e2d5', 200: '#f0c6ab', 300: '#e7a487',
                400: '#e08b6d', 500: '#d97757', 600: '#c96442', 700: '#b04f30',
                800: '#8f3f26', 900: '#6d2f1d'
            }
        }
    }
};

export const DEFAULT_CUSTOM_THEME = {
    background: '#0b0b10',
    surface: '#17171f',
    text: '#f2f2f7',
    accent: '#8b5cf6',
    font: 'sans'
};

// ---------------------------------------------------------------------------
// Custom theme builder
// ---------------------------------------------------------------------------

/**
 * Expand four user-chosen colors into a full theme.
 * The gray scale ramps from the background/surface toward the text color,
 * and the accent scale is derived by shifting the accent's lightness.
 */
export function buildCustomTheme(config) {
    const c = { ...DEFAULT_CUSTOM_THEME, ...(config || {}) };
    const { background, surface, text, accent } = c;
    return {
        label: 'Custom',
        description: 'Your own colors and font',
        font: c.font,
        colors: {
            black: background,
            white: text,
            onAccent: luminance(accent) > 0.45 ? '#000000' : '#ffffff',
            gray: {
                50: mix(background, text, 0.96),
                100: mix(background, text, 0.92),
                200: mix(background, text, 0.85),
                300: mix(background, text, 0.72),
                400: mix(background, text, 0.6),
                500: mix(background, text, 0.45),
                600: mix(surface, text, 0.3),
                700: mix(surface, text, 0.15),
                750: mix(surface, text, 0.06),
                800: surface,
                900: mix(surface, background, 0.5)
            },
            accent: {
                50: shiftLightness(accent, 42),
                100: shiftLightness(accent, 36),
                200: shiftLightness(accent, 28),
                300: shiftLightness(accent, 20),
                400: shiftLightness(accent, 12),
                500: shiftLightness(accent, 6),
                600: accent,
                700: shiftLightness(accent, -8),
                800: shiftLightness(accent, -16),
                900: shiftLightness(accent, -24)
            }
        }
    };
}

// ---------------------------------------------------------------------------
// Applying themes
// ---------------------------------------------------------------------------

export function resolveTheme(themeId, customConfig) {
    if (themeId === 'custom') return buildCustomTheme(customConfig);
    return THEME_PRESETS[themeId] || THEME_PRESETS.default;
}

/**
 * Apply a theme by id ('default', 'blackwhite', 'terminal', 'claude',
 * 'custom') to the document. For 'custom', customConfig supplies the colors.
 */
export function applyTheme(themeId, customConfig) {
    if (typeof document === 'undefined') return;
    const theme = resolveTheme(themeId, customConfig);
    const root = document.documentElement;
    const set = (name, hex) => root.style.setProperty(name, toTriple(hex));

    set('--c-black', theme.colors.black);
    set('--c-white', theme.colors.white);
    set('--c-on-accent', theme.colors.onAccent);
    for (const [shade, hex] of Object.entries(theme.colors.gray)) {
        set(`--c-gray-${shade}`, hex);
    }
    for (const [shade, hex] of Object.entries(theme.colors.accent)) {
        set(`--c-accent-${shade}`, hex);
    }
    root.style.setProperty('--theme-font', resolveFontStack(theme.font));
}

/** Small color summary used to render theme preview cards in settings */
export function getThemePreview(theme) {
    return {
        bg: theme.colors.black,
        surface: theme.colors.gray[800],
        border: theme.colors.gray[700],
        text: theme.colors.white,
        accent: theme.colors.accent[600],
        font: resolveFontStack(theme.font)
    };
}

export default {
    THEME_PRESETS,
    FONT_STACKS,
    FONT_OPTIONS,
    DEFAULT_CUSTOM_THEME,
    buildCustomTheme,
    resolveTheme,
    applyTheme,
    getThemePreview
};
