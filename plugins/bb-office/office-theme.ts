import type { ColorValue } from "./vendor/pixel-agents/webview-ui/src/components/ui/types";
import type { CarpetTile } from "./vendor/pixel-agents/webview-ui/src/office/types";

export const OFFICE_APPEARANCE_SETTING_OPTIONS = [
  "Follow BB",
  "Neutral",
  "Original",
] as const;

export type OfficeAppearance = "follow-bb" | "neutral" | "original";

export interface OfficeVisualTheme {
  appearance: OfficeAppearance;
  mode: "light" | "dark";
  accentHue: number;
  accentSaturation: number;
}

interface OfficeEnvironmentPalette {
  floors: Record<"meeting" | "open" | "social" | "wall", ColorValue>;
  carpets: Record<"lounge" | "meeting" | "social", Omit<CarpetTile, "variant">>;
}

export const ORIGINAL_OFFICE_VISUAL_THEME: OfficeVisualTheme = {
  appearance: "original",
  mode: "light",
  accentHue: 213,
  accentSaturation: 32,
};

const ORIGINAL_PALETTE: OfficeEnvironmentPalette = {
  floors: {
    meeting: { h: 213, s: 32, b: -17, c: -31 },
    open: { h: 26, s: 43, b: -33, c: -47 },
    social: { h: 31, s: 36, b: -20, c: -31 },
    wall: { h: 218, s: 34, b: -76, c: -54 },
  },
  carpets: {
    lounge: {
      color: { h: 202, s: 34, b: -22, c: -26 },
      accentColor: { h: 185, s: 22, b: 8, c: 4 },
    },
    meeting: {
      color: { h: 220, s: 28, b: -24, c: -28 },
      accentColor: { h: 42, s: 24, b: 6, c: 4 },
    },
    social: {
      color: { h: 34, s: 36, b: -18, c: -22 },
      accentColor: { h: 16, s: 30, b: 2, c: 2 },
    },
  },
};

function normalizedHue(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

function boundedSaturation(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function parseOfficeAppearance(
  value: string | boolean | undefined,
): OfficeAppearance {
  if (value === "Neutral") return "neutral";
  if (value === "Original") return "original";
  return "follow-bb";
}

export function officeVisualThemeFromRgb(
  appearance: OfficeAppearance,
  mode: "light" | "dark",
  red: number,
  green: number,
  blue: number,
): OfficeVisualTheme {
  const redFraction = red / 255;
  const greenFraction = green / 255;
  const blueFraction = blue / 255;
  const maximum = Math.max(redFraction, greenFraction, blueFraction);
  const minimum = Math.min(redFraction, greenFraction, blueFraction);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;
  if (delta !== 0) {
    if (maximum === redFraction) {
      hue = 60 * (((greenFraction - blueFraction) / delta) % 6);
    } else if (maximum === greenFraction) {
      hue = 60 * ((blueFraction - redFraction) / delta + 2);
    } else {
      hue = 60 * ((redFraction - greenFraction) / delta + 4);
    }
  }
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return {
    appearance,
    mode,
    accentHue: normalizedHue(hue),
    accentSaturation: boundedSaturation(saturation * 100),
  };
}

export function resolveOfficeEnvironmentPalette(
  theme: OfficeVisualTheme,
): OfficeEnvironmentPalette {
  if (theme.appearance === "original") return ORIGINAL_PALETTE;
  if (theme.appearance === "neutral") {
    return {
      floors: {
        meeting: { h: 0, s: 0, b: -17, c: -31 },
        open: { h: 0, s: 0, b: -33, c: -47 },
        social: { h: 0, s: 0, b: -20, c: -31 },
        wall: { h: 0, s: 0, b: -76, c: -54 },
      },
      carpets: {
        lounge: {
          color: { h: 0, s: 0, b: -22, c: -26 },
          accentColor: { h: 0, s: 0, b: 8, c: 4 },
        },
        meeting: {
          color: { h: 0, s: 0, b: -24, c: -28 },
          accentColor: { h: 0, s: 0, b: 6, c: 4 },
        },
        social: {
          color: { h: 0, s: 0, b: -18, c: -22 },
          accentColor: { h: 0, s: 0, b: 2, c: 2 },
        },
      },
    };
  }
  const hue = normalizedHue(theme.accentHue);
  const saturation = boundedSaturation(theme.accentSaturation);
  const environmentSaturation = Math.min(32, Math.round(saturation * 0.4));
  const subtleSaturation = Math.min(20, Math.round(saturation * 0.25));
  const wallSaturation = Math.min(16, Math.round(saturation * 0.2));
  return {
    floors: {
      meeting: { h: hue, s: environmentSaturation, b: -17, c: -31 },
      open: ORIGINAL_PALETTE.floors.open,
      social: ORIGINAL_PALETTE.floors.social,
      wall: { h: hue, s: wallSaturation, b: -76, c: -54 },
    },
    carpets: {
      lounge: {
        color: { h: hue, s: environmentSaturation, b: -22, c: -26 },
        accentColor: {
          h: normalizedHue(hue + 24),
          s: subtleSaturation,
          b: 8,
          c: 4,
        },
      },
      meeting: {
        color: { h: hue, s: environmentSaturation, b: -24, c: -28 },
        accentColor: {
          h: normalizedHue(hue + 36),
          s: subtleSaturation,
          b: 6,
          c: 4,
        },
      },
      social: ORIGINAL_PALETTE.carpets.social,
    },
  };
}
