'use client';

import './styles/liquid.css';

import * as SliderPrimitive from '@radix-ui/react-slider';
import clsx from 'clsx';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { createFrameLoop, createSpring, motionReduced, stepSpring } from './lib/liquid-motion';
import type { Spring } from './lib/liquid-motion';
import { mergeRefs } from './lib/merge-refs';

export type GlassSliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  /** Names each thumb in value order. Defaults to the slider's aria-label. */
  thumbLabels?: string[];
};

function thumbName(
  index: number,
  count: number,
  sliderLabel: string | undefined,
  thumbLabels: string[] | undefined,
) {
  const own = thumbLabels?.[index];

  if (own !== undefined || count === 1) return own ?? sliderLabel;

  const position = count === 2 ? (index === 0 ? 'minimum' : 'maximum') : `${index + 1} of ${count}`;

  return sliderLabel === undefined ? position : `${sliderLabel}, ${position}`;
}

// How fast a dragged knob moves, in CSS pixels a second, to stretch fully.
const FULL_SPEED = 1100;

// How much a knob at full speed lengthens along the track. It thins across by
// as much, so it keeps its size, like a drop.
const MAX_STRETCH = 0.3;

type Knob = { spring: Spring; position: number };

// A dragged knob stretches along the track with its speed and wobbles back
// into shape when it stops. Reduced motion keeps it still.
function useKnobStretch(rootRef: RefObject<HTMLSpanElement | null>) {
  useEffect(() => {
    const root = rootRef.current;

    if (!root) return;

    const knobs = new WeakMap<HTMLElement, Knob>();
    const elements = () => Array.from(root.querySelectorAll<HTMLElement>('[role="slider"]'));
    let pressed = false;
    let vertical = false;

    const step = (dt: number) => {
      const reduced = motionReduced();
      let moving = pressed;

      for (const element of elements()) {
        const bounds = element.getBoundingClientRect();
        const position = vertical ? bounds.top + bounds.height / 2 : bounds.left + bounds.width / 2;

        const knob = knobs.get(element) ?? {
          spring: createSpring(0.3, 0.45, 0),
          position: Number.NaN,
        };

        const speed = Number.isNaN(knob.position) ? 0 : Math.abs(position - knob.position) / dt;

        knob.position = position;
        knobs.set(element, knob);
        knob.spring.target =
          pressed && !reduced ? Math.min(speed / FULL_SPEED, 1) * MAX_STRETCH : 0;
        moving = stepSpring(knob.spring, dt, reduced) || moving;

        if (knob.spring.value === 0) {
          element.style.removeProperty('--lg-stretch-x');
          element.style.removeProperty('--lg-stretch-y');
          continue;
        }

        const along = Math.max(1 + knob.spring.value, 0.8);

        element.style.setProperty(vertical ? '--lg-stretch-y' : '--lg-stretch-x', along.toFixed(4));
        element.style.setProperty(
          vertical ? '--lg-stretch-x' : '--lg-stretch-y',
          (1 / along).toFixed(4),
        );
      }

      return moving;
    };

    const loop = createFrameLoop(step);

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || root.hasAttribute('data-disabled')) return;

      pressed = true;
      vertical = root.getAttribute('data-orientation') === 'vertical';

      // Radix first jumps the knob under the pointer; that jump is not a drag.
      for (const element of elements()) {
        const knob = knobs.get(element);

        if (knob) knob.position = Number.NaN;
      }

      loop.start();
    };

    // Listens on the window, so a drag that ends off the slider still ends.
    const onPointerUp = () => {
      if (!pressed) return;

      pressed = false;
      loop.start();
    };

    root.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      loop.stop();
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      for (const element of elements()) {
        element.style.removeProperty('--lg-stretch-x');
        element.style.removeProperty('--lg-stretch-y');
      }
    };
  }, [rootRef]);
}

// Radix puts role="slider" on each thumb, so the slider's name moves there too.
export const GlassSlider = forwardRef<HTMLSpanElement, GlassSliderProps>(
  (
    { 'aria-label': sliderLabel, 'aria-labelledby': labelledBy, className, thumbLabels, ...props },
    forwardedRef,
  ) => {
    const rootRef = useRef<HTMLSpanElement | null>(null);
    const ref = useMemo(() => mergeRefs(rootRef, forwardedRef), [forwardedRef]);
    const count = (props.value ?? props.defaultValue ?? [props.min ?? 0]).length;

    useKnobStretch(rootRef);

    return (
      <SliderPrimitive.Root ref={ref} className={clsx('lg-slider', className)} {...props}>
        <SliderPrimitive.Track className="lg-slider-track">
          <SliderPrimitive.Range className="lg-slider-range" />
        </SliderPrimitive.Track>
        {Array.from({ length: count }, (_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            aria-label={thumbName(index, count, sliderLabel, thumbLabels)}
            aria-labelledby={labelledBy}
            className="lg-slider-thumb"
          />
        ))}
      </SliderPrimitive.Root>
    );
  },
);

GlassSlider.displayName = 'GlassSlider';
