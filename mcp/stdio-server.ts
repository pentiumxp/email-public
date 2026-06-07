import { createInterface } from "node:readline";
import { EmailMcpService } from "../service/email-mcp-service";
import { emailDatabasePath } from "../store/runtime-paths";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";
import { handleMcpJsonRpcLine } from "./stdio-protocol";

const db = openMailDatabase(emailDatabasePath());
runMigrations(db);
const service = new EmailMcpService(db);

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const response = handleMcpJsonRpcLine(service, line);
  if (response) {
    process.stdout.write(`${response}\n`);
  }
});
