"use client";

import { Star, ExternalLink } from "lucide-react";
import { useT } from "./portal-i18n";

/**
 * Big tappable Google-review button. Rendered at Stage 4 only when the
 * operating company has googleReviewUrl configured in settings.
 */
export function GoogleReviewButton({
  url,
  primaryColor,
}: {
  url: string;
  primaryColor: string;
}) {
  const t = useT();
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-card px-5 py-4 transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: `#${primaryColor}` }}
        >
          <Star className="h-5 w-5 text-white" fill="currentColor" />
        </div>
        <div>
          <div className="text-sm font-medium">{t("review.title")}</div>
          <div className="text-xs text-muted-foreground">{t("review.body")}</div>
        </div>
      </div>
      <ExternalLink className="h-4 w-4 text-muted-foreground" />
    </a>
  );
}
