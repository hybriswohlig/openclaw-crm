"use client";

import { useState } from "react";
import { Camera, ChevronDown } from "lucide-react";
import type { AttachmentRef } from "@openclaw-crm/customer-portal-core";
import { LiveMediaFeed } from "./live-media-feed";

/**
 * Collapsible card with the curated customer photos (the pictures the
 * customer sent in via WhatsApp, hand-picked by the operator). Collapsed by
 * default so the gallery never dominates the offer page; the image bytes are
 * only requested once the customer opens the section because LiveMediaFeed
 * is mounted lazily.
 */
export function CustomerPhotosSection({
  token,
  photos,
  primaryColor,
}: {
  token: string;
  photos: AttachmentRef[];
  primaryColor: string;
}) {
  const [open, setOpen] = useState(false);

  if (photos.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-3 px-5 py-3 text-left"
      >
        <Camera
          className="h-4 w-4 shrink-0"
          style={{ color: `#${primaryColor}` }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            Ihre Fotos ({photos.length})
          </span>
          <span className="block text-xs text-muted-foreground">
            Die Fotos, die Sie uns geschickt haben
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="border-t px-5 py-4">
          <LiveMediaFeed
            token={token}
            attachments={photos}
            primaryColor={primaryColor}
            title="Ihre Fotos"
          />
        </div>
      )}
    </section>
  );
}
