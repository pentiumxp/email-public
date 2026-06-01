import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { AliMailImapClient } from "../connectors/alimail/alimail-imap-client";
import { ensureAliMailConfigFiles, loadAliMailRuntimeConfig } from "../connectors/alimail/alimail-config";
import { GmailApiClient } from "../connectors/gmail/gmail-api-client";
import { ensureGmailConfigFiles, loadGmailRuntimeConfig } from "../connectors/gmail/gmail-config";
import { MicrosoftGraphClient } from "../connectors/outlook-graph/microsoft-graph-client";
import { loadOutlookRuntimeConfig } from "../connectors/outlook-graph/outlook-config";
import { createEmailHttpServer } from "../server/email-http-server";
import { AliMailSyncService } from "../service/alimail-sync-service";
import { GmailSyncService } from "../service/gmail-sync-service";
import { OutlookDeltaSyncService } from "../service/outlook-delta-sync-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

ensureAliMailConfigFiles();
ensureGmailConfigFiles();
const outlookConfig = loadOutlookRuntimeConfig();
const aliMailConfig = loadAliMailRuntimeConfig();
const gmailConfig = loadGmailRuntimeConfig();
mkdirSync(dirname(outlookConfig.databasePath), { recursive: true });

const host = process.env.EMAIL_SERVICE_HOST || "0.0.0.0";
const port = Number(process.env.EMAIL_SERVICE_PORT || 5175);
const outlookPollSeconds = Number(process.env.EMAIL_OUTLOOK_POLL_SECONDS || 180);
const aliMailPollSeconds = Number(process.env.EMAIL_ALIMAIL_POLL_SECONDS || 300);
const gmailPollSeconds = Number(process.env.EMAIL_GMAIL_POLL_SECONDS || 300);
const aliMailSyncLimit = Number(process.env.EMAIL_ALIMAIL_SYNC_LIMIT || 500);
const gmailHistoryPageLimit = Number(process.env.EMAIL_GMAIL_HISTORY_PAGE_LIMIT || 20);
const staticRoot = process.env.EMAIL_SERVICE_STATIC_ROOT || join(process.cwd(), "dist", "web");

const server = createEmailHttpServer({ databasePath: outlookConfig.databasePath, staticRoot });
server.listen(port, host, () => {
  console.log(JSON.stringify({
    event: "email_service_listening",
    host,
    port,
    databasePath: outlookConfig.databasePath,
    outlookPollSeconds,
    aliMailPollSeconds,
    gmailPollSeconds
  }));
});

const db = openMailDatabase(outlookConfig.databasePath);
runMigrations(db);

void runOutlookPollLoop();
void runAliMailPollLoop();
void runGmailPollLoop();

async function runOutlookPollLoop() {
  const graph = new MicrosoftGraphClient(outlookConfig);
  while (true) {
    const startedAt = new Date().toISOString();
    try {
      const summary = await new OutlookDeltaSyncService(graph, db).syncOnce();
      console.log(JSON.stringify({ event: "service_outlook_poll_complete", startedAt, completedAt: new Date().toISOString(), ...summary }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "service_outlook_poll_error",
        startedAt,
        completedAt: new Date().toISOString(),
        errorCode: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN_ERROR"
      }));
    }
    await sleep(outlookPollSeconds * 1000);
  }
}

async function runAliMailPollLoop() {
  while (true) {
    const startedAt = new Date().toISOString();
    try {
      const summary = await new AliMailSyncService(aliMailConfig, new AliMailImapClient(aliMailConfig), db).syncAll(aliMailSyncLimit);
      console.log(JSON.stringify({ event: "service_alimail_poll_complete", startedAt, completedAt: new Date().toISOString(), ...summary }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "service_alimail_poll_error",
        startedAt,
        completedAt: new Date().toISOString(),
        errorCode: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN_ERROR"
      }));
    }
    await sleep(aliMailPollSeconds * 1000);
  }
}

async function runGmailPollLoop() {
  const client = new GmailApiClient(gmailConfig);
  if (!gmailConfig.clientId || !client.hasRefreshToken()) {
    console.log(JSON.stringify({
      event: "service_gmail_poll_skipped",
      reason: gmailConfig.clientId ? "NO_TOKEN" : "NO_CLIENT_ID"
    }));
    return;
  }
  while (true) {
    const startedAt = new Date().toISOString();
    try {
      const summary = await new GmailSyncService(gmailConfig, client, db).syncIncremental(gmailHistoryPageLimit);
      console.log(JSON.stringify({ event: "service_gmail_poll_complete", startedAt, completedAt: new Date().toISOString(), ...summary }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "service_gmail_poll_error",
        startedAt,
        completedAt: new Date().toISOString(),
        errorCode: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN_ERROR"
      }));
    }
    await sleep(gmailPollSeconds * 1000);
  }
}
