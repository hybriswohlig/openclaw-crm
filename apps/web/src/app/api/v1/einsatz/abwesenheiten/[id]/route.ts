import { type NextRequest } from "next/server";
import { notFound, success } from "@/lib/api-utils";
import { einsatzVorlauf } from "@/lib/einsatz-route";
import { abwesenheitLoeschen } from "@/services/einsatz-personen";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const { id } = await params;
  if (!(await abwesenheitLoeschen(vor.ctx.workspaceId, id))) return notFound();
  return success({ id });
}
