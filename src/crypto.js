import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
const MAGIC = Buffer.from('RFG1');
const MAX_BYTES = 20 * 1024 ** 3;
export async function encryptStream(input, destination, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(MAGIC);
  // Exclusive creation happens before cleanup ownership, so an existing snapshot is never deleted.
  const destinationHandle = await open(destination, 'wx', 0o600);
  const output = destinationHandle.createWriteStream();
  output.write(Buffer.concat([MAGIC, nonce]));
  let bytes = 0;
  const counter = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    callback(bytes > MAX_BYTES ? new Error('Backup exceeds 20 GiB limit') : null, chunk);
  } });
  try {
    await pipeline(input, counter, cipher, output, { end: false });
    await new Promise((resolve, reject) => { output.once('error', reject); output.end(cipher.getAuthTag(), resolve); });
    return bytes;
  } catch (error) { output.destroy(); await unlink(destination).catch(() => {}); throw error; }
}
export async function decryptFile(source, destination, key) {
  const info = await stat(source);
  if (info.size < 32 || info.size > MAX_BYTES + 32) throw new Error('Invalid encrypted snapshot size');
  const handle = await open(source, 'r');
  const header = Buffer.alloc(16), tag = Buffer.alloc(16);
  try { await handle.read(header, 0, 16, 0); await handle.read(tag, 0, 16, info.size - 16); } finally { await handle.close(); }
  if (!header.subarray(0, 4).equals(MAGIC)) throw new Error('Invalid snapshot format');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(4));
  decipher.setAAD(MAGIC); decipher.setAuthTag(tag);
  const destinationHandle = await open(destination, 'wx', 0o600);
  try {
    await pipeline(createReadStream(source, { start: 16, end: info.size - 17 }), decipher, destinationHandle.createWriteStream());
  } catch (error) { await unlink(destination).catch(() => {}); throw new Error('Snapshot authentication failed; key is incorrect or backup was modified'); }
}
