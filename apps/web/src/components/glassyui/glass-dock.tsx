'use client';

import { Slot, Slottable } from '@radix-ui/react-slot';
import clsx from 'clsx';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, MouseEvent } from 'react';
import { GlassSurface } from './glass-surface';

export type GlassDockProps = HTMLAttributes<HTMLDivElement>;

/**
 * A row of app icons on a glass shelf. Hovering or focusing an icon shows its label; icons
 * keep their size wherever the pointer is.
 */
export const GlassDock = forwardRef<HTMLDivElement, GlassDockProps>(
  ({ children, className, ...props }, forwardedRef) => (
    <div ref={forwardedRef} className={clsx('lg-dock', className)} {...props}>
      <GlassSurface aria-hidden className="lg-dock-shelf" lens={false} preset="standard" />
      {children}
    </div>
  ),
);

GlassDock.displayName = 'GlassDock';

export type GlassDockItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Shows the running indicator under the icon. */
  active?: boolean;
  /** Renders the single child element, such as a link, as the item. */
  asChild?: boolean;
  /** Accessible name and hover label. */
  label: string;
};

export const GlassDockItem = forwardRef<HTMLButtonElement, GlassDockItemProps>(
  (
    { active = false, asChild = false, children, className, label, onMouseDown, type, ...props },
    forwardedRef,
  ) => {
    const Component = asChild ? Slot : 'button';

    return (
      <Component
        ref={forwardedRef}
        aria-label={label}
        className={clsx('lg-dock-item', className)}
        data-active={active}
        // A click or tap opens the item without taking keyboard focus, so a
        // later key press never rings it. Tab still reaches every item.
        onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
          onMouseDown?.(event);

          if (event.button === 0 && !event.defaultPrevented) event.preventDefault();
        }}
        type={asChild ? type : (type ?? 'button')}
        {...props}
      >
        <Slottable>{children}</Slottable>
        <span aria-hidden className="lg-dock-label">
          {label}
        </span>
        <span aria-hidden className="lg-dock-dot" />
      </Component>
    );
  },
);

GlassDockItem.displayName = 'GlassDockItem';

export const GlassDockSeparator = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, forwardedRef) => (
    <div
      ref={forwardedRef}
      aria-orientation="vertical"
      className={clsx('lg-dock-separator', className)}
      role="separator"
      {...props}
    />
  ),
);

GlassDockSeparator.displayName = 'GlassDockSeparator';
