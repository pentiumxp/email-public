import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MicrosoftGraphClient } from "../connectors/outlook-graph/microsoft-graph-client";
import { loadOutlookRuntimeConfig } from "../connectors/outlook-graph/outlook-config";
import { OutlookSyncService } from "../service/outlook-sync-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

const config = loadOutlookRuntimeConfig();
mkdirSync(dirname(config.databasePath), { recursive: true });
const db = openMailDatabase(config.databasePath);
runMigrations(db);

const graph = new MicrosoftGraphClient(config);
const service = new OutlookSyncService(graph, db, (progress) => {
  console.log(JSON.stringify({
    event: "sync_progress",
    folderName: progress.folderName,
    pageMessages: progress.pageMessages,
    totalMessagesSeen: progress.totalMessagesSeen,
    nextPage: progress.nextPage
  }));
});
const summary = await service.syncAll();

console.log(JSON.stringify({
  databasePath: config.databasePath,
  ...summary
}, null, 2));
