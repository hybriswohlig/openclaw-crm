'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import clsx from 'clsx';
import { useRef } from 'react';
import { useLiquidIndicator } from './lib/liquid-motion';
import { GlassPanel } from './glass-panel';

const radixSlotProps = { asChild: true };

export const GlassTabs = TabsPrimitive.Root;

const INDICATOR = { selected: '[role="tab"][data-state="active"]', item: '[role="tab"]' };

export function GlassTabsContent(
  props: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>,
) {
  const { className, children, ...rest } = props;

  return (
    <TabsPrimitive.Content {...rest} {...radixSlotProps}>
      <GlassPanel
        variant="card"
        elevation="base"
        preset="subtle"
        refraction="none"
        className={clsx('lg-tabs-content', className)}
      >
        {children}
      </GlassPanel>
    </TabsPrimitive.Content>
  );
}

// The active trigger draws its own bubble until scripts run; then one shared
// bubble moves between triggers like a drop of glass.
export function GlassTabsList(props: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  const { className, children, ...rest } = props;
  const listRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);

  useLiquidIndicator(listRef, indicatorRef, INDICATOR);

  return (
    <TabsPrimitive.List {...rest} ref={listRef} {...radixSlotProps}>
      <GlassPanel
        variant="pill"
        elevation="base"
        preset="control"
        refraction="none"
        className={clsx('lg-tabs-list', className)}
      >
        <span ref={indicatorRef} aria-hidden className="lg-tabs-indicator" />
        {children}
      </GlassPanel>
    </TabsPrimitive.List>
  );
}

export function GlassTabsTrigger(
  props: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>,
) {
  const { className, ...rest } = props;

  return <TabsPrimitive.Trigger {...rest} className={clsx('lg-tabs-trigger', className)} />;
}
