import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { InputError, validateProjectPaths, validateHealthChecks } from './validation.js';
import { runRemote, transferDownload, transferUpload } from './ssh.js';
import { encryptStream, decryptFile } from './crypto.js';
export function operationsFor(store, config) {
  const backupDir = join(config.dataDir, 'backups');
  return {
    recover(server, body) {
      const backup = store.get('backups', body.backupId);
      if (!backup) throw new InputError('Backup not found', 404);
      if (server.id === backup.serverId) throw new InputError('Choose a separate recovery target');
      if (body.confirm !== server.name) throw new InputError('Type the target server name to confirm recovery');
      if (!backup.healthChecks?.length) throw new InputError('This snapshot has no application health checks; create a new backup with target-local checks');
      return async event => {
        const staging = await mkdtemp(join(config.dataDir, 'restore-'));
        try {
          const plain = join(staging, 'snapshot.tar');
          event('Authenticating and decrypting snapshot before contacting target');
          await decryptFile(join(backupDir, backup.id + '.rfg'), plain, config.key);
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(plain)) hash.update(chunk);
          event('Requiring an empty target distinct from source machine');
          const evidence = await transferUpload(server, { action: 'recover', backupId: backup.id, sourceMachineId: backup.sourceMachineId, sha256: hash.digest('hex') }, plain);
          store.put('recoveries', { ...evidence, serverId: server.id });
          store.put('backups', { ...backup, recoveryStatus: evidence.passed ? 'verified' : 'failed', lastRecoveryAt: evidence.checkedAt });
          const inventory = await runRemote(server, { action: 'discover' });
          store.put('servers', { ...server, inventory });
          if (!evidence.passed) throw new Error('Restored workloads failed health checks; evidence is saved for diagnosis');
          event('Selected Compose workloads recovered and application checks passed');
          return evidence;
        } finally { await rm(staging, { recursive: true, force: true }); }
      };
    },
    deploy(server, body) {
      if (body.confirm !== server.name) throw new InputError('Type the server name to confirm Ubuntu provisioning');
      const allowedPorts = body.allowedPorts || [];
      if (!Array.isArray(allowedPorts) || allowedPorts.length > 30 || allowedPorts.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw new InputError('Invalid allowed TCP ports');
      return async event => {
        event('Installing Ubuntu packages and configuring SSH, firewall, fail2ban and BBR');
        const result = await runRemote(server, { action: 'deploy', sshPort: server.port, allowedPorts }, { timeout: 1800000 });
        event('Checking a new SSH connection after hardening');
        const inventory = await runRemote(server, { action: 'discover' });
        store.put('servers', { ...server, inventory });
        return result;
      };
    },
    backup(server, body) {
      if (body.confirmDowntime !== true) throw new InputError('Confirm service downtime for a consistent snapshot');
      const paths = validateProjectPaths(body.paths);
      const healthChecks = validateHealthChecks(body.healthChecks || []);
      if (!server.inventory) throw new InputError('Discover the server first');
      return async event => {
        const backupId = randomUUID();
        await mkdir(backupDir, { recursive: true, mode: 0o700 });
        const destination = join(backupDir, backupId + '.rfg');
        let remotePrepared = false;
        try {
          event('Validating Compose coverage and creating database dumps');
          event('Source containers will stop briefly while project files and volumes are captured');
          const summary = await runRemote(server, { action: 'prepare', backupId, paths, healthChecks }, { timeout: 1800000 });
          remotePrepared = true;
          event('Source services restarted. Downloading and encrypting snapshot');
          await transferDownload(server, { action: 'download', backupId }, input => encryptStream(input, destination, config.key));
          const backup = store.put('backups', { id: backupId, serverId: server.id, ...summary, file: backupId + '.rfg', status: 'created', recoveryStatus: 'untested' });
          event('Encrypted snapshot saved; recovery remains untested');
          return { backupId: backup.id, bytes: summary.bytes };
        } catch (error) {
          await unlink(destination).catch(() => {});
          throw error;
        } finally {
          if (remotePrepared) {
            try { await runRemote(server, { action: 'cleanup', backupId }); } catch { event('Remote plaintext snapshot cleanup failed; remove /var/lib/reforge/' + backupId + '.tar manually'); }
          }
        }
      };
    }
  };
}
