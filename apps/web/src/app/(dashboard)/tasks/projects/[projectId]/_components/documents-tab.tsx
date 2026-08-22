"use client";

// Documents tab. Upload is multipart/form-data with a 10 MB cap, mirroring
// api/v1/deals/[recordId]/documents. Preview uses the shared
// DocumentPreviewModal against the single-document GET route, which streams
// the file with Content-Disposition: inline (verified against
// api/v1/projects/[projectId]/documents/[documentId]/route.ts) — no data:
// URL fallback needed.
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { ProjectDocumentJSON, ProjectJSON } from "@/lib/work-types";
import { SectionCard } from "@/components/work/section-card";
import { EmptyState, ErrorLine, LoadingLine } from "@/components/work/empty-state";
import { DocumentPreviewModal } from "@/components/documents/document-preview-modal";
import { formatDateDE, readApiError } from "@/lib/work-ui";

const MAX_SIZE = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// `reload` is accepted but unused: page.tsx (Task 33) passes it to every
// tab uniformly, and a document has no field that feeds the header/KPI
// tiles, so this tab has nothing to report back up.
export function DocumentsTab({ project }: { project: ProjectJSON; reload: () => Promise<void> }) {
  const [docs, setDocs] = useState<ProjectDocumentJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ProjectDocumentJSON | null>(null);
  const [failed, setFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/documents`, { cache: "no-store" });
      if (res.ok) {
        setDocs((((await res.json())?.data ?? []) as ProjectDocumentJSON[]));
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(file: File) {
    if (file.size > MAX_SIZE) {
      toast.error("Datei zu gross", { description: "Maximal 10 MB pro Datei." });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/v1/projects/${project.id}/documents`, {
        method: "POST",
        body: form,
      });
      // The server's reason is the only actionable one — "Datei ist zu groß
      // (max. 10 MB)." beats a generic "Upload fehlgeschlagen" (plan R7.1).
      if (!res.ok) throw new Error(await readApiError(res, "Upload fehlgeschlagen"));
      toast.success("Dokument hochgeladen");
      await load();
    } catch (err) {
      toast.error("Upload fehlgeschlagen", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(doc: ProjectDocumentJSON) {
    if (!window.confirm(`„${doc.fileName}“ wirklich löschen?`)) return;
    const res = await fetch(`/api/v1/projects/${project.id}/documents/${doc.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Löschen fehlgeschlagen", { description: await readApiError(res, "") });
      return;
    }
    toast.success("Dokument gelöscht");
    await load();
  }

  return (
    <>
      <SectionCard
        title="Dokumente"
        subtitle={`${docs.length} Dateien · maximal 10 MB pro Datei`}
        action={
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-50"
            style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
          >
            {uploading ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Upload className="h-[13px] w-[13px]" />}
            Hochladen
          </button>
        }
      >
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) upload(f);
          }}
          className="mb-3 rounded-lg border border-dashed border-border px-4 py-5 text-center"
        >
          <p className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
            Datei hierher ziehen oder auf „Hochladen“ klicken.
          </p>
        </div>

        {loading && docs.length === 0 ? (
          <LoadingLine />
        ) : failed && docs.length === 0 ? (
          <ErrorLine onRetry={load} />
        ) : docs.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="Noch keine Dokumente" />
        ) : (
          <ul className="flex flex-col">
            {docs.map((d, i) => (
              <li
                key={d.id}
                className="flex items-center gap-3 py-2.5"
                style={{ borderTop: i === 0 ? 0 : "1px dashed var(--border)" }}
              >
                <FileText className="h-[16px] w-[16px] shrink-0" style={{ color: "var(--muted-foreground)" }} />
                <button
                  type="button"
                  onClick={() => setPreview(d)}
                  className="min-w-0 flex-1 truncate text-left text-[13px] hover:underline"
                  style={{ color: "var(--foreground)" }}
                >
                  {d.fileName}
                </button>
                <span className="k-mono hidden shrink-0 text-[11px] sm:inline" style={{ color: "var(--muted-foreground)" }}>
                  {formatSize(d.fileSize)} · {formatDateDE(d.uploadedAt)}
                </span>
                <a
                  href={`/api/v1/projects/${project.id}/documents/${d.id}?download=1`}
                  download={d.fileName}
                  className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted"
                  aria-label="Herunterladen"
                >
                  <Download className="h-[13px] w-[13px]" />
                </a>
                <button
                  type="button"
                  onClick={() => remove(d)}
                  aria-label="Dokument löschen"
                  className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-[13px] w-[13px]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {preview && (
        <DocumentPreviewModal
          url={`/api/v1/projects/${project.id}/documents/${preview.id}`}
          downloadUrl={`/api/v1/projects/${project.id}/documents/${preview.id}?download=1`}
          fileName={preview.fileName}
          mimeType={preview.mimeType}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
