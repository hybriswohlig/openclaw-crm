/**
 * Link auf einen Chat in der Inbox.
 *
 * Die Inbox liest beim Laden genau `?conv=<id>` (app/(dashboard)/inbox/page.tsx)
 * und öffnet diesen Chat, auch wenn er in einer anderen Lane oder einem anderen
 * Status liegt. Push-Benachrichtigungen bauen ihren Link hier, damit Sender und
 * Seite denselben Parameter benutzen. Ohne Konversation geht es auf die Inbox.
 */
export function inboxKonversationUrl(conversationId: string | null | undefined): string {
  return conversationId ? `/inbox?conv=${encodeURIComponent(conversationId)}` : "/inbox";
}
