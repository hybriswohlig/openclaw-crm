'use client';

import './styles/liquid.css';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  applyPreferences,
  computeAutomaticSafeguards,
  GLASS_THICKNESS,
  loadPreferences,
  persistPreferences,
  type GlassyUiPreferences,
  type GlassyUiTheme,
} from './lib/preferences';

type PreferenceState = Required<GlassyUiPreferences>;

type SystemPreferenceState = Pick<
  PreferenceState,
  'theme' | 'quality' | 'reduceMotion' | 'reduceTransparency'
>;

type PreferenceSources = {
  explicit: GlassyUiPreferences;
  system: SystemPreferenceState;
};

type PreferenceContextValue = {
  preferences: PreferenceState;
  setPreferences: (prefs: Partial<GlassyUiPreferences>) => void;
};

const DEFAULT_STATE: PreferenceState = {
  theme: 'dark',
  mode: 'clear',
  reduceTransparency: false,
  reduceMotion: false,
  quality: 'high',
  thickness: GLASS_THICKNESS.regular,
};

const SERVER_SOURCES: PreferenceSources = {
  explicit: {},
  system: {
    theme: DEFAULT_STATE.theme,
    quality: DEFAULT_STATE.quality,
    reduceMotion: DEFAULT_STATE.reduceMotion,
    reduceTransparency: DEFAULT_STATE.reduceTransparency,
  },
};

const subscribeToHydration = () => () => {};

const transparencyQuery = '(prefers-reduced-transparency: reduce)';

function subscribeToSystemTransparency(onChange: () => void) {
  const query = window.matchMedia(transparencyQuery);
  query.addEventListener('change', onChange);

  return () => query.removeEventListener('change', onChange);
}

const readSystemTransparency = () => window.matchMedia(transparencyQuery).matches;

const readServerTransparency = () => DEFAULT_STATE.reduceTransparency;

const PreferencesContext = createContext<PreferenceContextValue | null>(null);

function warnPreferenceFailure(message: string, cause: unknown) {
  console.warn(message, cause);
}

function mergePreferences(
  base: PreferenceState,
  next: Partial<GlassyUiPreferences>,
): PreferenceState {
  return {
    ...base,
    ...next,
  };
}

function readSystemPreferences(): SystemPreferenceState {
  if (typeof window === 'undefined') {
    return {
      theme: DEFAULT_STATE.theme,
      quality: DEFAULT_STATE.quality,
      reduceMotion: DEFAULT_STATE.reduceMotion,
      reduceTransparency: DEFAULT_STATE.reduceTransparency,
    };
  }

  const automatic = computeAutomaticSafeguards();

  const systemPrefersLight =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;

  return {
    theme: systemPrefersLight ? 'light' : DEFAULT_STATE.theme,
    quality: automatic.quality,
    reduceMotion: automatic.reduceMotion,
    reduceTransparency: automatic.reduceTransparency,
  };
}

function readInitialPreferenceSources(): PreferenceSources {
  if (typeof window === 'undefined') {
    return { explicit: {}, system: readSystemPreferences() };
  }

  let explicit: GlassyUiPreferences = {};

  try {
    explicit = loadPreferences();
  } catch (error) {
    warnPreferenceFailure('Failed to load Glassy UI preferences', error);
  }

  return { explicit, system: readSystemPreferences() };
}

/**
 * Holds the glass preferences and applies them to the document. `defaultTheme` is the theme a
 * visitor sees until they choose one, whatever their system prefers; leave it out to follow the
 * system setting.
 */
export function GlassProvider({
  children,
  defaultTheme,
}: {
  children: ReactNode;
  defaultTheme?: GlassyUiTheme;
}) {
  const [sources, setSources] = useState<PreferenceSources>(readInitialPreferenceSources);

  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  const activeSources = hydrated ? sources : SERVER_SOURCES;

  const preferences = useMemo(
    () =>
      mergePreferences(
        mergePreferences(
          DEFAULT_STATE,
          defaultTheme ? { ...activeSources.system, theme: defaultTheme } : activeSources.system,
        ),
        activeSources.explicit,
      ),
    [activeSources, defaultTheme],
  );

  useEffect(() => {
    if (!hydrated || typeof document === 'undefined') {
      return;
    }

    applyPreferences(document, preferences);
  }, [hydrated, preferences]);

  const update = useCallback((next: Partial<GlassyUiPreferences>) => {
    // The document changes before React renders whatever asked for the change, so a
    // control's own flip runs under the setting it lands in. Turning Reduce Motion off
    // from its own switch then animates instead of snapping under the old setting.
    if (typeof document !== 'undefined') {
      applyPreferences(document, next);
    }

    setSources((previous) => {
      const explicit = { ...previous.explicit, ...next };

      if (typeof window !== 'undefined') {
        try {
          persistPreferences(explicit);
        } catch (error) {
          warnPreferenceFailure('Failed to persist Glassy UI preferences', error);
        }
      }

      return { ...previous, explicit };
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const queries = [
      '(prefers-color-scheme: light)',
      '(prefers-reduced-motion: reduce)',
      '(prefers-reduced-transparency: reduce)',
      '(pointer: coarse)',
    ].map((query) => window.matchMedia(query));

    const handler = () => {
      setSources((previous) => ({ ...previous, system: readSystemPreferences() }));
    };

    queries.forEach((query) => query.addEventListener('change', handler));

    return () => queries.forEach((query) => query.removeEventListener('change', handler));
  }, []);

  const value = useMemo<PreferenceContextValue>(
    () => ({
      preferences,
      setPreferences: update,
    }),
    [preferences, update],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export const PreferencesProvider = GlassProvider;

export function useOptionalPreferences() {
  const context = useContext(PreferencesContext);

  const reduceTransparency = useSyncExternalStore(
    context ? subscribeToHydration : subscribeToSystemTransparency,
    context ? () => context.preferences.reduceTransparency : readSystemTransparency,
    readServerTransparency,
  );

  return (
    context ?? {
      preferences: { ...DEFAULT_STATE, reduceTransparency },
      setPreferences: () => {},
    }
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);

  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }

  return context;
}
