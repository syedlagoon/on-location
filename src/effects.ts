/**
 * Post-processing pipeline — cinematic film-print aesthetics.
 *
 * Base layer (always on): bloom, chromatic aberration, vignette.
 * Decade grading (when a landmark decade is selected): warm/cool color shifts
 * using built-in hueSaturation, sepia, brightnessContrast, and noise.
 *
 * Custom shader modules (bloom, chromatic aberration) use luma.gl's ShaderPass
 * system with `sampler`-type passes for texture re-sampling.
 */

import { PostProcessEffect, LightingEffect, AmbientLight, DirectionalLight } from "@deck.gl/core";
import type { Effect } from "@deck.gl/core";
import {
  vignette,
  noise,
  hueSaturation,
  sepia,
  brightnessContrast,
} from "@luma.gl/effects";

// --- Custom shader modules ---

/**
 * Chromatic aberration — subtle RGB channel offset increasing toward edges,
 * mimicking a real camera lens's inability to focus all wavelengths to the
 * same point. The offset scales radially from center so the effect is
 * strongest at corners (natural lens behavior).
 */
const chromaticAberrationModule = {
  name: "chromaticAberration",
  uniformTypes: { amount: "f32" as const },
  defaultUniforms: { amount: 3.0 },
  passes: [{ sampler: true }],
  fs: `\
layout(std140) uniform chromaticAberrationUniforms {
  float amount;
} chromaticAberration;

vec4 chromaticAberration_sampleColor(sampler2D source, vec2 texSize, vec2 texCoord) {
  vec2 center = vec2(0.5);
  vec2 dir = texCoord - center;
  float dist = length(dir);
  float offset = chromaticAberration.amount * dist / texSize.x;
  vec2 direction = dist > 0.001 ? normalize(dir) : vec2(0.0);

  float r = texture(source, texCoord + direction * offset).r;
  float g = texture(source, texCoord).g;
  float b = texture(source, texCoord - direction * offset).b;
  float a = texture(source, texCoord).a;
  return vec4(r, g, b, a);
}`,
};

/**
 * Simplified bloom — single-pass glow approximation. Samples bright pixels
 * in 3 concentric rings (8 samples each = 24 total) and adds their
 * contribution as a soft halo around bright areas.
 *
 * Not physically accurate (true bloom needs multi-pass Gaussian, coming in
 * luma.gl v10) but visually effective for data-viz where the bright amber
 * bars and green diary pins should glow against the dark map.
 */
const bloomModule = {
  name: "bloom",
  uniformTypes: {
    threshold: "f32" as const,
    intensity: "f32" as const,
    radius: "f32" as const,
  },
  defaultUniforms: { threshold: 0.4, intensity: 0.3, radius: 4.0 },
  passes: [{ sampler: true }],
  fs: `\
layout(std140) uniform bloomUniforms {
  float threshold;
  float intensity;
  float radius;
} bloom;

vec4 bloom_sampleColor(sampler2D source, vec2 texSize, vec2 texCoord) {
  vec4 original = texture(source, texCoord);
  vec4 glowColor = vec4(0.0);
  float totalWeight = 0.0;

  for (int ring = 1; ring <= 3; ring++) {
    float r = bloom.radius * float(ring);
    float ringWeight = 1.0 / float(ring);
    for (int i = 0; i < 8; i++) {
      float angle = float(i) * 0.7854;
      vec2 offset = vec2(cos(angle), sin(angle)) * r / texSize;
      vec4 s = texture(source, texCoord + offset);
      float brightness = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
      float w = max(0.0, brightness - bloom.threshold) * ringWeight;
      glowColor += s * w;
      totalWeight += w;
    }
  }

  if (totalWeight > 0.0) {
    glowColor /= totalWeight;
  }

  return original + glowColor * bloom.intensity;
}`,
};

// --- Decade color grading presets ---
// Each decade maps to a distinct visual grade.
// Older decades → warmer, lower saturation, sepia tint, film grain.
// Recent decades → sharper contrast, neutral color, no grain.

interface DecadeGrade {
  hue: number;
  saturation: number;
  sepia: number;
  brightness: number;
  contrast: number;
  noise: number;
}

const DECADE_GRADES: Record<number, DecadeGrade> = {
  1960: {
    hue: 0.05,
    saturation: -0.35,
    sepia: 0.45,
    brightness: -0.05,
    contrast: 0.08,
    noise: 0.06,
  },
  1970: {
    hue: 0.08,
    saturation: -0.2,
    sepia: 0.3,
    brightness: -0.03,
    contrast: 0.05,
    noise: 0.05,
  },
  1980: {
    hue: -0.05,
    saturation: 0.1,
    sepia: 0.12,
    brightness: 0.02,
    contrast: 0.1,
    noise: 0.03,
  },
  1990: {
    hue: -0.08,
    saturation: -0.08,
    sepia: 0.05,
    brightness: 0,
    contrast: 0.05,
    noise: 0.02,
  },
  2000: {
    hue: -0.03,
    saturation: 0,
    sepia: 0.02,
    brightness: 0,
    contrast: 0.03,
    noise: 0.01,
  },
  2010: {
    hue: 0,
    saturation: 0.05,
    sepia: 0,
    brightness: 0.02,
    contrast: 0.05,
    noise: 0,
  },
  2020: {
    hue: 0,
    saturation: 0.1,
    sepia: 0,
    brightness: 0.03,
    contrast: 0.08,
    noise: 0,
  },
};

const NEUTRAL_GRADE: DecadeGrade = {
  hue: 0,
  saturation: 0,
  sepia: 0,
  brightness: 0,
  contrast: 0,
  noise: 0,
};

// --- Public API ---

export interface EffectsSystem {
  /** Full effects array — pass directly to Deck's `effects` prop. */
  effects: Effect[];
  /** Update decade color grading. Pass null to reset to neutral. */
  setDecadeGrade: (decade: number | null) => void;
}

/**
 * Create the post-processing effects pipeline.
 * Returns an effects array for Deck and a function to update decade grading.
 */
export function createEffectsSystem(): EffectsSystem {
  // --- Base pipeline (always active) ---

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const bloomEffect = new PostProcessEffect(bloomModule as any, {
    threshold: 0.5,
    intensity: 0.1,
    radius: 3.0,
  });

  const chromaticEffect = new PostProcessEffect(
    chromaticAberrationModule as any,
    { amount: 1.0 },
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const vignetteEffect = new PostProcessEffect(vignette, {
    radius: 0.7,
    amount: 0.2,
  });

  // --- Decade grading (parameters updated dynamically) ---
  // Created with neutral (zero) params so they're pass-through when no decade is selected.

  const hueSatEffect = new PostProcessEffect(hueSaturation, {
    hue: 0,
    saturation: 0,
  });

  const sepiaEffect = new PostProcessEffect(sepia, { amount: 0 });

  const contrastEffect = new PostProcessEffect(brightnessContrast, {
    brightness: 0,
    contrast: 0,
  });

  const noiseEffect = new PostProcessEffect(noise, { amount: 0 });

  // --- Lighting: explicit directional lights for depth cues ---
  // Low ambient so directional shading defines top-vs-side face contrast.
  // Two directional lights: primary from northwest-above, fill from southeast.
  const ambientLight = new AmbientLight({ color: [255, 255, 255], intensity: 0.4 });
  const primaryLight = new DirectionalLight({
    color: [255, 255, 255],
    intensity: 1.0,
    direction: [-1, -3, -1],
  });
  const fillLight = new DirectionalLight({
    color: [255, 255, 255],
    intensity: 0.4,
    direction: [1, 2, -0.5],
  });
  const lightingEffect = new LightingEffect({ ambientLight, primaryLight, fillLight });

  // Order: lighting → bloom → chromatic aberration → grading → vignette.
  // Lighting first so 3D shading is computed before post-processing.
  // Vignette last so edge-darkening applies after everything else.
  const effects: Effect[] = [
    lightingEffect,
    bloomEffect,
    chromaticEffect,
    hueSatEffect,
    sepiaEffect,
    contrastEffect,
    noiseEffect,
    vignetteEffect,
  ];

  function setDecadeGrade(decade: number | null): void {
    const grade =
      decade !== null
        ? DECADE_GRADES[decade] ?? NEUTRAL_GRADE
        : NEUTRAL_GRADE;
    hueSatEffect.setProps({ hue: grade.hue, saturation: grade.saturation });
    sepiaEffect.setProps({ amount: grade.sepia });
    contrastEffect.setProps({
      brightness: grade.brightness,
      contrast: grade.contrast,
    });
    noiseEffect.setProps({ amount: grade.noise });
  }

  return { effects, setDecadeGrade };
}
