"use client";

// The one progress bar of the module. Geometry copied from
// home/page.tsx:620-648 (6 px tall, radius 3); the track uses --muted
// instead of an --ink tint so it stays visible in dark mode (R1).
import type { Tone } from "@/lib/work-ui";
import { cn } from "@/lib/utils";

const TONE_VAR: Record<Tone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  info: "var(--info)",
  accent: "var(--kottke-accent)",
  neutral: "var(--muted-foreground)",
};

export function ProgressBar({
  value,
  tone = "accent",
  height = 6,
  label,
  showValue = false,
  className,
}: {
  value: number;
  tone?: Tone;
  height?: number;
  label?: string;
  showValue?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        className="flex-1 overflow-hidden"
        style={{ height, borderRadius: height / 2, background: "var(--muted)" }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Fortschritt"}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: TONE_VAR[tone],
            borderRadius: height / 2,
            transition: "width .3s",
          }}
        />
      </div>
      {showValue && (
        <span className="k-mono shrink-0 text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
          {pct} %
        </span>
      )}
    </div>
  );
}
