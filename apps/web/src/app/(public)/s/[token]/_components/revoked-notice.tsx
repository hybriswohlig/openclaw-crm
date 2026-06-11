import { WhatsAppContactLink } from "./whatsapp-contact-link";

export function RevokedNotice({
  firmaDisplayName,
  whatsappNumberE164 = null,
}: {
  firmaDisplayName: string;
  whatsappNumberE164?: string | null;
}) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">🔒</div>
      <h1 className="mt-6 text-xl font-medium">Link nicht mehr verfügbar</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Dieser Status-Link wurde geschlossen oder ist abgelaufen.
        Bitte kontaktieren Sie {firmaDisplayName}, falls Sie weiterhin
        Informationen zu Ihrem Umzug benötigen.
      </p>
      <WhatsAppContactLink
        phoneE164={whatsappNumberE164}
        label="Fragen? Per WhatsApp schreiben"
        className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
      />
    </main>
  );
}
