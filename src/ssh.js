import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export function sshArgs(server) {
  return ['-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    '-i', server.keyPath, '-p', String(server.port), '--', server.user + '@' + server.host];
}
export async function remoteSource() {
  const parts = await Promise.all(['deploy.py', 'snapshot.py', 'worker.py'].map(file => readFile(fileURLToPath(new URL('./remote/' + file, import.meta.url)), 'utf8')));
  return parts.join('\n').replace(/^\uFEFF/gm, '');
}
export function commandFor(source, payload) {
  const code = Buffer.from(source).toString('base64');
  const args = Buffer.from(JSON.stringify(payload)).toString('base64');
  // Base64 uses no shell metacharacters; remote command contains only fixed code and encoded data.
  return `sudo -n python3 -c 'import base64;exec(compile(base64.b64decode("${code}"),"<reforge>","exec"))' '${args}'`;
}
export async function runRemote(server, payload, options = {}) {
  const source = await remoteSource();
  const child = spawn('ssh', [...sshArgs(server), commandFor(source, payload)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const limit = options.limit || 8 * 1024 * 1024;
  const chunks = []; let size = 0; let stderr = '';
  const timer = setTimeout(() => child.kill(), options.timeout || 120_000);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > limit) child.kill(); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || size > limit) reject(new Error(size > limit ? 'Remote output limit exceeded' : 'SSH operation failed. Check host fingerprint, key, sudo and remote prerequisites. ' + stderr.replace(/[^\x20-\x7e\n]/g, '').slice(-1200)));
      else resolve(Buffer.concat(chunks));
    });
  });
  child.stdin.end();
  const raw = await done;
  try { return JSON.parse(raw.toString()); } catch { throw new Error('Invalid response from remote worker'); }
}

export async function transferDownload(server, payload, consume) {
  const child = spawn('ssh', [...sshArgs(server), commandFor(await remoteSource(), payload)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-1200); });
  const timer = setTimeout(() => child.kill(), 1800000);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Snapshot transfer failed: ' + stderr)));
  });
  done.catch(() => {});
  child.stdin.end();
  try { await consume(child.stdout); await done; } catch (error) { child.kill(); throw error; } finally { clearTimeout(timer); }
}
