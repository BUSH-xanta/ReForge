import { resolve } from 'node:path';
export function config(env = process.env) {
  const token = env.REFORGE_TOKEN || '';
  const key = env.REFORGE_BACKUP_KEY || '';
  if (token.length < 32) throw new Error('REFORGE_TOKEN must contain at least 32 characters');
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('REFORGE_BACKUP_KEY must be 64 hex characters');
  const port = Number(env.REFORGE_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid REFORGE_PORT');
  const timezone = env.REFORGE_TIMEZONE || 'Europe/Moscow';
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
  return { token, key: Buffer.from(key, 'hex'), host: env.REFORGE_HOST || '127.0.0.1', port, timezone, dataDir: resolve(env.REFORGE_DATA_DIR || 'data') };
}
