"use client";

import { useEffect, useState } from "react";
import { prefetchJson } from "@/lib/use-cached-json";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlleZahlen, Segmented } from "@/components/visibility/alle-zahlen";
import { Ueberblick } from "@/components/visibility/ueberblick";
import { Abschnitte } from "@/components/visibility/abschnitte";
import { GoogleSuche } from "@/components/visibility/google-suche";

const SITES = [
  { value: "", label: "Alle Websites" },
  { value: "kottke", label: "kottke-umzuege.de" },
  { value: "ruempeltuerken", label: "ruempeltuerken.de" },
];

export default function SichtbarkeitPage() {
  const [days, setDays] = useState(30);
  const [site, setSite] = useState("");
  const [tab, setTab] = useState("ueberblick");

  // Andere Reiter im Hintergrund vorladen, damit der Wechsel sofort geht.
  useEffect(() => {
    const q = new URLSearchParams({ days: String(days), ...(site ? { site } : {}) });
    prefetchJson(`/api/v1/visibility/search?days=${days}`);
    prefetchJson(`/api/v1/visibility/overview?${q}`);
    prefetchJson(`/api/v1/visibility/sessions?${q}`);
    prefetchJson(`/api/v1/visibility/sections?${new URLSearchParams({ days: String(days), page: "/", ...(site ? { site } : {}) })}`);
  }, [days, site]);

  return (
    <div className="flex h-full flex-col overflow-auto" style={{ padding: "24px 28px", gap: 18 }}>
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="k-display" style={{ fontSize: 28, letterSpacing: "-0.02em", fontWeight: 500 }}>
            Sichtbarkeit
          </h1>
          <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
            Was die Websites bringen: Befunde, Umsatz pro Kanal und wo Besucher abspringen
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={site} onChange={setSite} options={SITES} />
          <Segmented
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={[
              { value: "7", label: "7 Tage" },
              { value: "30", label: "30 Tage" },
              { value: "90", label: "90 Tage" },
              { value: "365", label: "365 Tage" },
            ]}
          />
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="ueberblick">Überblick</TabsTrigger>
          <TabsTrigger value="suche">Google-Suche</TabsTrigger>
          <TabsTrigger value="abschnitte">Website-Abschnitte</TabsTrigger>
          <TabsTrigger value="zahlen">Analyse</TabsTrigger>
        </TabsList>
        <div className="mt-4 flex-1">
          <TabsContent value="ueberblick">
            <Ueberblick days={days} site={site} onShowSections={() => setTab("abschnitte")} onShowSearch={() => setTab("suche")} />
          </TabsContent>
          <TabsContent value="suche">
            <GoogleSuche days={days} site={site} />
          </TabsContent>
          <TabsContent value="abschnitte">
            <Abschnitte days={days} site={site} />
          </TabsContent>
          <TabsContent value="zahlen">
            <AlleZahlen days={days} site={site} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
