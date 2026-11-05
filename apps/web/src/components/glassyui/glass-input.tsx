'use client';

import './styles/liquid.css';

import clsx from 'clsx';
import { forwardRef, useId } from 'react';

export interface GlassInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  (
    { className, id, label, hint, type = 'text', 'aria-describedby': describedBy, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? `lg-input-${generatedId}`;
    const hintId = `${inputId}-hint`;
    const descriptionIds = [describedBy, hint ? hintId : null].filter(Boolean).join(' ');

    return (
      <div className="flex w-full flex-col gap-2 text-sm text-[var(--lg-muted-foreground)]">
        {label ? (
          <label
            htmlFor={inputId}
            className="font-medium text-[var(--lg-muted-foreground)] select-none"
          >
            {label}
          </label>
        ) : null}
        <input
          {...props}
          id={inputId}
          ref={ref}
          type={type}
          aria-describedby={descriptionIds || undefined}
          data-lg-refraction="none"
          className={clsx('lg-input', className)}
        />
        {hint ? (
          <span id={hintId} className="text-xs text-[var(--lg-muted-foreground)]">
            {hint}
          </span>
        ) : null}
      </div>
    );
  },
);

GlassInput.displayName = 'GlassInput';
