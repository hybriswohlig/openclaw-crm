import React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import "../../src/app/globals.css";
import "../../src/components/glassyui/styles/liquid.css";
import "../../src/styles/neu.css";
import "../../src/styles/neu-akte.css";
import { GlassProvider } from "../../src/components/glassyui/glass-provider";
import { Hintergrund } from "../../src/components/neu/hintergrund";
import { KvEditor } from "../../src/components/neu/kv-editor/kv-editor-seite";
import { fixtureQuelle, KV_SZENARIEN, type KvSzenario } from "../../src/components/neu/kv-editor/kv-editor-fixture";
import type { RechtsPanel } from "../../src/components/neu/kv-editor/kv-kopf";

// Isolierte Vorschau des KV-Editors mit Testdaten (Plan Aufgabe 6a). Keine Datenbank, kein Netz.
// ?szenario=<KV_SZENARIEN>  &dunkel  &verlauf  &rechts=formular|chat
const p = new URLSearchParams(location.search);
const s = p.get("szenario") ?? "standard";
const szenario: KvSzenario = (KV_SZENARIEN as readonly string[]).includes(s) ? (s as KvSzenario) : "standard";
const theme = p.has("dunkel") ? "dark" : "light";
const rechts = (p.get("rechts") === "formular" || p.get("rechts") === "chat" ? p.get("rechts") : null) as RechtsPanel;
const quelle = fixtureQuelle(szenario, { druckMs: Number(p.get("druckms") ?? 4000), pdf: (id) => `/vorschau.pdf?stand=${encodeURIComponent(id)}` });
document.documentElement.setAttribute("data-lg-theme", theme);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GlassProvider defaultTheme="light" theme={theme}>
      <div data-neu="">
        <Hintergrund />
        <div className="neu-geruest">
          <aside className="neu-seitenleiste" style={{ background: "var(--fill-2)" }} aria-label="Seitenleiste (Platzhalter)" />
          <main className="neu-inhalt">
            <KvEditor dealId="deal_beispiel" quelle={quelle} pollMs={1500} start={{ verlauf: p.has("verlauf"), rechts }} />
          </main>
        </div>
      </div>
      <Toaster position="bottom-right" />
    </GlassProvider>
  </React.StrictMode>
);
