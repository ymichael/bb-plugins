import type {
  OfficeProviderUsage,
  OfficeUsageSnapshot,
  OfficeUsageWindow,
} from "./office-usage";
import type { OfficeVisualTheme } from "./office-theme";

export interface UsageProviderIdentity {
  providerId: string;
  displayName: string;
}

export interface UsagePosterPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UsagePoster {
  providerId: string;
  displayName: string;
  monogram: string;
  status: OfficeProviderUsage["status"] | "loading";
  planLabel: string | null;
  windows: readonly OfficeUsageWindow[];
  primaryWindow: OfficeUsageWindow | null;
  placement: UsagePosterPlacement;
}

const POSTER_SLOTS: readonly UsagePosterPlacement[] = [
  { x: 81, y: 130, width: 45, height: 12 },
  { x: 209, y: 130, width: 45, height: 12 },
  { x: 337, y: 130, width: 45, height: 12 },
];

const SLOT_INDICES: Readonly<Record<number, readonly number[]>> = {
  0: [],
  1: [1],
  2: [0, 2],
  3: [0, 1, 2],
};

function constrainedWindow(
  windows: readonly OfficeUsageWindow[],
): OfficeUsageWindow | null {
  let constrained: OfficeUsageWindow | null = null;
  for (const window of windows) {
    if (
      constrained === null ||
      window.usedPercent > constrained.usedPercent
    ) {
      constrained = window;
    }
  }
  return constrained;
}

export function providerMonogram(displayName: string): string {
  const words = displayName
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length > 0);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  }
  const word = words[0] ?? "BB";
  if (word.length === 1) return word.toUpperCase();
  return `${word[0]}${word.at(-1)}`.toUpperCase();
}

export function buildUsagePosters(
  identities: readonly UsageProviderIdentity[],
  snapshot: OfficeUsageSnapshot | null,
): readonly UsagePoster[] {
  const limited = identities.slice(0, 3);
  const slotIndices = SLOT_INDICES[limited.length] ?? SLOT_INDICES[3];
  const usageByProvider = new Map(
    snapshot?.providers.map((provider) => [provider.providerId, provider]) ?? [],
  );
  return limited.map((identity, index) => {
    const usage = usageByProvider.get(identity.providerId);
    const windows = usage?.windows ?? [];
    return {
      ...identity,
      monogram: providerMonogram(identity.displayName),
      status: usage?.status ?? "loading",
      planLabel: usage?.planLabel ?? null,
      windows,
      primaryWindow: constrainedWindow(windows),
      placement: POSTER_SLOTS[slotIndices[index] ?? 1] ?? POSTER_SLOTS[1],
    };
  });
}

export function usagePosterSummary(poster: UsagePoster): string {
  if (poster.status === "loading") return "Checking usage";
  if (poster.status === "not_installed") return "Provider not installed";
  if (poster.status === "unauthenticated") return "Sign-in required";
  if (poster.status === "expired") return "Session expired";
  if (poster.status === "error") return "Usage unavailable";
  if (poster.primaryWindow === null) return "No usage window reported";
  return `${Math.round(poster.primaryWindow.usedPercent)}% used · ${poster.primaryWindow.label}`;
}

function posterHue(theme: OfficeVisualTheme): number {
  if (theme.appearance === "original") return 197;
  return theme.accentHue;
}

function posterSaturation(theme: OfficeVisualTheme): number {
  if (theme.appearance === "neutral") return 0;
  if (theme.appearance === "original") return 36;
  return Math.min(54, Math.max(18, theme.accentSaturation));
}

function hsl(hue: number, saturation: number, lightness: number): string {
  return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

function usageColor(
  poster: UsagePoster,
  theme: OfficeVisualTheme,
): string {
  const usedPercent = poster.primaryWindow?.usedPercent ?? 0;
  const lightness = theme.mode === "dark" ? 65 : 42;
  if (usedPercent >= 95) return hsl(7, 62, lightness);
  if (usedPercent >= 80) return hsl(42, 68, lightness);
  return hsl(posterHue(theme), posterSaturation(theme), lightness);
}

export function renderUsagePosters(
  context: CanvasRenderingContext2D,
  posters: readonly UsagePoster[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  theme: OfficeVisualTheme,
): void {
  const hue = posterHue(theme);
  const saturation = posterSaturation(theme);
  const frameLightness = theme.mode === "dark" ? 68 : 26;
  const paperLightness = theme.mode === "dark" ? 25 : 84;
  const trackLightness = theme.mode === "dark" ? 39 : 66;
  context.save();
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.font = `700 ${Math.max(5, Math.round(5 * zoom))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  for (const poster of posters) {
    const { placement } = poster;
    const x = Math.round(offsetX + placement.x * zoom);
    const y = Math.round(offsetY + placement.y * zoom);
    const width = Math.max(1, Math.round(placement.width * zoom));
    const height = Math.max(1, Math.round(placement.height * zoom));
    const inset = Math.max(1, Math.round(2 * zoom));
    const monogramWidth = Math.max(5, Math.round(10 * zoom));
    const trackX = x + inset + monogramWidth;
    const trackWidth = Math.max(1, width - inset * 3 - monogramWidth);
    const trackHeight = Math.max(1, Math.round(3 * zoom));
    const trackY = y + Math.round((height - trackHeight) / 2);
    context.fillStyle = hsl(hue, saturation * 0.55, frameLightness);
    context.fillRect(x, y, width, height);
    context.fillStyle = hsl(hue, saturation * 0.22, paperLightness);
    context.fillRect(
      x + inset,
      y + inset,
      Math.max(1, width - inset * 2),
      Math.max(1, height - inset * 2),
    );
    context.fillStyle = hsl(hue, saturation * 0.25, trackLightness);
    context.fillRect(trackX, trackY, trackWidth, trackHeight);
    if (poster.primaryWindow !== null) {
      context.fillStyle = usageColor(poster, theme);
      context.fillRect(
        trackX,
        trackY,
        Math.max(
          1,
          Math.round(trackWidth * (poster.primaryWindow.usedPercent / 100)),
        ),
        trackHeight,
      );
    }
    context.fillStyle = hsl(hue, saturation * 0.4, frameLightness);
    context.fillText(
      poster.monogram,
      x + inset + Math.max(1, Math.round(1 * zoom)),
      y + height / 2,
    );
  }
  context.restore();
}
