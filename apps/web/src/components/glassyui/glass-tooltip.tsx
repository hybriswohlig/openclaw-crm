'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import clsx from 'clsx';
import { GlassPanel } from './glass-panel';

const radixSlotProps = { asChild: true };

export const GlassTooltipProvider = TooltipPrimitive.Provider;

export const GlassTooltip = TooltipPrimitive.Root;

export const GlassTooltipTrigger = TooltipPrimitive.Trigger;

export function GlassTooltipContent(
  props: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
) {
  const { className, sideOffset = 6, ...rest } = props;

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content sideOffset={sideOffset} {...rest} {...radixSlotProps}>
        <GlassPanel
          variant="card"
          elevation="raised"
          refraction="none"
          className={clsx('lg-tooltip-content', className)}
        >
          {props.children}
        </GlassPanel>
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
