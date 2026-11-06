import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxSeite } from "@/components/neu/inbox/inbox-seite";
import { seitentitel } from "@/components/neu/nav-config";

export const metadata: Metadata = { title: seitentitel("/app/inbox") };

/** Die Inbox der neuen Oberfläche (Plan 6): Liste, Gespräch, Deal-Kurzfassung. Auswahl in `?e=`. */
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxSeite />
    </Suspense>
  );
}
