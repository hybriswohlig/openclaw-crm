import { kundenText, type CustomerEmailStatus } from "@openclaw-crm/customer-portal-core";

/**
 * Ask for an address to send the order confirmation.
 * Kottke says Zahlungsbeleg and du. Ceylan says Rechnung and sie.
 */
export function emailCaptureTexte(
  firmaSlug: string,
  status: CustomerEmailStatus,
  variant: "box" | "zeile",
): { headline: string; body: string } {
  const t = (sie: string, du: string) => kundenText(firmaSlug, sie, du);
  const kottke = firmaSlug === "kottke";
  const headline =
    status === "kleinanzeigen_relay"
      ? t(
          "Wir haben Sie bisher nur über Kleinanzeigen erreicht.",
          "Wir haben dich bisher nur über Kleinanzeigen erreicht.",
        )
      : variant === "zeile"
        ? kottke
          ? t(
              "Wohin dürfen wir Ihnen die Auftragsbestätigung und den Zahlungsbeleg schicken?",
              "Wohin dürfen wir dir die Auftragsbestätigung und den Zahlungsbeleg schicken?",
            )
          : "Wohin dürfen wir Auftragsbestätigung und Rechnung schicken?"
        : t("Wir haben noch keine E-Mail von Ihnen.", "Wir haben noch keine E-Mail von dir.");
  const body =
    status === "kleinanzeigen_relay"
      ? kottke
        ? t(
            "Damit Sie Ihre Auftragsbestätigung, den Zahlungsbeleg und weitere Unterlagen direkt erhalten, geben Sie uns kurz Ihre echte E-Mail-Adresse.",
            "Damit du deine Auftragsbestätigung, den Zahlungsbeleg und weitere Unterlagen direkt erhältst, gib uns kurz deine echte E-Mail-Adresse.",
          )
        : "Damit Sie Ihre Auftragsbestätigung, Rechnung und weitere Unterlagen direkt erhalten, geben Sie uns kurz Ihre echte E-Mail-Adresse."
      : kottke
        ? t(
            "Damit Sie Ihre Auftragsbestätigung und den Zahlungsbeleg per E-Mail erhalten, hinterlegen Sie hier bitte Ihre Adresse.",
            "Damit du deine Auftragsbestätigung und den Zahlungsbeleg per E-Mail erhältst, hinterlege hier bitte deine Adresse.",
          )
        : "Damit Sie Ihre Auftragsbestätigung und Rechnung per E-Mail erhalten, hinterlegen Sie hier bitte Ihre Adresse.";
  return { headline, body };
}

/** Privacy-page sentence for the same email field. */
export function datenschutzEmailZweck(firmaSlug: string): string {
  const beispiel =
    firmaSlug === "kottke"
      ? "Auftragsbestätigung und den Zahlungsbeleg"
      : "Auftragsbestätigung und Rechnung";
  return kundenText(
    firmaSlug,
    `Wenn Sie im Portal Ihre E-Mail-Adresse hinterlegen, verwenden wir diese ausschließlich, um Ihnen Unterlagen zu Ihrem Auftrag zuzusenden, zum Beispiel ${beispiel}. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.`,
    `Wenn du im Portal deine E-Mail-Adresse hinterlegst, verwenden wir diese ausschließlich, um dir Unterlagen zu deinem Auftrag zuzusenden, zum Beispiel ${beispiel}. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.`,
  );
}

export function emailGespeichertHinweis(firmaSlug: string): string {
  return kundenText(
    firmaSlug,
    "Wir senden Ihnen die Bestätigung und alle Unterlagen zu Ihrem Umzug an diese Adresse.",
    "Wir senden dir die Bestätigung und alle Unterlagen zu deinem Umzug an diese Adresse.",
  );
}

export function emailAdresseHinweis(firmaSlug: string): string {
  return kundenText(
    firmaSlug,
    "Wir verwenden Ihre Adresse nur für Unterlagen zu diesem Umzug.",
    "Wir verwenden deine Adresse nur für Unterlagen zu diesem Umzug.",
  );
}

export function emailFehler(firmaSlug: string, code: string | undefined): string {
  const t = (sie: string, du: string) => kundenText(firmaSlug, sie, du);
  switch (code) {
    case "INVALID_EMAIL":
      return t(
        "Bitte geben Sie eine gültige E-Mail-Adresse an.",
        "Bitte gib eine gültige E-Mail-Adresse an.",
      );
    case "RELAY_NOT_ALLOWED":
      return t(
        "Diese Adresse ist nur ein Weiterleitungs-Link. Bitte geben Sie Ihre echte Adresse an.",
        "Diese Adresse ist nur ein Weiterleitungs-Link. Bitte gib deine echte Adresse an.",
      );
    case "NO_PEOPLE_RECORD":
    case "NO_EMAIL_ATTRIBUTE":
      return t(
        "Es gibt aktuell kein Kontaktprofil. Bitte melden Sie sich kurz beim Ansprechpartner.",
        "Es gibt aktuell kein Kontaktprofil. Bitte melde dich kurz beim Ansprechpartner.",
      );
    case "REVOKED":
      return "Dieser Link ist nicht mehr aktiv.";
    case "NOT_FOUND":
      return "Link nicht gefunden.";
    default:
      return allgemeinerFehler(firmaSlug);
  }
}

export function hinterlegteEmailLabel(firmaSlug: string | null | undefined): string {
  return kundenText(firmaSlug, "Ihre hinterlegte E-Mail-Adresse", "deine hinterlegte E-Mail-Adresse");
}

export function verbindungsfehler(firmaSlug: string | null | undefined): string {
  return kundenText(
    firmaSlug,
    "Verbindungsfehler. Bitte versuchen Sie es erneut.",
    "Verbindungsfehler. Bitte versuche es erneut.",
  );
}

export function allgemeinerFehler(firmaSlug: string | null | undefined): string {
  return kundenText(
    firmaSlug,
    "Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.",
    "Es ist ein Fehler aufgetreten. Bitte versuche es erneut.",
  );
}
