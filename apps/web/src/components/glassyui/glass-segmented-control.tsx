'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import clsx from 'clsx';
import { forwardRef, useMemo, useRef } from 'react';
import { useLiquidIndicator } from './lib/liquid-motion';
import { mergeRefs } from './lib/merge-refs';
import { GlassPanel } from './glass-panel';

const radixSlotProps = { asChild: true };

export type GlassSegmentedControlProps = React.ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Root
>;

const INDICATOR = {
  selected: '[role="radio"][data-state="checked"]',
  item: '[role="radio"]',
  draggable: true,
  deformation: 0.25,
};

/**
 * A single-choice control for two to six options. CSS places the indicator from the
 * checked item, so it is correct from the first server render; once scripts run it
 * moves like a drop of glass and can be dragged to another option.
 */
export const GlassSegmentedControl = forwardRef<HTMLDivElement, GlassSegmentedControlProps>(
  ({ children, className, ...props }, forwardedRef) => {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const indicatorRef = useRef<HTMLSpanElement | null>(null);
    const ref = useMemo(() => mergeRefs(rootRef, forwardedRef), [forwardedRef]);

    useLiquidIndicator(rootRef, indicatorRef, INDICATOR);

    return (
      <RadioGroupPrimitive.Root ref={ref} {...props} {...radixSlotProps}>
        <GlassPanel
          variant="pill"
          preset="control"
          refraction="none"
          className={clsx('lg-segmented', className)}
        >
          <span ref={indicatorRef} aria-hidden className="lg-segmented-indicator" />
          {children}
        </GlassPanel>
      </RadioGroupPrimitive.Root>
    );
  },
);

GlassSegmentedControl.displayName = 'GlassSegmentedControl';

export const GlassSegmentedControlItem = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, forwardedRef) => (
  <RadioGroupPrimitive.Item
    ref={forwardedRef}
    className={clsx('lg-segmented-item', className)}
    {...props}
  />
));

GlassSegmentedControlItem.displayName = 'GlassSegmentedControlItem';
