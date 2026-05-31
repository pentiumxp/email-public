import { openMailDatabase, runMigrations } from "../store/sqlite-store";
import { loadAliMailRuntimeConfig } from "../connectors/alimail/alimail-config";

const config = loadAliMailRuntimeConfig();
const db = openMailDatabase(config.databasePath);
runMigrations(db);
db.prepare("DELETE FROM mail_sync_cursors WHERE account_id = ?").run(config.accountId);
console.log(JSON.stringify({ deletedAliMailCursors: true }));
