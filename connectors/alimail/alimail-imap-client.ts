import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { assertAliMailCredentials, type AliMailRuntimeConfig } from "./alimail-config";

export interface AliMailAuthDiagnostic {
  provider: "alimail";
  host: string;
  port: number;
  secure: boolean;
  usernameConfigured: boolean;
  connected: boolean;
  errorCode?: string;
  mailboxCount?: number;
}

export interface AliMailFolder {
  path: string;
  name: string;
  listed: boolean;
  specialUse?: string;
  exists?: number;
  unseen?: number;
}

export interface AliMailMessage {
  uid: number;
  folderPath: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  date: Date | null;
  flags: string[];
  text: string;
  hasAttachments: boolean;
  attachmentCount: number;
}

export class AliMailImapClient {
  constructor(private readonly config: AliMailRuntimeConfig) {}

  async authDiagnostic(): Promise<AliMailAuthDiagnostic> {
    if (!this.config.username || !this.config.password) {
      return this.diagnostic(false, "CREDENTIALS_MISSING");
    }
    const client = this.createClient();
    try {
      await client.connect();
      const mailboxes = await client.list();
      await client.logout();
      return { ...this.diagnostic(true), mailboxCount: mailboxes.length };
    } catch (error) {
      await safeLogout(client);
      return this.diagnostic(false, normalizeImapError(error));
    }
  }

  async listFolders(): Promise<AliMailFolder[]> {
    assertAliMailCredentials(this.config);
    const client = this.createClient();
    try {
      await client.connect();
      const mailboxes = await client.list();
      const folders: AliMailFolder[] = [];
      for (const mailbox of mailboxes) {
        folders.push(await this.describeFolder(client, mailbox));
      }
      await client.logout();
      return folders;
    } catch (error) {
      await safeLogout(client);
      throw error;
    }
  }

  async fetchFolderMessages(folderPath: string, sinceUid = 0, limit = 500): Promise<{ messages: AliMailMessage[]; highestUid: number; exists: number; unseen: number }> {
    assertAliMailCredentials(this.config);
    const client = this.createClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folderPath);
      try {
        const mailbox = await client.mailboxOpen(folderPath);
        const messages: AliMailMessage[] = [];
        let highestUid = sinceUid;
        for await (const item of client.fetch(sinceUid > 0 ? `${sinceUid + 1}:*` : "1:*", { uid: true, envelope: true, flags: true, bodyStructure: true, source: true }, { uid: true })) {
          if (!item.uid || item.uid <= sinceUid) {
            continue;
          }
          messages.push(await normalizeFetchMessage(folderPath, item));
          highestUid = Math.max(highestUid, item.uid);
          if (messages.length >= limit) {
            break;
          }
        }
        return { messages, highestUid, exists: Number(mailbox.exists || 0), unseen: 0 };
      } finally {
        lock.release();
      }
    } finally {
      await safeLogout(client);
    }
  }

  private async describeFolder(client: ImapFlow, mailbox: { path: string; name?: string; specialUse?: string }): Promise<AliMailFolder> {
    try {
      const status = await client.status(mailbox.path, { messages: true, unseen: true });
      return { path: mailbox.path, name: mailbox.name || mailbox.path, listed: true, specialUse: mailbox.specialUse, exists: Number(status.messages || 0), unseen: Number(status.unseen || 0) };
    } catch {
      return { path: mailbox.path, name: mailbox.name || mailbox.path, listed: true, specialUse: mailbox.specialUse };
    }
  }

  private createClient(): ImapFlow {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.username, pass: this.config.password },
      logger: false,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000
    });
    client.on("error", () => {
      // Diagnostic and sync paths return bounded error codes explicitly.
    });
    return client;
  }

  private diagnostic(connected: boolean, errorCode?: string): AliMailAuthDiagnostic {
    return { provider: "alimail", host: this.config.host, port: this.config.port, secure: this.config.secure, usernameConfigured: Boolean(this.config.username), connected, errorCode };
  }
}

async function normalizeFetchMessage(folderPath: string, item: FetchMessageObject): Promise<AliMailMessage> {
  const source = item.source || Buffer.alloc(0);
  const parsed = await simpleParser(source);
  const from = item.envelope?.from?.[0];
  const parsedFrom = parsed.from?.value?.[0];
  const attachmentCount = parsed.attachments.length || countAttachments(item.bodyStructure);
  return {
    uid: Number(item.uid || 0),
    folderPath,
    subject: parsed.subject || item.envelope?.subject || "(no subject)",
    fromName: parsedFrom?.name || from?.name || null,
    fromAddress: parsedFrom?.address || from?.address || null,
    date: parsed.date || item.envelope?.date || null,
    flags: Array.from(item.flags || []).map(String),
    text: parsed.text || htmlToText(parsed.html ? String(parsed.html) : ""),
    hasAttachments: attachmentCount > 0,
    attachmentCount
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function countAttachments(node: unknown): number {
  if (!node || typeof node !== "object") {
    return 0;
  }
  const record = node as Record<string, unknown>;
  const disposition = String(record.disposition || "").toLowerCase();
  const own = disposition === "attachment" ? 1 : 0;
  const childNodes = Array.isArray(record.childNodes) ? record.childNodes : [];
  return own + childNodes.reduce((sum, child) => sum + countAttachments(child), 0);
}

function normalizeImapError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/auth|login|password|credential/i.test(message)) return "AUTH_FAILED";
  if (/timeout|timed out/i.test(message)) return "TIMEOUT";
  if (/certificate|tls|ssl/i.test(message)) return "TLS_FAILED";
  return "IMAP_CONNECT_FAILED";
}

async function safeLogout(client: ImapFlow): Promise<void> {
  try {
    if (client.usable) await client.logout();
  } catch {
    // bounded cleanup only
  }
}
