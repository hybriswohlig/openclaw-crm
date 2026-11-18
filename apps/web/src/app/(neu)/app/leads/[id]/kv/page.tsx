import type { Metadata } from "next";
import { KvEditorSeite } from "@/components/neu/kv-editor/kv-editor-seite";

export const metadata: Metadata = { title: "KV" };

/**
 * KV-Editor eines Deals (Spec KV-Editor 10): PDF in der Mitte, Verlauf, KI-Chat, Bearbeiten, Pushen.
 * Aufgabe 6a zeigt Testdaten (`?szenario=…`); 6b nimmt `testdaten` weg und hängt die Routen an.
 */
export default async function KvEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <KvEditorSeite dealId={id} testdaten />;
}
