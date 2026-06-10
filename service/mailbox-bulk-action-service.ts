import { MessageRepository, type MailMessageRecord } from "../store/mail-repositories";
import type { SqliteDatabase } from "../store/sqlite-store";
import type { AuthContext } from "./authorization-service";
import { MailboxActionService } from "./mailbox-action-service";

const DEFAULT_SEARCH_LIMIT = 500;
const MAX_BULK_LIMIT = 1000;
const SAMPLE_LIMIT = 10;

export interface BulkSearchDeleteInput {
  query: string;
  folderId?: string;
  limit?: number;
  dryRun?: boolean;
  includeSender?: string[];
  includeSubject?: string[];
  excludeKeywords?: string[];
  olderThanDays?: number | null;
  newerThanDays?: number | null;
}

export interface BulkApplyInput {
  action: string;
  messageIds: string[];
  dryRun?: boolean;
}

interface SkippedSample extends BulkMessageSample {
  reason: string;
}

interface BulkMessageSample {
  messageId: string;
  subject: string;
  from: string;
  date: string;
}

export class MailboxBulkActionService {
  private readonly messages: MessageRepository;
  private readonly actions: MailboxActionService;

  constructor(db: SqliteDatabase) {
    this.messages = new MessageRepository(db);
    this.actions = new MailboxActionService(db);
  }

  deleteLocalBySearch(context: AuthContext, input: BulkSearchDeleteInput) {
    if (!input.query?.trim()) {
      return { ok: false, error: "email_query_required" };
    }
    const dryRun = input.dryRun !== false;
    const limit = boundedBulkLimit(input.limit, DEFAULT_SEARCH_LIMIT);
    const candidates = this.messages.searchForAccountsAdvanced({
      accountIds: context.allowedAccountIds,
      query: input.query,
      folderId: input.folderId,
      receivedBefore: daysAgoIso(input.olderThanDays),
      receivedAfter: daysAgoIso(input.newerThanDays),
      limit,
      offset: 0
    });
    const evaluated = evaluateCandidates(candidates, input);
    const applied = dryRun ? [] : this.deleteMessages(context, evaluated.deletable);
    const deletedIds = new Set(applied.filter((result) => result.changed).map((result) => result.messageId));

    return {
      ok: true,
      matched_count: candidates.length,
      would_delete_count: evaluated.deletable.length,
      deleted_count: dryRun ? 0 : deletedIds.size,
      skipped_count: evaluated.skipped.length + (dryRun ? 0 : applied.filter((result) => !result.changed).length),
      remoteApplied: false,
      action: "delete_local",
      dry_run: dryRun,
      limit,
      sample_deleted: sampleMessages(evaluated.deletable),
      skipped_samples: evaluated.skipped.slice(0, SAMPLE_LIMIT),
      sender_breakdown: senderBreakdown(evaluated.deletable)
    };
  }

  applyMailActionBulk(context: AuthContext, input: BulkApplyInput) {
    if (input.action !== "delete_local") {
      return { ok: false, error: "email_mcp_action_not_supported", supportedActions: ["delete_local"] };
    }
    const dryRun = input.dryRun !== false;
    const messageIds = uniqueStrings(input.messageIds).slice(0, MAX_BULK_LIMIT);
    if (messageIds.length === 0) {
      return { ok: false, error: "email_message_ids_required" };
    }

    const deletable: MailMessageRecord[] = [];
    const skipped: SkippedSample[] = [];
    for (const messageId of messageIds) {
      const message = this.messages.get(messageId);
      if (!message) {
        skipped.push({ messageId, subject: "", from: "", date: "", reason: "message not found or already deleted" });
        continue;
      }
      if (!context.allowedAccountIds.includes(message.accountId)) {
        skipped.push({ messageId, subject: "", from: "", date: "", reason: "message outside allowed accounts" });
        continue;
      }
      deletable.push(message);
    }

    const applied = dryRun ? [] : this.deleteMessages(context, deletable);
    const failed = dryRun ? [] : applied.filter((result) => !result.changed).map((result) => ({
      ...sampleMessage(result.message),
      reason: result.error ?? "delete_local not applied"
    }));

    return {
      ok: true,
      matched_count: messageIds.length,
      would_delete_count: deletable.length,
      deleted_count: dryRun ? 0 : applied.filter((result) => result.changed).length,
      skipped_count: skipped.length + failed.length,
      remoteApplied: false,
      action: "delete_local",
      dry_run: dryRun,
      limit: MAX_BULK_LIMIT,
      sample_deleted: sampleMessages(deletable),
      skipped_samples: [...skipped, ...failed].slice(0, SAMPLE_LIMIT),
      sender_breakdown: senderBreakdown(deletable)
    };
  }

  private deleteMessages(context: AuthContext, messages: MailMessageRecord[]) {
    return messages.map((message) => {
      const result = this.actions.deleteLocal(context, { accountId: message.accountId, messageId: message.id });
      return { messageId: message.id, message, changed: result.changed, error: result.error };
    });
  }
}

function evaluateCandidates(candidates: MailMessageRecord[], input: BulkSearchDeleteInput) {
  const includeSender = normalizedList(input.includeSender);
  const includeSubject = normalizedList(input.includeSubject);
  const excludeKeywords = normalizedList(input.excludeKeywords);
  const deletable: MailMessageRecord[] = [];
  const skipped: SkippedSample[] = [];

  for (const message of candidates) {
    const senderText = normalizedText(`${message.senderDisplay ?? ""} ${message.senderAddressBounded ?? ""}`);
    const subjectText = normalizedText(message.subject);
    const combinedText = `${subjectText} ${senderText}`;
    const excluded = excludeKeywords.find((keyword) => combinedText.includes(keyword));
    if (excluded) {
      skipped.push({ ...sampleMessage(message), reason: `matched exclude keyword: ${excluded}` });
      continue;
    }
    if (includeSender.length > 0 && !includeSender.some((keyword) => senderText.includes(keyword))) {
      skipped.push({ ...sampleMessage(message), reason: "sender did not match include_sender" });
      continue;
    }
    if (includeSubject.length > 0 && !includeSubject.some((keyword) => subjectText.includes(keyword))) {
      skipped.push({ ...sampleMessage(message), reason: "subject did not match include_subject" });
      continue;
    }
    deletable.push(message);
  }
  return { deletable, skipped };
}

function boundedBulkLimit(value: unknown, fallback: number): number {
  return Math.min(Math.max(Number(value ?? fallback) || fallback, 1), MAX_BULK_LIMIT);
}

function daysAgoIso(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) {
    return undefined;
  }
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function sampleMessages(messages: MailMessageRecord[]): BulkMessageSample[] {
  return messages.slice(0, SAMPLE_LIMIT).map(sampleMessage);
}

function sampleMessage(message: MailMessageRecord): BulkMessageSample {
  return {
    messageId: message.id,
    subject: clamp(message.subject, 160),
    from: clamp(message.senderAddressBounded || message.senderDisplay || "Unknown sender", 160),
    date: message.receivedAt
  };
}

function senderBreakdown(messages: MailMessageRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    const sender = clamp(message.senderAddressBounded || message.senderDisplay || "Unknown sender", 160);
    counts[sender] = (counts[sender] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25));
}

function normalizedList(values: string[] | undefined): string[] {
  return uniqueStrings(values ?? []).map(normalizedText).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function normalizedText(value: string): string {
  return value.toLocaleLowerCase();
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}
