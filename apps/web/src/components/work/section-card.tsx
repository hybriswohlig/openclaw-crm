"use client";

// Card with a serif heading and an optional right-hand action — the
// "Alle →" pattern from home/page.tsx:810-825 (literal arrow, text-xs,
// accent colour).
import Link from "next/link";
import { cn } from "@/lib/utils";

export function SectionCard({
  title,
  subtitle,
  action,
  actionHref,
  actionLabel,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  subtitle?: string | null;
  action?: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("k-card flex flex-col p-5", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="k-display m-0 truncate" style={{ fontSize: 18, fontWeight: 500 }}>
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted-foreground)" }}>
              {subtitle}
            </p>
          )}
        </div>
        <div className="shrink-0">
          {action}
          {!action && actionHref && (
            <Link href={actionHref} className="text-xs" style={{ color: "var(--kottke-accent)" }}>
              {actionLabel ?? "Alle"} →
            </Link>
          )}
        </div>
      </div>
      <div className={cn("min-w-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
