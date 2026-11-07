import { istId, weiterLink } from "@/lib/handy-links";

/**
 * Link auf einen Chat über die Weiche `/weiter`.
 *
 * Push-Benachrichtigungen bauen ihren Link hier. Die Weiche liest die Oberfläche
 * und öffnet den Chat in der neuen oder der alten Inbox. Eine gültige Kennung
 * wird `?conv=`; ohne Kennung oder mit einer ungültigen geht es auf `/weiter`.
 */
export function inboxKonversationUrl(conversationId: string | null | undefined): string {
  return istId(conversationId) ? weiterLink({ art: "gespraech", id: conversationId }) : weiterLink({ art: "inbox" });
}
