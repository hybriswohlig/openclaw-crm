import { upload } from "@vercel/blob/client";

// Client-side helper: upload a captured photo/video directly to the private
// Blob store, then register it as job_media. Returns the new job_media id.

export async function uploadAndRegisterMedia(opts: {
  file: File | Blob;
  fileName: string;
  workspaceId: string;
  dealRecordId: string | null;
  category: string;
  caption?: string;
  onProgress?: (pct: number) => void;
}): Promise<{ id: string }> {
  const safeName = opts.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-64) || "upload";
  const deal = opts.dealRecordId ?? "no-deal";
  const pathname = `ws/${opts.workspaceId}/deals/${deal}/${opts.category}/${safeName}`;
  const contentType = (opts.file as File).type || undefined;

  const result = await upload(pathname, opts.file, {
    access: "private",
    handleUploadUrl: "/api/v1/portal/upload",
    multipart: opts.file.size > 8 * 1024 * 1024, // big files (videos) → multipart
    contentType,
    onUploadProgress: opts.onProgress
      ? (e) => opts.onProgress!(Math.round(e.percentage))
      : undefined,
  });

  const res = await fetch("/api/v1/portal/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pathname: result.pathname,
      url: result.url,
      dealRecordId: opts.dealRecordId,
      category: opts.category,
      caption: opts.caption ?? null,
      capturedAt: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error("Beleg konnte nicht gespeichert werden.");
  const json = await res.json();
  return { id: json.data.id };
}
