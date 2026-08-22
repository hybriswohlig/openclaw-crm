"use client";

import { cn } from "@/lib/utils";

export interface FilterChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: FilterChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-[12.5px] font-medium transition-colors",
              active
                ? "border-transparent bg-foreground text-background"
                : "border-border bg-transparent text-muted-foreground hover:bg-muted"
            )}
          >
            {o.label}
            {o.count != null && (
              <span
                className="k-mono text-[10.5px]"
                style={{ opacity: active ? 0.7 : 0.85 }}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The hand-rolled segmented switch from operations/page.tsx:295-315 —
 * a bordered pill strip, active segment filled with the foreground colour.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("inline-flex rounded-[10px] border border-border bg-card p-[3px]", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className="rounded-[7px] px-3 py-[5px] text-[12.5px] font-medium transition"
            style={{
              background: active ? "var(--foreground)" : "transparent",
              color: active ? "var(--background)" : "var(--muted-foreground)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
