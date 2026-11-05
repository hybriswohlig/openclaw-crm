'use client';

import clsx from 'clsx';
import { Children, forwardRef, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { mergeRefs } from './lib/merge-refs';
import { useGlassScenePane } from './lib/scene-context';
import { useLensFilter, useRefractionFilter } from './lib/use-refraction-filter';
import { useOptionalPreferences } from './glass-provider';

export type SurfaceRefraction = 'none' | 'soft' | 'strong';

export type RefractionBackgroundSpace = 'local' | 'viewport';

export type SurfacePreset = 'subtle' | 'standard' | 'prominent' | 'control' | 'showcase';

export type GlassSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  /** Brightens the surface a touch on hover. */
  interactive?: boolean;
  /** Chromium edge lens over the frost. On by default for control and showcase presets. */
  lens?: boolean;
  preset?: SurfacePreset;
  refraction?: SurfaceRefraction;
  refractionBackground?: ReactNode;
  refractionBackgroundSpace?: RefractionBackgroundSpace;
  refractionDisplacement?: number;
  /**
   * How thick this glass is, as a multiple of regular. A thicker slab has a
   * wider rim that bends the backdrop further and splits more colour. Defaults
   * to the site's thickness preference. Works with a supplied backdrop in every
   * browser, or with the Chromium lens over live content.
   */
  thickness?: number;
};

// Increased contrast dims the lens through its tokens, which the lens reads only when it measures.
const contrastQuery = '(prefers-contrast: more)';

const subscribeToContrast = (onChange: () => void) => {
  const query = window.matchMedia(contrastQuery);
  query.addEventListener('change', onChange);

  return () => query.removeEventListener('change', onChange);
};

const readContrast = () => window.matchMedia(contrastQuery).matches;

const readServerContrast = () => false;

export const GlassSurface = forwardRef<HTMLDivElement, GlassSurfaceProps>(
  (
    {
      className,
      children,
      interactive = false,
      preset = 'standard',
      lens = preset === 'control' || preset === 'showcase',
      refraction = preset === 'showcase' ? 'strong' : 'none',
      refractionBackground,
      refractionBackgroundSpace = 'local',
      refractionDisplacement,
      style,
      thickness,
      ...rest
    },
    forwardedRef,
  ) => {
    const { preferences } = useOptionalPreferences();
    const reduceMotion = Boolean(preferences?.reduceMotion);
    const reduceTransparency = Boolean(preferences?.reduceTransparency);
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const ref = useMemo(() => mergeRefs(surfaceRef, forwardedRef), [forwardedRef]);

    const generatedRefractionEnabled =
      refraction !== 'none' &&
      Boolean(refractionBackground) &&
      !reduceMotion &&
      !reduceTransparency;

    const { active, filterElement, filterStyle, sceneRef } = useRefractionFilter(surfaceRef, {
      displacement: refractionDisplacement,
      enabled: generatedRefractionEnabled,
      reduceTransparency,
      strength: refraction === 'none' ? 'soft' : refraction,
      thickness: thickness ?? preferences?.thickness,
      viewportAligned: refractionBackgroundSpace === 'viewport',
    });

    const moreContrast = useSyncExternalStore(
      subscribeToContrast,
      readContrast,
      readServerContrast,
    );

    // One refraction technique at a time: a generated background scene covers the frost.
    const lensFilter = useLensFilter(surfaceRef, {
      enabled: lens && !generatedRefractionEnabled && !reduceTransparency,
      signature: `${preferences?.theme}:${preferences?.mode}:${preferences?.quality}:${thickness ?? preferences?.thickness}:${moreContrast}`,
    });

    // Inside a GlassScene the canvas draws this glass; a generated refraction
    // scene is its own backdrop and keeps its CSS material.
    useGlassScenePane(surfaceRef, !generatedRefractionEnabled);

    return (
      <div
        ref={ref}
        data-lg-generated-refraction={active ? 'true' : 'false'}
        data-lg-interactive={interactive ? 'true' : 'false'}
        data-lg-lens={lensFilter.active ? 'active' : undefined}
        data-lg-preset={preset}
        data-lg-refraction={refraction}
        data-lg-refraction-background-space={refractionBackgroundSpace}
        className={clsx('lg-glass-surface', className)}
        style={
          // SAFETY: CSSProperties has no custom-property index; these add string-valued properties.
          lensFilter.filterStyle || thickness !== undefined
            ? ({
                ...style,
                ...(thickness === undefined ? null : { '--lg-glass-thickness': thickness }),
                ...(lensFilter.filterStyle ? { '--lg-lens-filter': lensFilter.filterStyle } : null),
              } as CSSProperties)
            : style
        }
        {...rest}
      >
        {filterElement}
        {lensFilter.filterElement}
        {active ? (
          <div
            className="lg-refraction-background"
            aria-hidden="true"
            style={{ filter: filterStyle }}
          >
            <div ref={sceneRef} className="lg-refraction-scene">
              {refractionBackground}
            </div>
          </div>
        ) : null}
        <span className="lg-noise" aria-hidden />
        {Children.map(children, (child) =>
          // Children.map yields null, elements, portals or text; wrap only the text.
          child === null || child instanceof Object ? (
            child
          ) : (
            <span className="lg-glass-text">{child}</span>
          ),
        )}
      </div>
    );
  },
);

GlassSurface.displayName = 'GlassSurface';
