import type { Metadata } from "next";
import { LagekarteAnsicht } from "@/components/neu/heute/lagekarte-ansicht";

export const metadata: Metadata = { title: "Lagekarte" };

/** Lagekarte als Ansicht unter Heute (Plan 10, Entscheidung 12). `/home` ist seit 18.11. gelöscht und leitet immer hierher (Middleware, `geloeschtZiel`). */
export default function HeuteKartePage() {
  return <LagekarteAnsicht />;
}
