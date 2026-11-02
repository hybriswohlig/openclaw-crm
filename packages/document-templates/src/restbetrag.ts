/**
 * Kottke: the remaining balance is due on the job day, right after the job.
 * No later Zahlungsziel and no "auf Rechnung". The sentence has no Du/Sie
 * pronoun, so it fits both address forms.
 * A move says Umzugstag. Any other Kottke service says Einsatztag, so a
 * kitchen or clearance document does not call the job an Umzug.
 */
export const KOTTKE_RESTBETRAG_UMZUG =
  "Der Restbetrag ist am Umzugstag direkt nach dem Umzug fällig (bar oder Überweisung).";

export const KOTTKE_RESTBETRAG_EINSATZ =
  "Der Restbetrag ist am Einsatztag direkt nach dem Einsatz fällig (bar oder Überweisung).";

export function kottkeRestbetragSatz(umzug: boolean): string {
  return umzug ? KOTTKE_RESTBETRAG_UMZUG : KOTTKE_RESTBETRAG_EINSATZ;
}
