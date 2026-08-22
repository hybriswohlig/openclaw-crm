// Project attachments, base64 in Postgres, 10 MB cap — exactly the
// deal_documents pattern (spec §4.7 / §10.3, accepted risk R1). The list
// query never selects file_content.

import { db } from "@/db";
import { projectDocuments, projects } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { recordProjectEvent } from "./activity-events";

export interface ProjectDocumentMeta {
  id: string;
  projectId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string | null;
  uploadedAt: Date;
}

export const MAX_PROJECT_DOCUMENT_SIZE = 10 * 1024 * 1024;

/** Pure: upload guard, with the HTTP status the route should answer. */
export function validateProjectDocumentUpload(input: {
  fileName: string;
  mimeType: string;
  fileSize: number;
}): { ok: true } | { ok: false; status: 400 | 413; error: string } {
  if (!input.fileName.trim()) return { ok: false, status: 400, error: "Dateiname fehlt." };
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, status: 400, error: "Die Datei ist leer." };
  }
  if (input.fileSize > MAX_PROJECT_DOCUMENT_SIZE) {
    return { ok: false, status: 413, error: "Datei ist zu groß (max. 10 MB)." };
  }
  return { ok: true };
}

const META_COLUMNS = {
  id: projectDocuments.id,
  projectId: projectDocuments.projectId,
  fileName: projectDocuments.fileName,
  fileSize: projectDocuments.fileSize,
  mimeType: projectDocuments.mimeType,
  uploadedBy: projectDocuments.uploadedBy,
  uploadedAt: projectDocuments.uploadedAt,
};

export async function listProjectDocuments(
  workspaceId: string,
  projectId: string,
): Promise<ProjectDocumentMeta[]> {
  return db
    .select(META_COLUMNS)
    .from(projectDocuments)
    .where(
      and(
        eq(projectDocuments.workspaceId, workspaceId),
        eq(projectDocuments.projectId, projectId),
      ),
    )
    .orderBy(asc(projectDocuments.uploadedAt));
}

export async function getProjectDocument(
  workspaceId: string,
  documentId: string,
): Promise<(ProjectDocumentMeta & { fileContent: string }) | null> {
  const [row] = await db
    .select({ ...META_COLUMNS, fileContent: projectDocuments.fileContent })
    .from(projectDocuments)
    .where(
      and(eq(projectDocuments.id, documentId), eq(projectDocuments.workspaceId, workspaceId)),
    )
    .limit(1);
  return row ?? null;
}

export async function createProjectDocument(
  workspaceId: string,
  projectId: string,
  uploadedBy: string,
  input: { fileName: string; mimeType: string; fileSize: number; fileContent: string },
): Promise<ProjectDocumentMeta | null> {
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!project) return null;

  const check = validateProjectDocumentUpload(input);
  if (!check.ok) throw new Error(check.error);

  const [row] = await db
    .insert(projectDocuments)
    .values({
      workspaceId,
      projectId,
      uploadedBy,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType || "application/octet-stream",
      fileContent: input.fileContent,
    })
    .returning(META_COLUMNS);

  // Not a §10.2 notification trigger → activity row only.
  await recordProjectEvent({
    workspaceId,
    projectId,
    projectName: project.name,
    eventType: "project.document_uploaded",
    actorId: uploadedBy,
    title: "Dokument hochgeladen",
    body: `${project.name}: ${row.fileName}`,
    payload: { documentId: row.id, fileName: row.fileName },
  });
  return row;
}

export async function deleteProjectDocument(
  workspaceId: string,
  documentId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(projectDocuments)
    .where(
      and(eq(projectDocuments.id, documentId), eq(projectDocuments.workspaceId, workspaceId)),
    )
    .returning({ id: projectDocuments.id });
  return deleted.length > 0;
}
