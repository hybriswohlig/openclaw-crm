"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, FileText, Download, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DealAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  conversationId: string;
  messageId: string;
}

function formatFileSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MediaTab({ recordId }: { recordId: string }) {
  const [items, setItems] = useState<DealAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<DealAttachment | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/attachments`);
      if (!res.ok) {
        setItems([]);
        return;
      }
      const json = (await res.json()) as { data?: DealAttachment[] };
      setItems(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    load();
  }, [load]);

  // Split into images and everything else so images render as a gallery
  // and non-images (PDFs, docs, voice notes, ...) render as a list.
  const images = items.filter((a) => a.mimeType.startsWith("image/"));
  const files = items.filter((a) => !a.mimeType.startsWith("image/"));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ImageIcon className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm font-medium">Noch keine Medien</p>
        <p className="text-xs text-muted-foreground mt-1">
          Bilder und Dateien, die der Kunde per E-Mail oder WhatsApp sendet,
          erscheinen hier automatisch.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      {images.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm">Bilder</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {images.length}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setLightbox(img)}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted hover:border-primary/50 transition-colors"
                title={`${img.fileName} · ${formatFileSize(img.fileSize)}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/v1/inbox/attachments/${img.id}/content`}
                  alt={img.fileName}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-[10px] text-white truncate">
                    {formatDate(img.createdAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {files.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm">Dateien</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {files.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {files.map((f) => (
              <a
                key={f.id}
                href={`/api/v1/inbox/attachments/${f.id}/content`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 hover:border-primary/50 transition-colors"
              >
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{f.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(f.fileSize)} · {formatDate(f.createdAt)}
                  </p>
                </div>
                <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        </section>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-h-full max-w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/v1/inbox/attachments/${lightbox.id}/content`}
              alt={lightbox.fileName}
              className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
            />
            <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/80 to-transparent rounded-b-lg flex items-center gap-3">
              <div className="flex-1 min-w-0 text-white">
                <p className="text-sm font-medium truncate">{lightbox.fileName}</p>
                <p className="text-xs text-white/70">
                  {formatFileSize(lightbox.fileSize)} · {formatDate(lightbox.createdAt)}
                </p>
              </div>
              <a
                href={`/api/v1/inbox/attachments/${lightbox.id}/content`}
                download={lightbox.fileName}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
                  "bg-white/15 hover:bg-white/25 text-white transition-colors"
                )}
              >
                <Download className="h-3.5 w-3.5" />
                Herunterladen
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
