import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { validateServer } from './validation.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
export function signS3({ method, url, payloadHash, accessKey, secretKey, region, sessionToken, now = new Date(), extraHeaders = {} }) {
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = timestamp.slice(0, 8);
  const scope = day + '/' + region + '/s3/aws4_request';
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': timestamp, ...extraHeaders };
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(name => name + ':' + String(headers[name]).trim().replace(/\s+/g, ' ') + '\n').join('');
  const uri = url.pathname.split('/').map(part => encode(decodeURIComponent(part))).join('/');
  const query = [...url.searchParams].map(([key, value]) => [encode(key), encode(value)]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])).map(pair => pair.join('=')).join('&');
  const canonical = [method, uri, query, canonicalHeaders, names.join(';'), payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, hash(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretKey, day), region), 's3'), 'aws4_request');
  headers.Authorization = 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + scope + ',SignedHeaders=' + names.join(';') + ',Signature=' + createHmac('sha256', key).update(stringToSign).digest('hex');
  return headers;
}
async function fileHash(path) { const value = createHash('sha256'); for await (const chunk of createReadStream(path)) value.update(chunk); return value.digest('hex'); }
export function storageConfig(env = process.env) {
  const type = env.REFORGE_STORAGE || 'local';
  if (type === 'local') return { type };
  if (type === 's3') {
    const endpoint = new URL(env.S3_ENDPOINT || 'https://s3.' + (env.S3_REGION || 'us-east-1') + '.amazonaws.com');
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('S3 endpoint must be a plain HTTPS URL');
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET || '')) throw new Error('Invalid S3_BUCKET');
    if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) throw new Error('S3 credentials are required');
    return { type, endpoint: endpoint.href.replace(/\/$/, ''), bucket: env.S3_BUCKET, region: env.S3_REGION || 'us-east-1', accessKey: env.S3_ACCESS_KEY_ID, secretKey: env.S3_SECRET_ACCESS_KEY, sessionToken: env.S3_SESSION_TOKEN };
  }
  if (type === 'sftp') {
    const server = validateServer({ name: 'Backup storage', host: env.SFTP_HOST, user: env.SFTP_USER || 'backup', port: Number(env.SFTP_PORT || 22), keyPath: env.SFTP_KEY_PATH });
    const directory = env.SFTP_DIRECTORY || '';
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(directory) || directory.split('/').includes('..')) throw new Error('SFTP_DIRECTORY must be an absolute path without traversal');
    return { type, server, directory: directory.replace(/\/$/, '') };
  }
  throw new Error('REFORGE_STORAGE must be local, s3 or sftp');
}
function locator(settings, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid backup id');
  if (settings.type === 's3') return { type: 's3', endpoint: settings.endpoint, bucket: settings.bucket, key: 'reforge/' + id + '.rfg' };
  if (settings.type === 'sftp') return { type: 'sftp', host: settings.server.host, directory: settings.directory, file: id + '.rfg' };
  return { type: 'local' };
}
function sftp(settings, commands) {
  const server = settings.server;
  const child = spawn('sftp', ['-b', '-', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-i', server.keyPath, '-P', String(server.port), '--', server.user + '@' + server.host], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  // Do not expose batch output or credentials in errors.
  child.stderr.resume();
  const timer = setTimeout(() => child.kill(), 1800000);
  return new Promise((resolve, reject) => {
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('SFTP transfer failed; check key, fingerprint, directory and permissions')); });
    child.stdin.on('error', () => {});
    child.stdin.end(commands.join('\n') + '\n');
  });
}
function batchPath(path) { if (/[\r\n\0]/.test(path)) throw new Error('Unsafe transfer path'); return '"' + path.replace(/\\/g, '/').replace(/"/g, '\\"') + '"'; }
export function storageFor(settings) {
  async function request(method, location, source) {
    const url = new URL(settings.endpoint + '/' + encode(settings.bucket) + '/' + location.key.split('/').map(encode).join('/'));
    const payloadHash = source ? await fileHash(source) : hash('');
    const headers = signS3({ method, url, payloadHash, ...settings });
    if (source) headers['content-length'] = String((await stat(source)).size);
    const response = await fetch(url, { method, headers, redirect: 'error', signal: AbortSignal.timeout(1800000), ...(source ? { body: createReadStream(source), duplex: 'half' } : {}) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('S3 ' + method + ' failed with HTTP ' + response.status); }
    return response;
  }
  return {
    async put(id, path) {
      const location = locator(settings, id);
      if (settings.type === 's3') {
        if ((await stat(path)).size > 5 * 1024 ** 3) throw new Error('Initial S3 single-object upload supports backups up to 5 GiB');
        const response = await request('PUT', location, path);
        await response.body?.cancel();
      } else if (settings.type === 'sftp') {
        const remote = settings.directory + '/' + location.file;
        await sftp(settings, ['put ' + batchPath(path) + ' ' + batchPath(remote + '.partial'), 'rename ' + batchPath(remote + '.partial') + ' ' + batchPath(remote)]);
      }
      return location;
    },
    async get(id, path, saved) {
      if (!saved || JSON.stringify(locator(settings, id)) !== JSON.stringify(saved) || settings.type === 'local') throw new Error('External backup storage configuration does not match saved snapshot');
      try {
        if (settings.type === 's3') {
          const response = await request('GET', saved);
          let count = 0;
          const limiter = new Transform({ transform(chunk, encoding, callback) { count += chunk.length; callback(count > 20 * 1024 ** 3 + 32 ? new Error('Remote backup exceeds size limit') : null, chunk); } });
          await pipeline(response.body, limiter, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
        } else {
          await sftp(settings, ['get ' + batchPath(settings.directory + '/' + saved.file) + ' ' + batchPath(path)]);
        }
      } catch (error) { await unlink(path).catch(() => {}); throw error; }
    }
  };
}
