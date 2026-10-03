import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'reforge.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));`);
    for (const job of this.list('jobs')) {
      if (['queued', 'running'].includes(job.status)) this.put('jobs', { ...job, status: 'failed', endedAt: new Date().toISOString(), error: 'Control plane restarted; job outcome is unknown. Inspect target before retrying.' });
    }
  }
  list(kind) { return this.db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(row => JSON.parse(row.payload)); }
  get(kind, id) { const row = this.db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.payload) : null; }
  put(kind, record) {
    const value = { ...record, id: record.id || randomUUID() };
    this.db.prepare('INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload').run(kind, value.id, JSON.stringify(value));
    return value;
  }
  close() { this.db.close(); }
}
