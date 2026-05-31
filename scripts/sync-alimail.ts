import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AliMailImapClient } from "../connectors/alimail/alimail-imap-client";
import { ensureAliMailConfigFiles, loadAliMailRuntimeConfig } from "../connectors/alimail/alimail-config";
import { AliMailSyncService } from "../service/alimail-sync-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

ensureAliMailConfigFiles();
const config = loadAliMailRuntimeConfig();
mkdirSync(dirname(config.databasePath), { recursive: true });
const db = openMailDatabase(config.databasePath);
runMigrations(db);
const summary = await new AliMailSyncService(config, new AliMailImapClient(config), db).syncAll(Number(process.env.EMAIL_ALIMAIL_SYNC_LIMIT || 500));
console.log(JSON.stringify({ databasePath: config.databasePath, ...summary }, null, 2));
