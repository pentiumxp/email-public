import { join } from "node:path";

export function emailRuntimeRoot(): string {
  return process.env.EMAIL_PLUGIN_RUNTIME_DIR || join(process.cwd(), "runtime");
}

export function emailDatabasePath(): string {
  return process.env.EMAIL_PLUGIN_DB || join(emailRuntimeRoot(), "data", "mail.sqlite");
}
