export type GlassyUiMode = 'clear' | 'tinted';

export type GlassyUiQuality = 'low' | 'medium' | 'high';

export type GlassyUiTheme = 'light' | 'dark';

export interface GlassyUiPreferences {
  theme?: GlassyUiTheme;
  mode?: GlassyUiMode;
  reduceTransparency?: boolean;
  reduceMotion?: boolean;
  quality?: GlassyUiQuality;
  /**
   * How thick the glass is, as a multiple of regular: its rim widens, bends the
   * backdrop further and splits more colour. Kept between 0.25 and 2.
   */
  thickness?: number;
}

/** The range of the thickness preference. 1 is regular glass. */
export const GLASS_THICKNESS = { min: 0.25, max: 2, regular: 1 } as const;

const THICKNESS_PROPERTY = '--lg-glass-thickness';

function clampThickness(value: number) {
  return Math.min(Math.max(value, GLASS_THICKNESS.min), GLASS_THICKNESS.max);
}

type NavigatorWithMemory = Navigator & { deviceMemory?: number };

const DATA_KEYS = {
  theme: 'data-lg-theme',
  mode: 'data-lg-mode',
  reduceTransparency: 'data-lg-reduce-transparency',
  reduceMotion: 'data-lg-reduce-motion',
  quality: 'data-lg-quality',
} as const;

const STORAGE_KEY = 'glassy-ui-preferences';

const THEMES = ['light', 'dark'] as const satisfies readonly GlassyUiTheme[];

const MODES = ['clear', 'tinted'] as const satisfies readonly GlassyUiMode[];

const QUALITIES = ['low', 'medium', 'high'] as const satisfies readonly GlassyUiQuality[];

const FLAGS = [true, false] as const;

export function applyPreferences(target: Document, prefs: GlassyUiPreferences) {
  const root = target.documentElement;

  if (prefs.theme) {
    root.setAttribute(DATA_KEYS.theme, prefs.theme);
  }

  if (prefs.mode) {
    root.setAttribute(DATA_KEYS.mode, prefs.mode);
  }

  if (prefs.reduceTransparency !== undefined) {
    root.setAttribute(DATA_KEYS.reduceTransparency, prefs.reduceTransparency ? '1' : '0');
  }

  if (prefs.reduceMotion !== undefined) {
    root.setAttribute(DATA_KEYS.reduceMotion, prefs.reduceMotion ? '1' : '0');
  }

  if (prefs.quality) {
    root.setAttribute(DATA_KEYS.quality, prefs.quality);
  }

  if (prefs.thickness !== undefined) {
    root.style.setProperty(THICKNESS_PROPERTY, String(clampThickness(prefs.thickness)));
  }
}

export function readPreferences(source: Document): Required<GlassyUiPreferences> {
  const root = source.documentElement;

  const readOption = <T extends string>(name: string, options: readonly T[], fallback: T) => {
    const value = root.getAttribute(name);

    return options.find((option) => option === value) ?? fallback;
  };

  return {
    theme: readOption(DATA_KEYS.theme, THEMES, 'dark'),
    mode: readOption(DATA_KEYS.mode, MODES, 'clear'),
    reduceTransparency: root.getAttribute(DATA_KEYS.reduceTransparency) === '1',
    reduceMotion: root.getAttribute(DATA_KEYS.reduceMotion) === '1',
    quality: readOption(DATA_KEYS.quality, QUALITIES, 'high'),
    thickness: clampThickness(
      Number.parseFloat(root.style.getPropertyValue(THICKNESS_PROPERTY)) || GLASS_THICKNESS.regular,
    ),
  };
}

export function persistPreferences(
  prefs: GlassyUiPreferences,
  storage: Storage = window.localStorage,
) {
  const current = loadPreferences(storage);
  const merged = { ...current, ...prefs } satisfies GlassyUiPreferences;
  storage.setItem(STORAGE_KEY, JSON.stringify(merged));
}

export function loadPreferences(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): GlassyUiPreferences {
  const raw = storage.getItem(STORAGE_KEY);

  if (!raw) {
    return {};
  }

  try {
    return decodePreferences(raw);
  } catch (error) {
    console.warn('Failed to parse Glassy UI preferences', error);

    return {};
  }
}

/** Keep the stored fields that hold a known value; drop stale or malformed entries. */
function decodePreferences(raw: string): GlassyUiPreferences {
  const stored: ReadonlyMap<string, unknown> = new Map(Object.entries(JSON.parse(raw)));
  const prefs: GlassyUiPreferences = {};

  const keep = <K extends keyof GlassyUiPreferences>(
    key: K,
    options: readonly NonNullable<GlassyUiPreferences[K]>[],
  ) => {
    const value = options.find((option) => option === stored.get(key));

    if (value !== undefined) {
      prefs[key] = value;
    }
  };

  keep('theme', THEMES);
  keep('mode', MODES);
  keep('reduceTransparency', FLAGS);
  keep('reduceMotion', FLAGS);
  keep('quality', QUALITIES);

  const thickness = Number(stored.get('thickness'));

  if (Number.isFinite(thickness) && stored.has('thickness')) {
    prefs.thickness = clampThickness(thickness);
  }

  return prefs;
}

export { STORAGE_KEY as PREFERENCE_STORAGE_KEY };

export function computeAutomaticSafeguards(): Required<
  Pick<GlassyUiPreferences, 'quality' | 'reduceMotion' | 'reduceTransparency'>
> {
  if (typeof window === 'undefined') {
    return { quality: 'high', reduceMotion: false, reduceTransparency: false };
  }

  const supportsMatchMedia = 'matchMedia' in window;
  const coarsePointer = supportsMatchMedia && window.matchMedia('(pointer: coarse)').matches;

  const prefersReducedMotion =
    supportsMatchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const prefersReducedTransparency =
    supportsMatchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches;

  // SAFETY: deviceMemory is a number where the Device Memory API exists and absent elsewhere.
  const deviceMemory = (navigator as NavigatorWithMemory).deviceMemory;
  const lowMemory = deviceMemory !== undefined && deviceMemory <= 4;

  // Device heuristics only lower rendering quality. Opaque surfaces and stopped
  // motion stay reserved for the user's own accessibility settings.
  const quality: GlassyUiQuality =
    prefersReducedTransparency || lowMemory
      ? 'low'
      : coarsePointer || prefersReducedMotion
        ? 'medium'
        : 'high';

  return {
    quality,
    reduceMotion: Boolean(prefersReducedMotion),
    reduceTransparency: Boolean(prefersReducedTransparency),
  };
}
