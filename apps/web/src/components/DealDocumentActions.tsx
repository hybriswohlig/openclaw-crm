// apps/web/src/components/DealDocumentActions.tsx
//
// Drop into the deal-detail page. Renders two buttons that open the
// GenerateDocumentDialog in AB- or RE-mode.
"use client";

import { useState } from "react";
import {
  GenerateDocumentDialog,
  type DealData,
  type DocumentType,
} from "./GenerateDocumentDialog";

interface Props {
  deal: DealData;
}

export function DealDocumentActions({ deal }: Props) {
  const [openType, setOpenType] = useState<DocumentType | null>(null);

  return (
    <div className="flex gap-2">
      <button
        onClick={() => setOpenType("AB")}
        className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800"
      >
        Auftragsbestätigung erstellen
      </button>
      <button
        onClick={() => setOpenType("RE")}
        className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800"
      >
        Rechnung erstellen
      </button>

      {openType && (
        <GenerateDocumentDialog
          open
          documentType={openType}
          deal={deal}
          onClose={() => setOpenType(null)}
        />
      )}
    </div>
  );
}
