import { MessageCircle } from "lucide-react";

/**
 * Shared WhatsApp contact affordance for the customer portal. Customers
 * arrive from a WhatsApp thread, so wa.me is the natural escape hatch out
 * of every dead end (no matching date, on-request package, revoked link).
 *
 * Renders nothing when the firma has no WhatsApp number configured;
 * callers can pass `fallback` to keep a plain-text hint in that case.
 */
export function WhatsAppContactLink({
  phoneE164,
  label = "Per WhatsApp schreiben",
  message,
  className,
  fallback = null,
}: {
  phoneE164: string | null | undefined;
  label?: string;
  /** Prefilled message, plain text (encoded internally). */
  message?: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  if (!phoneE164) return <>{fallback}</>;
  const phone = phoneE164.replace(/^\+/, "").replace(/\s/g, "");
  const href = `https://wa.me/${phone}${
    message ? `?text=${encodeURIComponent(message)}` : ""
  }`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
      }
    >
      <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </a>
  );
}
