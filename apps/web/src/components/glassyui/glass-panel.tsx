'use client';

import clsx from 'clsx';
import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { GlassSurface } from './glass-surface';
import type { RefractionBackgroundSpace } from './glass-surface';

type PanelVariant = 'panel' | 'card' | 'pill';

type PanelElevation = 'base' | 'raised';

type PanelRefraction = 'none' | 'soft' | 'strong';

type PanelPreset = 'subtle' | 'standard' | 'prominent' | 'control' | 'showcase';

export type GlassPanelProps = HTMLAttributes<HTMLDivElement> & {
  variant?: PanelVariant;
  elevation?: PanelElevation;
  /** Brightens the surface a touch on hover. */
  interactive?: boolean;
  /** Chromium edge lens over the frost. On by default for control and showcase presets. */
  lens?: boolean;
  preset?: PanelPreset;
  refraction?: PanelRefraction;
  refractionBackground?: ReactNode;
  refractionBackgroundSpace?: RefractionBackgroundSpace;
  refractionDisplacement?: number;
  /** How thick the glass is, as a multiple of regular. See GlassSurface. */
  thickness?: number;
};

// Shape, spacing and elevation live in liquid.css, below Tailwind utilities.
const VARIANT_CLASS: Record<PanelVariant, string> = {
  panel: 'lg-panel--panel',
  card: 'lg-panel--card',
  pill: 'lg-panel--pill',
};

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  (
    {
      className,
      variant = 'panel',
      elevation = 'base',
      interactive = false,
      lens,
      preset = variant === 'pill' ? 'control' : 'standard',
      refraction = preset === 'showcase' ? 'strong' : 'none',
      refractionBackground,
      refractionBackgroundSpace,
      refractionDisplacement,
      ...rest
    },
    forwardedRef,
  ) => {
    return (
      <GlassSurface
        ref={forwardedRef}
        interactive={interactive}
        lens={lens}
        preset={preset}
        refraction={refraction}
        refractionBackground={refractionBackground}
        refractionBackgroundSpace={refractionBackgroundSpace}
        refractionDisplacement={refractionDisplacement}
        className={clsx(
          VARIANT_CLASS[variant],
          elevation === 'raised' && 'lg-panel--raised',
          className,
        )}
        {...rest}
      />
    );
  },
);

GlassPanel.displayName = 'GlassPanel';
