"use client";

import { useEffect } from "react";
import { Download, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentPreviewModalProps {
  /** URL that serves the file inline (Content-Disposition: inline). */
  url: string;
  fileName: string;
  mimeType: string;
  /** Optional URL that serves the file as attachment (download). */
  downloadUrl?: string;
  onClose: () => void;
}

export function DocumentPreviewModal({
  url,
  fileName,
  mimeType,
  downloadUrl,
  onClose,
}: DocumentPreviewModalProps) {
  // Close on Esc
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  const isPreviewable = isImage || isPdf;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className={cn(
          "relative bg-background rounded-lg shadow-2xl overflow-hidden",
          "w-full max-w-5xl h-full max-h-[95vh] sm:max-h-[90vh] flex flex-col"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0">
          <p className="flex-1 text-sm font-medium truncate" title={fileName}>
            {fileName}
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="In neuem Tab öffnen"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Neuer Tab</span>
          </a>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={fileName}
              className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Herunterladen"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 bg-muted/20 overflow-auto">
          {isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={fileName}
              className="w-full h-full object-contain bg-black/10"
            />
          )}
          {isPdf && (
            <iframe
              src={url}
              title={fileName}
              className="w-full h-full border-0"
            />
          )}
          {!isPreviewable && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground p-6 text-center">
              <p>Vorschau für diesen Dateityp nicht verfügbar.</p>
              <p className="text-xs">({mimeType})</p>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download={fileName}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Herunterladen
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
