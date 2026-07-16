import type { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export function runMigrations(
  database: DatabaseSync,
  migrationsDirectory: string,
): string[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);

  const selectApplied = database.prepare(
    "SELECT filename FROM schema_migrations",
  );
  const applied = new Set<string>(
    selectApplied
      .all()
      .map((row) => row.filename)
      .filter((filename): filename is string => typeof filename === "string"),
  );

  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)",
  );

  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  const appliedNow: string[] = [];

  for (const migrationFile of migrationFiles) {
    if (applied.has(migrationFile)) {
      continue;
    }

    const sql = readFileSync(
      path.join(migrationsDirectory, migrationFile),
      "utf8",
    );

    database.exec("BEGIN");

    try {
      database.exec(sql);
      recordMigration.run(migrationFile, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    appliedNow.push(migrationFile);
  }

  return appliedNow;
}
