import type { Metadata } from "next";
import { seitentitel } from "@/components/neu/nav-config";
import { Platzhalter } from "@/components/neu/platzhalter";

export const metadata: Metadata = { title: seitentitel("/app/inbox") };

export default function InboxPage() {
  return <Platzhalter pfad="/app/inbox" meilenstein={1} alteSeite="/inbox" />;
}
