import { DatabaseSync } from "node:sqlite";
import { migrationStatements } from "./schema";

export type SqliteDatabase = Pick<DatabaseSync, "exec" | "prepare">;

export function openMailDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function runMigrations(db: SqliteDatabase): void {
  for (const statement of migrationStatements) {
    db.exec(statement);
  }
}

