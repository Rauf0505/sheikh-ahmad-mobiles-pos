import Database from 'better-sqlite3';

let testDb: Database.Database | null = null;

export function connectTestDb(dbPath: string): Database.Database {
  testDb = new Database(dbPath, { readonly: true });
  return testDb;
}

export function closeTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

export function queryOne<T = any>(db: Database.Database, sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function queryAll<T = any>(db: Database.Database, sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function count(db: Database.Database, table: string, where?: string, ...params: any[]): number {
  const sql = where ? `SELECT COUNT(*) as count FROM ${table} WHERE ${where}` : `SELECT COUNT(*) as count FROM ${table}`;
  const result = db.prepare(sql).get(...params) as { count: number };
  return result.count;
}
