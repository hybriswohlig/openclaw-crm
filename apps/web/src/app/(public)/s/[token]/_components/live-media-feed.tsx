"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageIcon, FileText, X } from "lucide-react";
import type { AttachmentRef } from "@openclaw-crm/customer-portal-core";

/**
 * Stage 3 chronological media feed. Images render as a grid with their
 * captions; non-image attachments (PDFs, voice notes, etc.) render as a
 * simple list. Tapping an image opens it in a lightbox.
 *
 * The image bytes are streamed via /api/public/[token]/attachments/[id]
 * which validates that the attachment belongs to the token's deal before
 * returning bytes — no enumerable URLs.
 */
export function LiveMediaFeed({
  token,
  attachments,
  primaryColor,
  title = "Bilder & Updates",
  emptyText = "Noch keine Bilder von der Crew. Sobald euer Team Fotos sendet, erscheinen sie hier automatisch.",
}: {
  token: string;
  attachments: AttachmentRef[];
  primaryColor: string;
  title?: string;
  emptyText?: string;
}) {
  const [lightbox, setLightbox] = useState<AttachmentRef | null>(null);

  const images = attachments.filter((a) => a.isImage);
  const others = attachments.filter((a) => !a.isImage);

  if (attachments.length === 0) {
    return (
      <section className="rounded-2xl border border-border/50 bg-card p-5 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <ImageIcon className="h-4 w-4" />
          {emptyText}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
          style={{ background: `#${primaryColor}` }}
        >
          {attachments.length}
        </span>
      </div>

      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((a) => (
            <li key={a.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setLightbox(a)}
                className="group relative aspect-square overflow-hidden rounded-xl border border-border/50 bg-muted"
              >
                <Image
                  src={`/api/public/${token}/attachments/${a.id}`}
                  alt={a.caption || a.fileName}
                  fill
                  sizes="(max-width: 640px) 50vw, 33vw"
                  quality={60}
                  className="object-cover transition-transform group-hover:scale-105"
                />
              </button>
              <div className="text-[10px] text-muted-foreground">
                {formatTime(a.sentAt)}
              </div>
              {a.caption && (
                <p className="line-clamp-2 text-xs leading-relaxed">{a.caption}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 && (
        <ul className="space-y-2">
          {others.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-xl border border-border/50 bg-card p-3"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <a
                  href={`/api/public/${token}/attachments/${a.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm hover:underline"
                >
                  {a.fileName}
                </a>
                <div className="text-[11px] text-muted-foreground">
                  {formatTime(a.sentAt)}
                  {a.caption ? ` · ${a.caption}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white"
            onClick={() => setLightbox(null)}
            aria-label="Schließen"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="flex max-h-full max-w-full flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/public/${token}/attachments/${lightbox.id}`}
              alt={lightbox.caption || lightbox.fileName}
              className="max-h-[80vh] max-w-full rounded-lg object-contain"
            />
            {lightbox.caption && (
              <p className="text-center text-sm text-white">{lightbox.caption}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
