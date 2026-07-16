import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMigrations } from "../src/migrations";

const migrationsDirectory = join(__dirname, "../src/migrations");
const expectedMigrationFiles = readdirSync(migrationsDirectory)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort();

function createTempMigrationDirectory(): string {
  return mkdtempSync(join(tmpdir(), "bma-migrations-"));
}

function tableExists(database: DatabaseSync, table: string): boolean {
  const row = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table);
  return row !== undefined;
}

function appliedFilenames(database: DatabaseSync): string[] {
  return database
    .prepare("SELECT filename FROM schema_migrations ORDER BY filename")
    .all()
    .map((row) => row.filename as string);
}

test("creates the full schema on a fresh database", () => {
  const database = new DatabaseSync(":memory:");

  const applied = runMigrations(database, migrationsDirectory);

  assert.deepEqual(applied, expectedMigrationFiles);
  assert.equal(tableExists(database, "messages"), true);
  assert.equal(tableExists(database, "moderation_actions"), true);
  assert.deepEqual(appliedFilenames(database), expectedMigrationFiles);
});

test("upgrades a legacy database without a schema_migrations table", () => {
  const database = new DatabaseSync(":memory:");

  // Simulate a production DB that predates migration tracking: tables from
  // 001/002 exist, with existing data, but no schema_migrations table.
  database.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL CHECK (length (username) BETWEEN 1 AND 32),
      body TEXT NOT NULL CHECK (length (body) BETWEEN 1 AND 500),
      created_at INTEGER NOT NULL
    ) STRICT
  `);
  database
    .prepare(
      "INSERT INTO messages (username, body, created_at) VALUES (?, ?, ?)",
    )
    .run("Trevor", "legacy row", 1_000);

  const applied = runMigrations(database, migrationsDirectory);

  // 001/002 are idempotent (IF NOT EXISTS): re-executed as no-ops and recorded.
  assert.deepEqual(applied, expectedMigrationFiles);
  assert.deepEqual(appliedFilenames(database), expectedMigrationFiles);

  // Existing rows survive the re-run.
  const row = database
    .prepare("SELECT username, body FROM messages WHERE id = 1")
    .get() as { username: string; body: string } | undefined;
  assert.ok(row !== undefined);
  assert.equal(row.username, "Trevor");
  assert.equal(row.body, "legacy row");
});

test("does not re-run already-applied migrations", () => {
  const directory = createTempMigrationDirectory();
  try {
    // A non-idempotent migration: running it twice without tracking would fail.
    writeFileSync(
      join(directory, "001_seed.sql"),
      "CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t (id) VALUES (1);",
    );

    const database = new DatabaseSync(":memory:");

    const firstRun = runMigrations(database, directory);
    assert.deepEqual(firstRun, ["001_seed.sql"]);

    const secondRun = runMigrations(database, directory);
    assert.deepEqual(secondRun, []);

    const count = database
      .prepare("SELECT COUNT(*) AS n FROM t")
      .get() as { n: number };
    assert.equal(count.n, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rolls back a failed migration atomically", () => {
  const directory = createTempMigrationDirectory();
  try {
    // First statement succeeds, second fails. Nothing should be recorded and the
    // first statement's effect must be rolled back (transactional DDL).
    writeFileSync(
      join(directory, "001_partial.sql"),
      "CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO no_such_table VALUES (1);",
    );

    const database = new DatabaseSync(":memory:");

    assert.throws(() => runMigrations(database, directory));

    assert.equal(tableExists(database, "t"), false);
    assert.equal(tableExists(database, "schema_migrations"), true);
    assert.deepEqual(appliedFilenames(database), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
