import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const contents = example.replace(/^REFORGE_TOKEN=$/m, 'REFORGE_TOKEN=' + randomBytes(32).toString('hex')).replace(/^REFORGE_BACKUP_KEY=$/m, 'REFORGE_BACKUP_KEY=' + randomBytes(32).toString('hex'));
try {
  await writeFile(new URL('../.env', import.meta.url), contents, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with independent authentication and encryption keys. Save the encryption key securely. Open .env to obtain your owner token.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env already exists; it was not modified.');
  else throw error;
}
