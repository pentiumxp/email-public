import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MicrosoftGraphClient } from "../connectors/outlook-graph/microsoft-graph-client";
import { loadOutlookRuntimeConfig } from "../connectors/outlook-graph/outlook-config";
import { OutlookDeltaSyncService } from "../service/outlook-delta-sync-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

const config = loadOutlookRuntimeConfig();
mkdirSync(dirname(config.databasePath), { recursive: true });
const db = openMailDatabase(config.databasePath);
runMigrations(db);

const service = new OutlookDeltaSyncService(new MicrosoftGraphClient(config), db, (progress) => {
  console.log(JSON.stringify({ event: "delta_progress", ...progress }));
});
const summary = await service.syncOnce();
console.log(JSON.stringify({ event: "delta_complete", databasePath: config.databasePath, ...summary }, null, 2));
