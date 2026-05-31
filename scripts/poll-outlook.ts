import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { MicrosoftGraphClient } from "../connectors/outlook-graph/microsoft-graph-client";
import { loadOutlookRuntimeConfig } from "../connectors/outlook-graph/outlook-config";
import { OutlookDeltaSyncService } from "../service/outlook-delta-sync-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

const config = loadOutlookRuntimeConfig();
mkdirSync(dirname(config.databasePath), { recursive: true });
const db = openMailDatabase(config.databasePath);
runMigrations(db);

const intervalSeconds = Number(process.env.EMAIL_OUTLOOK_POLL_SECONDS || 180);
const once = process.argv.includes("--once");
const graph = new MicrosoftGraphClient(config);

do {
  const startedAt = new Date().toISOString();
  try {
    console.log(JSON.stringify({ event: "poll_sync_start", startedAt, intervalSeconds }));
    const service = new OutlookDeltaSyncService(graph, db);
    const summary = await service.syncOnce();
    console.log(JSON.stringify({ event: "poll_sync_complete", startedAt, completedAt: new Date().toISOString(), intervalSeconds, ...summary }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "poll_sync_error",
      startedAt,
      completedAt: new Date().toISOString(),
      errorCode: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN_ERROR"
    }));
  }
  if (!once) {
    await sleep(intervalSeconds * 1000);
  }
} while (!once);
