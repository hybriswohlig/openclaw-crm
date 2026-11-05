'use client';

import './styles/liquid.css';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import clsx from 'clsx';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { motionReduced } from './lib/liquid-motion';
import { mergeRefs } from './lib/merge-refs';
import { useCapsuleLensFilter } from './lib/use-refraction-filter';
import { useOptionalPreferences } from './glass-provider';

export type GlassSwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'md';
};

// How long the knob stays glass after a flip, a little longer than its slide.
const TRAVEL_MS = 460;

// The colour split at the knob's rim. A lens this small, drawn only while the knob is
// touched or sliding, costs little, so it splits colour at every quality but low.
const KNOB_DISPERSION = 0.3;

// The lens's copy is laid out at three times the knob's size and scaled back down, so
// engines that filter at layout resolution still bend it smoothly.
const LENS_SUPERSAMPLE = 3;

let backdropCanvas: HTMLCanvasElement | null = null;

// The colour behind an element: its ancestors' background colours laid over one another,
// from the page down. Undefined when none of them is opaque.
function backdropColour(element: HTMLElement) {
  const colours: string[] = [];

  for (let node = element.parentElement; node; node = node.parentElement) {
    const colour = window.getComputedStyle(node).backgroundColor;

    if (colour && colour !== 'transparent' && colour !== 'rgba(0, 0, 0, 0)') colours.push(colour);
  }

  backdropCanvas ??= document.createElement('canvas');
  backdropCanvas.width = 1;
  backdropCanvas.height = 1;

  const context = backdropCanvas.getContext('2d', { willReadFrequently: true });

  if (!context || colours.length === 0) return undefined;

  for (const colour of colours.reverse()) {
    context.fillStyle = colour;
    context.fillRect(0, 0, 1, 1);
  }

  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;

  return alpha === 255 ? `rgb(${red} ${green} ${blue})` : undefined;
}

// The knob swells into glass while pressed and stays that way while it slides to
// its new side, then shrinks back; see .lg-switch in liquid.css. The glass
// is a lens over a copy of the track and the colour behind the switch: it shows them a
// little smaller, and they bend into the rim and split into colour there in every engine.
export const GlassSwitch = forwardRef<HTMLButtonElement, GlassSwitchProps>(
  (
    { className, disabled, size = 'md', onCheckedChange, onPointerDown, ...props },
    forwardedRef,
  ) => {
    const { preferences } = useOptionalPreferences();
    const rootRef = useRef<HTMLButtonElement | null>(null);
    const thumbRef = useRef<HTMLSpanElement | null>(null);
    const travel = useRef(0);
    const ref = useMemo(() => mergeRefs(rootRef, forwardedRef), [forwardedRef]);

    const lens = useCapsuleLensFilter(thumbRef, {
      dispersion: KNOB_DISPERSION,
      enabled: !disabled && !preferences.reduceTransparency && preferences.quality !== 'low',
      signature: `${preferences.theme}:${preferences.quality}:${preferences.thickness}`,
      supersample: LENS_SUPERSAMPLE,
    });

    useEffect(() => () => window.clearTimeout(travel.current), []);

    // The lens hides the real track under the knob behind the colour around the switch,
    // read as the knob turns to glass, since the page under it can change.
    const readBackdrop = () => {
      const root = rootRef.current;
      const thumb = thumbRef.current;

      if (!lens.active || !root || !thumb) return;

      const colour = backdropColour(root);

      if (colour) thumb.style.setProperty('--lg-switch-lens-backdrop', colour);
      else thumb.style.removeProperty('--lg-switch-lens-backdrop');
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerDown?.(event);
      readBackdrop();
    };

    const handleCheckedChange = (checked: boolean) => {
      onCheckedChange?.(checked);

      const root = rootRef.current;

      if (!root || motionReduced()) return;

      readBackdrop();
      window.clearTimeout(travel.current);
      root.setAttribute('data-lg-moving', '');
      travel.current = window.setTimeout(() => root.removeAttribute('data-lg-moving'), TRAVEL_MS);
    };

    return (
      <SwitchPrimitive.Root
        ref={ref}
        data-size={size}
        className={clsx('lg-switch', className)}
        disabled={disabled}
        onCheckedChange={handleCheckedChange}
        onPointerDown={handlePointerDown}
        {...props}
      >
        {lens.filterElement}
        <SwitchPrimitive.Thumb
          ref={thumbRef}
          className="lg-switch-thumb"
          style={
            // SAFETY: CSSProperties has no custom-property index; this adds two custom properties.
            lens.active
              ? ({
                  '--lg-switch-lens-margin': `${lens.margin}px`,
                  '--lg-switch-lens-scale': lens.supersample,
                } as CSSProperties)
              : undefined
          }
        >
          {lens.active ? (
            <span aria-hidden className="lg-switch-lens">
              <span className="lg-switch-lens-view" style={{ filter: lens.filterStyle }}>
                <span className="lg-switch-lens-scene">
                  <span className="lg-switch-lens-track" />
                </span>
              </span>
            </span>
          ) : null}
        </SwitchPrimitive.Thumb>
      </SwitchPrimitive.Root>
    );
  },
);

GlassSwitch.displayName = 'GlassSwitch';
