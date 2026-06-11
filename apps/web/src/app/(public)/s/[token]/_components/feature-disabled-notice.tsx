import { WhatsAppContactLink } from "./whatsapp-contact-link";

export function FeatureDisabledNotice({
  whatsappNumberE164 = null,
}: {
  whatsappNumberE164?: string | null;
}) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">🛠️</div>
      <h1 className="mt-6 text-xl font-medium">Aktuell nicht verfügbar</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Das Status-Portal ist vorübergehend nicht erreichbar. Ihr Auftrag
        läuft davon unabhängig ganz normal weiter.
      </p>
      <WhatsAppContactLink
        phoneE164={whatsappNumberE164}
        label="Fragen? Per WhatsApp schreiben"
        className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
      />
    </main>
  );
}
