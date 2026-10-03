# ReForge

A control plane for small VPS infrastructure: **Deploy → Discover → Protect → Recover**.

ReForge treats a backup and a verified recovery as different states. Recovery evidence belongs to a particular backup, destination and set of checks.

## Development

Requires Node.js 24+ and OpenSSH client. No npm dependencies.

```sh
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Set REFORGE_TOKEN and REFORGE_BACKUP_KEY in .env (use separate generated values).
npm start
```

Open http://127.0.0.1:8787. Keep the control plane on loopback or behind your authenticated HTTPS proxy. SSH keys stay on the control-plane host; the database stores only their file paths. Verify a server fingerprint independently and add it to your SSH known_hosts before connecting.

## Implementation plan

- [ ] Persistent server registry, authenticated API and background jobs.
- [ ] Strict SSH host-key verification and Ubuntu/Docker inventory.
- [ ] Ubuntu provisioning with SSH hardening, UFW, fail2ban, BBR and Docker.
- [ ] Encrypted local recovery snapshots for explicitly selected Compose projects.
- [ ] Clean-target recovery with healthcheck evidence.
- [ ] Web dashboard.
- [ ] S3/SFTP storage and Telegram notifications.

The initial scope is single-owner, one control-plane process and Ubuntu Compose workloads. Full recovery requires access to a disposable Ubuntu target. Infrastructure changes, DNS switching and external managed databases need separate coordination.
