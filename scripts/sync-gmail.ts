import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { GmailApiClient } from "../connectors/gmail/gmail-api-client";
import { ensureGmailConfigFiles, loadGmailRuntimeConfig } from "../connectors/gmail/gmail-config";
import { GmailSyncService } from "../service/gmail-sync-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

ensureGmailConfigFiles();
const config = loadGmailRuntimeConfig();
mkdirSync(dirname(config.databasePath), { recursive: true });
const db = openMailDatabase(config.databasePath);
runMigrations(db);
const summary = await new GmailSyncService(config, new GmailApiClient(config), db).syncAll(Number(process.env.EMAIL_GMAIL_SYNC_LIMIT || 100));
console.log(JSON.stringify({ databasePath: config.databasePath, ...summary }, null, 2));
