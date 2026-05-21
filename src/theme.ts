/**
 * Theme palette definitions for day/night modes.
 *
 * Centralizes all deck.gl color values (base map fills, data bar colors,
 * heatmap ranges, material settings, and post-processing tuning) so that
 * switching themes only requires swapping one palette object.
 */

// --- Types ---

export type ThemeName = "night" | "day";

export interface ThemePalette {
  // Base map
  baseFill: [number, number, number, number];
  baseLine_cd: [number, number, number, number];
  baseLine_zip: [number, number, number, number];
  baseDimmed: [number, number, number, number]; // diary mode dimmed fill
  baseDimmedLine: [number, number, number, number]; // diary mode dimmed stroke

  // Data bars
  colorStops: [number, [number, number, number]][];
  zeroCount: [number, number, number, number];
  barLineColor: [number, number, number, number];
  highlightColor: [number, number, number, number];

  // Circles
  circleLineColor: [number, number, number, number];

  // Heatmap
  heatmapColorRange: [number, number, number][];

  // Material (3D bar shading)
  material: { ambient: number; diffuse: number; shininess: number };

  // Effects tuning
  bloom: { threshold: number; intensity: number; radius: number };
  vignette: { radius: number; amount: number };
  chromaticAberration: number;
  lighting: {
    ambientIntensity: number;
    primaryIntensity: number;
    fillIntensity: number;
  };
}

// --- Night palette (current dark theme — values extracted as-is) ---

const NIGHT: ThemePalette = {
  baseFill: [12, 12, 28, 180],
  baseLine_cd: [255, 255, 255, 38],
  baseLine_zip: [255, 255, 255, 25],
  baseDimmed: [8, 8, 16, 160],
  baseDimmedLine: [255, 255, 255, 15],

  colorStops: [
    [0.0, [80, 50, 110]],
    [0.25, [130, 50, 120]],
    [0.5, [190, 80, 60]],
    [0.75, [240, 150, 40]],
    [1.0, [255, 215, 70]],
  ],
  zeroCount: [30, 30, 70, 255],
  barLineColor: [80, 80, 100, 200],
  highlightColor: [255, 255, 255, 40],

  circleLineColor: [255, 255, 255, 80],

  heatmapColorRange: [
    [80, 50, 110],
    [130, 50, 120],
    [190, 80, 60],
    [240, 150, 40],
    [255, 215, 70],
    [255, 240, 140],
  ],

  material: { ambient: 0.35, diffuse: 0.8, shininess: 12 },

  bloom: { threshold: 0.5, intensity: 0.1, radius: 3.0 },
  vignette: { radius: 0.7, amount: 0.2 },
  chromaticAberration: 1.0,
  lighting: {
    ambientIntensity: 0.4,
    primaryIntensity: 1.0,
    fillIntensity: 0.4,
  },
};

// --- Day palette (warm parchment, deeper colors for light background) ---

const DAY: ThemePalette = {
  // Noticeably darker than the #f5f3ee background so NYC reads as a distinct shape
  baseFill: [212, 208, 198, 255],
  baseLine_cd: [140, 130, 115, 140],
  baseLine_zip: [160, 152, 138, 80],
  baseDimmed: [200, 196, 188, 210],
  baseDimmedLine: [140, 130, 115, 40],

  colorStops: [
    [0.0, [20, 70, 120]],     // rich blue
    [0.25, [0, 140, 130]],    // vivid teal
    [0.5, [220, 120, 20]],    // bright orange
    [0.75, [210, 60, 30]],    // vermilion
    [1.0, [170, 30, 20]],     // deep crimson
  ],
  zeroCount: [195, 192, 185, 255],
  barLineColor: [60, 55, 45, 180],
  highlightColor: [0, 0, 0, 30],

  circleLineColor: [60, 55, 45, 140],

  heatmapColorRange: [
    [20, 70, 120],
    [0, 140, 130],
    [220, 120, 20],
    [210, 60, 30],
    [170, 30, 20],
    [230, 80, 40],
  ],

  material: { ambient: 0.5, diffuse: 0.75, shininess: 10 },

  bloom: { threshold: 0.7, intensity: 0.05, radius: 2.0 },
  vignette: { radius: 0.8, amount: 0.1 },
  chromaticAberration: 0.5,
  lighting: {
    ambientIntensity: 0.6,
    primaryIntensity: 0.8,
    fillIntensity: 0.5,
  },
};

// --- Exports ---

export const THEMES: Record<ThemeName, ThemePalette> = {
  night: NIGHT,
  day: DAY,
};

export function getTheme(name: ThemeName): ThemePalette {
  return THEMES[name];
}
