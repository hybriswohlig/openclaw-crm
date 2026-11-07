import type { Metadata } from "next";
import { LagekarteAnsicht } from "@/components/neu/heute/lagekarte-ansicht";

export const metadata: Metadata = { title: "Lagekarte" };

/** Lagekarte als Ansicht unter Heute (Plan 10, Entscheidung 12). `/home` bleibt für die alte Oberfläche. */
export default function HeuteKartePage() {
  return <LagekarteAnsicht />;
}
