'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import clsx from 'clsx';
import { forwardRef } from 'react';
import { GlassPanel } from './glass-panel';

const radixSlotProps = { asChild: true };

export const GlassSelect = SelectPrimitive.Root;

export const GlassSelectGroup = SelectPrimitive.Group;

export const GlassSelectValue = SelectPrimitive.Value;

const CHEVRON = 'M5 7.5l5 5 5-5';

const CHECK = 'M4.5 10.5l3.5 3.5 7.5-8';

function Icon({ path }: { path: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type GlassSelectTriggerProps = React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Trigger
>;

/** The closed select: a recessed glass field that shows the chosen option. */
export const GlassSelectTrigger = forwardRef<HTMLButtonElement, GlassSelectTriggerProps>(
  ({ children, className, ...props }, forwardedRef) => (
    <SelectPrimitive.Trigger
      {...props}
      ref={forwardedRef}
      className={clsx('lg-input lg-select-trigger', className)}
    >
      {children}
      <SelectPrimitive.Icon {...radixSlotProps}>
        <span className="lg-select-chevron">
          <Icon path={CHEVRON} />
        </span>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  ),
);

GlassSelectTrigger.displayName = 'GlassSelectTrigger';

export type GlassSelectContentProps = React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Content
>;

/** The open list: a slab of glass under the trigger, as wide as the trigger. */
export const GlassSelectContent = forwardRef<HTMLDivElement, GlassSelectContentProps>(
  (
    { children, className, onPointerDownOutside, position = 'popper', sideOffset = 8, ...props },
    forwardedRef,
  ) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        {...props}
        ref={forwardedRef}
        position={position}
        sideOffset={sideOffset}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event);
          // The page is inert while the list is open, so a press outside only closes it. Left to
          // the browser, the press would also select the nearest word on the page, as Chromium
          // does on the second press of a double click on the trigger.
          event.detail.originalEvent.preventDefault();
        }}
        {...radixSlotProps}
      >
        <GlassPanel
          elevation="raised"
          lens
          preset="prominent"
          refraction="none"
          variant="card"
          className={clsx('lg-select-content', className)}
        >
          <SelectPrimitive.ScrollUpButton className="lg-select-scroll">
            <Icon path="M5 12.5l5-5 5 5" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="lg-select-viewport">
            {children}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="lg-select-scroll">
            <Icon path={CHEVRON} />
          </SelectPrimitive.ScrollDownButton>
        </GlassPanel>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  ),
);

GlassSelectContent.displayName = 'GlassSelectContent';

export type GlassSelectItemProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>;

export const GlassSelectItem = forwardRef<HTMLDivElement, GlassSelectItemProps>(
  ({ children, className, ...props }, forwardedRef) => (
    <SelectPrimitive.Item
      {...props}
      ref={forwardedRef}
      className={clsx('lg-menu-item lg-menu-item--inset', className)}
    >
      <SelectPrimitive.ItemIndicator className="lg-menu-indicator">
        <Icon path={CHECK} />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  ),
);

GlassSelectItem.displayName = 'GlassSelectItem';

export const GlassSelectLabel = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, forwardedRef) => (
  <SelectPrimitive.Label
    {...props}
    ref={forwardedRef}
    className={clsx('lg-menu-label', className)}
  />
));

GlassSelectLabel.displayName = 'GlassSelectLabel';

export const GlassSelectSeparator = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, forwardedRef) => (
  <SelectPrimitive.Separator
    {...props}
    ref={forwardedRef}
    className={clsx('lg-menu-separator', className)}
  />
));

GlassSelectSeparator.displayName = 'GlassSelectSeparator';
