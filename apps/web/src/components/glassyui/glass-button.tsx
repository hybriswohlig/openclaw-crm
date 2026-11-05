'use client';

import { Slot, Slottable } from '@radix-ui/react-slot';
import clsx from 'clsx';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { mergeRefs } from './lib/merge-refs';
import { useGlassScenePane } from './lib/scene-context';
import { useLensFilter } from './lib/use-refraction-filter';
import { useOptionalPreferences } from './glass-provider';

export type ButtonVariant = 'primary' | 'prominent' | 'ghost' | 'soft';

export type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonPreset = 'control' | 'showcase';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Renders the single child element, such as a link, with the button's material. Links cannot be disabled. */
  asChild?: boolean;
  /** Chromium edge lens over the frost. On by default for filled variants. */
  lens?: boolean;
  preset?: ButtonPreset;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'lg-button--primary',
  prominent: 'lg-button--prominent',
  ghost: 'lg-button--ghost',
  soft: 'lg-button--soft',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'lg-button--sm',
  md: 'lg-button--md',
  lg: 'lg-button--lg',
};

const REACT_LAZY = Symbol.for('react.lazy');

// A server component's element can reach a client component as a lazy reference, which React 19
// does in development; its payload is the chunk the element arrives in, a kind of Promise. Slot
// unwraps one before slotting it, so the label has to as well.
function isLazyNode(node: unknown): node is { _payload: Promise<ReactNode> } {
  return (
    node instanceof Object &&
    '$$typeof' in node &&
    node.$$typeof === REACT_LAZY &&
    '_payload' in node &&
    node._payload instanceof Promise
  );
}

// The label sits above the material layers, so a slotted child's content moves into it.
function withLabel(children: ReactNode) {
  if (!isValidElement<{ children?: ReactNode }>(children)) return children;

  return cloneElement(
    children,
    undefined,
    <span className="lg-button__label">{children.props.children}</span>,
  );
}

export const GlassButton = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      className,
      preset = 'control',
      variant = 'primary',
      lens = variant !== 'ghost',
      size = 'md',
      type,
      disabled = false,
      onPointerLeave,
      onPointerCancel,
      onPointerDown,
      onPointerUp,
      onBlur,
      onKeyDown,
      onKeyUp,
      style,
      children,
      ...rest
    },
    forwardedRef,
  ) => {
    const { preferences } = useOptionalPreferences();
    const reduceMotion = Boolean(preferences?.reduceMotion);
    const reduceTransparency = Boolean(preferences?.reduceTransparency);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const bloomRef = useRef<HTMLSpanElement | null>(null);
    const ref = useMemo(() => mergeRefs(forwardedRef, buttonRef), [forwardedRef]);

    const releasePress = useCallback((target: HTMLButtonElement) => {
      target.style.setProperty('--lg-press', '0');
      target.dataset.pressed = 'false';
    }, []);

    // A press lights the glass from the point it lands and the light spreads
    // outward, as it does through Apple's glass under a fingertip.
    const bloom = useCallback(
      (target: HTMLElement, x: number, y: number) => {
        const element = bloomRef.current;

        if (!element || reduceMotion) return;

        element.style.setProperty('--lg-bloom-x', `${x}px`);
        element.style.setProperty('--lg-bloom-y', `${y}px`);
        element.style.setProperty(
          '--lg-bloom-size',
          `${Math.max(target.offsetWidth, target.offsetHeight) * 2.4}px`,
        );
        element.animate?.(
          [
            { opacity: 0, transform: 'scale(0.08)' },
            { opacity: 1, transform: 'scale(0.42)', offset: 0.16 },
            { opacity: 0, transform: 'scale(1)' },
          ],
          { duration: 720, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' },
        );
      },
      [reduceMotion],
    );

    const handlePointerLeave = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerLeave?.(event);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        releasePress(event.currentTarget);
      },
      [onPointerLeave, releasePress],
    );

    const handlePointerCancel = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerCancel?.(event);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        releasePress(event.currentTarget);
      },
      [onPointerCancel, releasePress],
    );

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerDown?.(event);

        if (event.defaultPrevented || disabled) return;
        const target = event.currentTarget;
        const bounds = target.getBoundingClientRect();
        // A scaled button maps client pixels back to its own, so the bloom starts under the finger.
        const scale = bounds.width / Math.max(target.offsetWidth, 1) || 1;

        target.setPointerCapture?.(event.pointerId);
        target.style.setProperty('--lg-press', '1');
        target.dataset.pressed = 'true';
        bloom(target, (event.clientX - bounds.left) / scale, (event.clientY - bounds.top) / scale);
      },
      [bloom, disabled, onPointerDown],
    );

    const handlePointerUp = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerUp?.(event);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        event.currentTarget.style.setProperty('--lg-press', '0');
        event.currentTarget.dataset.pressed = 'false';
      },
      [onPointerUp],
    );

    const handleBlur = useCallback(
      (event: React.FocusEvent<HTMLButtonElement>) => {
        onBlur?.(event);
        releasePress(event.currentTarget);
      },
      [onBlur, releasePress],
    );

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(event);

        if (event.defaultPrevented || disabled) return;

        if (event.key === ' ' || event.key === 'Enter') {
          const target = event.currentTarget;

          target.style.setProperty('--lg-press', '1');
          target.dataset.pressed = 'true';

          if (!event.repeat) bloom(target, target.offsetWidth / 2, target.offsetHeight / 2);
        }
      },
      [bloom, disabled, onKeyDown],
    );

    const handleKeyUp = useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyUp?.(event);

        if (event.key === ' ' || event.key === 'Enter') {
          event.currentTarget.style.setProperty('--lg-press', '0');
          event.currentTarget.dataset.pressed = 'false';
        }
      },
      [onKeyUp],
    );

    // A button disabled mid-press lets go of it.
    useEffect(() => {
      if (disabled && buttonRef.current) releasePress(buttonRef.current);
    }, [disabled, releasePress]);

    // Inside a GlassScene the canvas draws this glass. Ghost buttons have none.
    useGlassScenePane(buttonRef, variant !== 'ghost');

    const lensFilter = useLensFilter(buttonRef, {
      enabled: lens && !disabled && !reduceTransparency,
      signature: `${preferences?.theme}:${preferences?.mode}:${preferences?.quality}:${preferences?.thickness}`,
    });

    // Without this, the client renders a lazy child's content outside the label: it sinks under
    // the material layers, and hydration fails.
    const slotted = asChild && isLazyNode(children) ? use(children._payload) : children;

    const Component = asChild ? Slot : 'button';

    return (
      <Component
        {...rest}
        ref={ref}
        type={asChild ? type : (type ?? 'button')}
        disabled={asChild ? undefined : disabled}
        className={clsx('lg-button', VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
        data-lg-lens={lensFilter.active ? 'active' : undefined}
        data-lg-preset={preset}
        style={
          // SAFETY: CSSProperties has no custom-property index; this adds one string-valued property.
          lensFilter.filterStyle
            ? ({ ...style, '--lg-lens-filter': lensFilter.filterStyle } as CSSProperties)
            : style
        }
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        data-pressed="false"
      >
        <span className="lg-button__layers" aria-hidden="true">
          {lensFilter.filterElement}
          <span className="lg-button__light" />
          <span className="lg-button__distortion" />
          <span className="lg-button__tint" />
          <span className="lg-button__shine" />
          <span ref={bloomRef} className="lg-button__bloom" />
          <span className="lg-button__rim" />
        </span>
        {asChild ? (
          <Slottable>{withLabel(slotted)}</Slottable>
        ) : (
          <span className="lg-button__label">{children}</span>
        )}
      </Component>
    );
  },
);

GlassButton.displayName = 'GlassButton';
