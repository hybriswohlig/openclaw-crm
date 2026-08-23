"use client";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-4 py-8 text-center", className)}>
      {icon && <span style={{ color: "var(--muted-foreground)" }}>{icon}</span>}
      <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
        {title}
      </p>
      {hint && (
        <p className="max-w-[38ch] text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
          {hint}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Mirrors Skeleton() from statistics/page.tsx:1786. */
export function LoadingLine({ label = "Lade…" }: { label?: string }) {
  return (
    <div className="px-1 py-6 text-center text-[13px]" style={{ color: "var(--muted-foreground)" }}>
      {label}
    </div>
  );
}

/** Mirrors ErrorMsg() from statistics/page.tsx:1796, but on the danger token. */
export function ErrorLine({
  label = "Daten konnten nicht geladen werden.",
  onRetry,
}: {
  label?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-1 py-6 text-center text-[13px]" style={{ color: "var(--danger)" }}>
      <span>{label}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-border px-3 py-1 text-[12px] text-foreground hover:bg-muted"
        >
          Erneut versuchen
        </button>
      )}
    </div>
  );
}
