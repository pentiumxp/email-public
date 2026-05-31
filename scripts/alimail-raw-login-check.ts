import tls from "node:tls";
import { readFileSync } from "node:fs";
import { loadAliMailRuntimeConfig } from "../connectors/alimail/alimail-config";

const config = loadAliMailRuntimeConfig();
const credentials = JSON.parse(readFileSync(config.credentialsFile, "utf8")) as { username?: string; password?: string };
const username = process.env.EMAIL_ALIMAIL_USERNAME || credentials.username || "";
const password = process.env.EMAIL_ALIMAIL_PASSWORD || credentials.password || "";

if (!username || !password) {
  console.log(JSON.stringify({ loginStatus: "CREDENTIALS_MISSING" }));
  process.exit(0);
}

const socket = tls.connect({
  host: config.host,
  port: config.port,
  servername: config.host,
  timeout: 20000
});

let buffer = "";
let sentLogin = false;
let done = false;

socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  if (!sentLogin && /^\* OK/m.test(buffer)) {
    sentLogin = true;
    buffer = "";
    socket.write(`a1 LOGIN ${quoteAtom(username)} ${quoteAtom(password)}\r\n`);
    return;
  }
  const match = `\n${buffer}`.match(/\r?\na1 (OK|NO|BAD|BYE)([^\r\n]*)/);
  if (sentLogin && match) {
    finish({
      loginStatus: match[1],
      responseCode: sanitizeResponse(match[2] || "")
    });
  }
});

socket.on("timeout", () => finish({ loginStatus: "TIMEOUT" }));
socket.on("error", (error: NodeJS.ErrnoException) => finish({ loginStatus: "TLS_ERROR", errorCode: error.code || "TLS_ERROR" }));

function quoteAtom(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function sanitizeResponse(value: string): string {
  return value.replace(/\[[^\]]+\]/g, "[code]").slice(0, 160).trim();
}

function finish(payload: unknown): void {
  if (done) {
    return;
  }
  done = true;
  console.log(JSON.stringify(payload));
  socket.destroy();
}
