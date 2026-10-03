# Operator guide

## Start

Run Node.js 24+ and an OpenSSH client on the control-plane host:

```sh
npm run setup
npm start
```

Open http://127.0.0.1:8787 and enter REFORGE_TOKEN from .env. setup refuses to overwrite an existing .env. Keep REFORGE_BACKUP_KEY separately: losing it makes archives unrecoverable. Archive encryption does not protect the control-plane SQLite inventory; restrict access to its data directory.

The server needs Python 3, root or passwordless sudo. Independently verify the SSH host fingerprint and populate the known_hosts belonging to the user running ReForge. Unknown and changed host keys fail closed.

The web UI stores the token in sessionStorage for the tab. Use an SSH tunnel or an HTTPS reverse proxy if accessing the UI remotely. API requests use Authorization: Bearer TOKEN. Do not put tokens in URLs.

## Deploy

Automatic provisioning currently targets Ubuntu 24.04. Discover can inspect other Ubuntu versions.

Deploy installs Docker/Compose, UFW and fail2ban, disables password and keyboard-interactive SSH, keeps root key authentication, enables BBR when supported, and checks a new SSH connection afterward. Enter every public TCP service port you need. Existing UFW rules stay in place.

Docker-published ports can bypass UFW rules through Docker networking. ReForge does not provide a Docker forwarding-chain firewall in this release; review published ports or use a provider firewall. UDP rules are operator-managed.

The operation is not transactional: if it fails, earlier package or firewall changes may already have happened. Read the job and inspect the server before retrying.

## Discover → Protect

Discover lists Docker containers, Compose projects, volume names, ports, domain labels and detected PostgreSQL/MySQL/MariaDB services. It never returns container environment values.

Backup selects existing project directories under /opt, /srv or /home. Supported workloads use default local named volumes, files inside their project directory, and registry images with digests. Compose configurations are rendered and images pinned in the manifest.

ReForge creates logical dumps for running recognized database containers, then briefly stops all running selected containers. It captures project files (including .env), cold volume contents and dumps into a tar archive, then restarts only the containers it stopped. Failed backup operations also attempt source restart.

The dump and cold snapshot are captured at different times; recovery uses cold volume contents. SQL dumps are an additional export, not automatically imported or cross-version tested.

Unsupported inputs fail rather than being silently skipped: external volumes/networks, anonymous volumes, bind mounts outside project directories, symlinks/special files, and unpublished locally built images. Existing host databases and unselected workloads are reported as uncovered.

Snapshots are AES-256-GCM encrypted at rest on the control plane. Plaintext temporarily exists on the source in /var/lib/reforge and on the control plane during authenticated recovery, with restrictive permissions. Normal completion cleans it up. After a power loss or forced termination, inspect those temporary directories. Provision enough free space for source tar, encrypted local archive and recovery staging.

Initial archive limit is 20 GiB. No automatic retention deletion is implemented.

## Storage

REFORGE_STORAGE=local keeps archives under data/backups. s3 and sftp mirror each encrypted archive and retain the local copy. A mirror failure retains that local backup and fails the job with a replication warning.

S3 uses HTTPS, path-style bucket requests and Signature V4. Configure endpoint, bucket, region and credentials in .env. Initial single-object upload limit is 5 GiB; multipart upload is not implemented. Signing is tested against the [published AWS example](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html).

SFTP needs an existing writable remote directory and a separately verified host key in known_hosts. Upload uses a .partial name and renames it after completion.

If a local file is missing, recovery retrieves it using the persisted external location and matching current storage configuration, then authenticates it before uploading to a target. Preserve SQLite along with the encryption key; external archives do not replicate the control-plane registry.

## Recover

Add a separate empty Ubuntu target, prepare Docker/Compose, then choose a backup and type the target name. Recovery refuses the source machine (checked by machine-id), any existing containers/volumes/host databases, and existing ReForge restore files.

At least one application HTTP check on target localhost is required. Redirects and HTTP proxies are disabled so tests cannot silently follow a URL to production. TLS certificate validation remains enabled. Localhost checks requiring production host headers or private-CA HTTPS are not yet supported.

Authenticated archives are checksum-verified during upload; paths, duplicate entries, links and special files are rejected before extraction. Compose services are created, volume contents installed, and services started. The test waits up to three minutes for running containers, Docker healthchecks where defined, and declared HTTP responses.

A passing result verifies **only the selected Compose scope** for that exact backup. It does not verify DNS, host configuration, unselected workloads or external services. A service without its own Docker healthcheck is checked only for running state; add application checks for meaningful coverage.

Recovery workloads remain on the target after success or failure, for inspection. Disposable VPS creation and teardown are operator-managed. A repeat test requires a fresh empty target; ReForge will not erase an existing target.

## Scheduling and Telegram

The backup dialog optionally enables a daily 03:00 schedule in REFORGE_TIMEZONE (Europe/Moscow by default). Enabling it explicitly authorizes the same service downtime on daily runs. It runs once per local calendar date, catches up after that day's scheduled time on restart, and waits if another job is active. Failed scheduled runs are not automatically repeated that day. Disable a schedule from the server details.

Telegram is opt-in through TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. Start the bot or add it to the configured chat first. Notifications report job ids and status; delivery failures are recorded without changing the operation result.

Only one control-plane process may manage a given registry. Operations run serially, jobs and events survive restart, and interrupted jobs become failed/unknown instead of being replayed. Graceful shutdown waits for active operations; forced termination cannot guarantee source cleanup or restart.

## Docker

Set SSH_DIRECTORY in .env to an existing directory, then run docker compose up --build -d. Keys and known_hosts are mounted read-only at /home/node/.ssh. When registering a server, use its container key path. The node user (uid 1000) needs read access to those files, while OpenSSH still requires restrictive key permissions. Verify ownership before running.

## Validation status

Automated Node and Python tests cover configuration, authentication, registry persistence, concurrency, daily scheduling, encryption/authentication, signing and unsafe recovery refusal. The web UI is checked locally.

Real source-VPS backup → separate target restore, package installation, S3/SFTP live transfers and Telegram delivery require operator-provided infrastructure and credentials. Until that integration run passes, treat this as an initial implementation, not a production recovery guarantee.
