import type { CustomerEmailStatus } from "@openclaw-crm/customer-portal-core";

/**
 * Ask for an address to send the order confirmation. Kottke says Zahlungsbeleg
 * so the question does not read as payment "auf Rechnung". Ceylan keeps
 * Rechnung. The portal around this copy uses Sie.
 */
export function emailCaptureTexte(
  firmaSlug: string,
  status: CustomerEmailStatus,
  variant: "box" | "zeile",
): { headline: string; body: string } {
  const kottke = firmaSlug === "kottke";
  const headline =
    status === "kleinanzeigen_relay"
      ? "Wir haben Sie bisher nur über Kleinanzeigen erreicht."
      : variant === "zeile"
        ? kottke
          ? "Wohin dürfen wir Ihnen die Auftragsbestätigung und den Zahlungsbeleg schicken?"
          : "Wohin dürfen wir Auftragsbestätigung und Rechnung schicken?"
        : "Wir haben noch keine E-Mail von Ihnen.";
  const body =
    status === "kleinanzeigen_relay"
      ? kottke
        ? "Damit Sie Ihre Auftragsbestätigung, den Zahlungsbeleg und weitere Unterlagen direkt erhalten, geben Sie uns kurz Ihre echte E-Mail-Adresse."
        : "Damit Sie Ihre Auftragsbestätigung, Rechnung und weitere Unterlagen direkt erhalten, geben Sie uns kurz Ihre echte E-Mail-Adresse."
      : kottke
        ? "Damit Sie Ihre Auftragsbestätigung und den Zahlungsbeleg per E-Mail erhalten, hinterlegen Sie hier bitte Ihre Adresse."
        : "Damit Sie Ihre Auftragsbestätigung und Rechnung per E-Mail erhalten, hinterlegen Sie hier bitte Ihre Adresse.";
  return { headline, body };
}

/** Privacy-page sentence for the same email field. Sie, per firma. */
export function datenschutzEmailZweck(firmaSlug: string): string {
  const beispiel =
    firmaSlug === "kottke"
      ? "Auftragsbestätigung und den Zahlungsbeleg"
      : "Auftragsbestätigung und Rechnung";
  return `Wenn Sie im Portal Ihre E-Mail-Adresse hinterlegen, verwenden wir diese ausschließlich, um Ihnen Unterlagen zu Ihrem Auftrag zuzusenden, zum Beispiel ${beispiel}. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.`;
}
