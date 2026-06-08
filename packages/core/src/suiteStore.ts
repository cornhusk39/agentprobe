// Persistence for authored suites. The dashboard lets a user edit cases in the
// browser, so those cases live in the database, not in a TS file. This store
// reads and writes them and materializes a normal `Suite` the runner can
// execute. Authored assertions are the serializable kinds only (no live Zod
// output-schema), which is what makes them editable as data.
//
// It shares the same SQLite database as the run Store, opened on its own
// connection. Kept separate from store.ts so run persistence and authoring stay
// independent concerns.

import Database from "better-sqlite3";
import { caseSchema, suiteSchema, type Case, type Suite } from "./suite.js";

type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS suites (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suite_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suite TEXT NOT NULL REFERENCES suites(name) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  description TEXT,
  input_json TEXT NOT NULL,
  assertions_json TEXT NOT NULL,
  rubric_json TEXT,
  position INTEGER NOT NULL,
  UNIQUE(suite, case_id)
);
`;

interface CaseRow {
  case_id: string;
  description: string | null;
  input_json: string;
  assertions_json: string;
  rubric_json: string | null;
  position: number;
}

function rowToCase(row: CaseRow): Case {
  // Validate on the way out: a row hand-edited to something invalid should fail
  // loudly here rather than midway through a run.
  return caseSchema.parse({
    id: row.case_id,
    description: row.description ?? undefined,
    input: JSON.parse(row.input_json),
    assertions: JSON.parse(row.assertions_json),
    rubric: row.rubric_json ? JSON.parse(row.rubric_json) : undefined,
  });
}

export class SuiteStore {
  private db: DB;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  upsertSuite(name: string, createdAt: string): void {
    this.db
      .prepare("INSERT INTO suites (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING")
      .run(name, createdAt);
  }

  listSuites(): string[] {
    return (this.db.prepare("SELECT name FROM suites ORDER BY name").all() as { name: string }[]).map(
      (r) => r.name,
    );
  }

  hasSuite(name: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM suites WHERE name = ?").get(name));
  }

  getCases(suite: string): Case[] {
    const rows = this.db
      .prepare("SELECT * FROM suite_cases WHERE suite = ? ORDER BY position ASC, id ASC")
      .all(suite) as CaseRow[];
    return rows.map(rowToCase);
  }

  getCase(suite: string, caseId: string): Case | undefined {
    const row = this.db
      .prepare("SELECT * FROM suite_cases WHERE suite = ? AND case_id = ?")
      .get(suite, caseId) as CaseRow | undefined;
    return row ? rowToCase(row) : undefined;
  }

  // Insert or update a case. Validates the case shape before writing, so an
  // invalid assertion never reaches the database.
  upsertCase(suite: string, input: Case, position?: number): void {
    const c = caseSchema.parse(input);
    const pos =
      position ??
      ((this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM suite_cases WHERE suite = ?").get(suite) as {
        n: number;
      }).n);
    this.db
      .prepare(
        `INSERT INTO suite_cases (suite, case_id, description, input_json, assertions_json, rubric_json, position)
         VALUES (@suite, @caseId, @description, @inputJson, @assertionsJson, @rubricJson, @position)
         ON CONFLICT(suite, case_id) DO UPDATE SET
           description = excluded.description,
           input_json = excluded.input_json,
           assertions_json = excluded.assertions_json,
           rubric_json = excluded.rubric_json`,
      )
      .run({
        suite,
        caseId: c.id,
        description: c.description ?? null,
        inputJson: JSON.stringify(c.input ?? null),
        assertionsJson: JSON.stringify(c.assertions ?? []),
        rubricJson: c.rubric ? JSON.stringify(c.rubric) : null,
        position: pos,
      });
  }

  deleteCase(suite: string, caseId: string): void {
    this.db.prepare("DELETE FROM suite_cases WHERE suite = ? AND case_id = ?").run(suite, caseId);
  }

  // Build a runnable Suite from the stored cases. Throws if the suite has no
  // cases, since an empty suite is never something you want to run.
  materialize(suite: string): Suite {
    const cases = this.getCases(suite);
    return suiteSchema.parse({ name: suite, cases });
  }

  close(): void {
    this.db.close();
  }
}
