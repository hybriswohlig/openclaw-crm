'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { useRef } from 'react';
import { GlassPanel } from './glass-panel';

const radixSlotProps = { asChild: true };

export const GlassSheet = DialogPrimitive.Root;

export const GlassSheetTrigger = DialogPrimitive.Trigger;

export const GlassSheetClose = DialogPrimitive.Close;

export const GlassSheetTitle = DialogPrimitive.Title;

export const GlassSheetDescription = DialogPrimitive.Description;

export type GlassSheetSide = 'top' | 'right' | 'bottom' | 'left';

export type GlassSheetContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  closeLabel?: string;
  side?: GlassSheetSide;
  /** How thick the glass is, as a multiple of regular. See GlassSurface. */
  thickness?: number;
};

type SheetDrag = {
  lastTime: number;
  lastY: number;
  offset: number;
  pointerId: number;
  startY: number;
  velocity: number;
};

// A downward fling faster than this, in pixels per millisecond, dismisses the sheet.
const FLING_VELOCITY = 0.5;

export function GlassSheetContent({
  children,
  className,
  closeLabel = 'Close sheet',
  side = 'bottom',
  ...props
}: GlassSheetContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<SheetDrag | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      lastTime: event.timeStamp,
      lastY: event.clientY,
      offset: 0,
      pointerId: event.pointerId,
      startY: event.clientY,
      velocity: 0,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const content = contentRef.current;

    if (!drag || !content || drag.pointerId !== event.pointerId) return;

    const distance = event.clientY - drag.startY;
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);

    // Upward drags meet growing resistance instead of lifting the sheet off its edge.
    drag.offset = distance >= 0 ? distance : -Math.sqrt(-distance) * 2;
    drag.velocity = (event.clientY - drag.lastY) / elapsed;
    drag.lastTime = event.timeStamp;
    drag.lastY = event.clientY;
    content.style.transform = `translate3d(0, ${drag.offset}px, 0)`;
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const content = contentRef.current;

    if (!drag || !content || drag.pointerId !== event.pointerId) return;

    dragRef.current = null;

    const threshold = Math.min(120, content.offsetHeight * 0.25);

    if (drag.offset > threshold || drag.velocity > FLING_VELOCITY) {
      // The exit animation continues from where the finger let go.
      closeRef.current?.click();

      return;
    }

    content.style.transform = '';
    content.animate(
      [{ transform: `translate3d(0, ${drag.offset}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
      { duration: 420, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    );
  };

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="lg-dialog-overlay" />
      <DialogPrimitive.Content {...props} {...radixSlotProps}>
        <GlassPanel
          ref={contentRef}
          data-side={side}
          elevation="raised"
          lens
          preset="prominent"
          refraction="none"
          variant="panel"
          className={clsx('lg-sheet-content', className)}
        >
          {side === 'bottom' ? (
            <div
              aria-hidden
              className="lg-sheet-handle"
              onLostPointerCapture={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
            />
          ) : null}
          {children}
          <DialogPrimitive.Close
            ref={closeRef}
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
    </DialogPrimitive.Portal>
  );
}
