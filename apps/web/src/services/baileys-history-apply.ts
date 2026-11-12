/**
 * Write a planned Baileys history import. Inserts only.
 *
 * Does not call the bridge, does not run approval commands, and does not
 * send WhatsApp or email. Refuses the excluded channel accounts before
 * touching the database.
 */
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { and, eq, isNull } from "drizzle-orm";
import { findeInterne, ladeInterneNummern } from "@/services/intern/interne-nummern";
import {
  ingestInboundWhatsAppMessage,
  ingestOutboundWhatsAppMessage,
} from "@/services/inbox-whatsapp";
import {
  isHistorySyncExcludedAccount,
  isSkippedWhatsAppThread,
  type PlannedHistoryRow,
} from "@/services/baileys-history-sync";

export interface HistoryApplyResult {
  stored: number;
  duplicates: number;
  skippedInternal: number;
  skippedWindow: number;
  skippedGroup: number;
  skippedExcluded: number;
}

export async function applyBaileysHistoryImport(input: {
  accountId: string;
  since: Date;
  rows: PlannedHistoryRow[];
}): Promise<HistoryApplyResult> {
  if (isHistorySyncExcludedAccount(input.accountId)) {
    throw new Error("refusing history import for an excluded channel account");
  }

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, input.accountId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.isActive, true),
        isNull(channelAccounts.waPhoneNumberId),
      ),
    )
    .limit(1);

  if (!account || account.id !== input.accountId || isHistorySyncExcludedAccount(account.id)) {
    throw new Error("baileys account not found for history import");
  }

  const nummern = await ladeInterneNummern(account.workspaceId);
  const result: HistoryApplyResult = {
    stored: 0,
    duplicates: 0,
    skippedInternal: 0,
    skippedWindow: 0,
    skippedGroup: 0,
    skippedExcluded: 0,
  };
  const sinceMs = input.since.getTime();

  for (const row of input.rows) {
    if (row.accountId !== input.accountId || isHistorySyncExcludedAccount(row.accountId)) {
      result.skippedExcluded += 1;
      continue;
    }
    if (isSkippedWhatsAppThread(row.peerJid, row.peerWaId)) {
      result.skippedGroup += 1;
      continue;
    }
    const sentAt = new Date(row.sentAt);
    if (Number.isNaN(sentAt.getTime()) || sentAt.getTime() < sinceMs) {
      result.skippedWindow += 1;
      continue;
    }
    if (findeInterne(nummern, { peerWaId: row.peerWaId, peerJid: row.peerJid, peerLid: row.peerLid })) {
      result.skippedInternal += 1;
      continue;
    }

    const rawHeaders = {
      provider: "baileys",
      source: "history-sync",
      historySync: true,
      importedFrom: "spool",
    };

    if (row.kind === "in") {
      const stored = await ingestInboundWhatsAppMessage({
        account,
        peerWaId: row.peerWaId,
        peerJid: row.peerJid,
        peerLid: row.peerLid,
        body: row.body,
        previewLabel: row.previewLabel,
        externalMessageId: row.externalMessageId,
        sentAt,
        toAddress: account.address,
        rawHeaders,
        historySync: true,
      });
      if (stored.messageId) result.stored += 1;
      else if (stored.duplicate) result.duplicates += 1;
      continue;
    }

    const stored = await ingestOutboundWhatsAppMessage({
      account,
      peerWaId: row.peerWaId,
      peerJid: row.peerJid,
      peerLid: row.peerLid,
      body: row.body,
      previewLabel: row.previewLabel,
      externalMessageId: row.externalMessageId,
      sentAt,
      rawHeaders,
      origin: "history-sync",
    });
    if (stored.messageId) result.stored += 1;
    else if (stored.duplicate) result.duplicates += 1;
  }

  return result;
}
