'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { GlassPanel } from './glass-panel';

const radixSlotProps = { asChild: true };

export const GlassDialog = DialogPrimitive.Root;

export const GlassDialogTrigger = DialogPrimitive.Trigger;

export const GlassDialogPortal = DialogPrimitive.Portal;

export function GlassDialogOverlay(
  props: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>,
) {
  const { className, ...rest } = props;

  return <DialogPrimitive.Overlay className={clsx('lg-dialog-overlay', className)} {...rest} />;
}

export type GlassDialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  closeLabel?: string;
  /** How thick the glass is, as a multiple of regular. See GlassSurface. */
  thickness?: number;
};

export function GlassDialogContent({
  className,
  children,
  closeLabel = 'Close dialog',
  ...props
}: GlassDialogContentProps) {
  return (
    <GlassDialogPortal>
      <GlassDialogOverlay />
      <DialogPrimitive.Content {...props} {...radixSlotProps}>
        <GlassPanel
          lens
          preset="prominent"
          refraction="none"
          variant="panel"
          elevation="raised"
          className={clsx('lg-dialog-content', className)}
        >
          {children}
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--lg-border)] bg-[var(--lg-control-surface)] text-[var(--lg-muted-foreground)] hover:bg-[var(--lg-control-surface-hover)] hover:text-[var(--lg-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lg-focus-ring)]"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
              <path
                d="M5 5l10 10m0-10L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </DialogPrimitive.Close>
        </GlassPanel>
      </DialogPrimitive.Content>
    </GlassDialogPortal>
  );
}

export const GlassDialogTitle = DialogPrimitive.Title;

export const GlassDialogDescription = DialogPrimitive.Description;
