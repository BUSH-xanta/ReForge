# ReForge

A self-hosted control plane for small VPS infrastructure.

**Deploy → Discover → Protect → Recover**

A backup is not a recovery guarantee. ReForge records evidence from a separate target: restored containers, Docker healthchecks and application HTTP checks, tied to the exact snapshot.

![ReForge dashboard](docs/screenshots/dashboard.png)

## Run locally

Requires Node.js 24+ and an OpenSSH client. No npm dependencies.

```sh
npm run setup
npm start
```

Open **http://127.0.0.1:8787** and use the owner token from the generated .env. Setup generates separate authentication and encryption keys and never overwrites an existing configuration.

Save the encryption key securely. SSH private keys remain on the control-plane host; the registry stores their paths. Independently verify each server fingerprint and add it to your known_hosts.

Remote servers need Python 3 and root/passwordless sudo. Automatic provisioning currently supports **Ubuntu 24.04**.

## Implemented

| Direction | Initial implementation |
|---|---|
| DEPLOY | Docker/Compose, SSH key-only access, UFW, fail2ban, optional BBR; new SSH connection check |
| DISCOVER | Ubuntu inventory, Docker/Compose projects, containers, named volumes, ports, domain labels, PostgreSQL/MySQL detection |
| PROTECT | Consistent cold volume snapshots, project files and .env, database dumps, image digest pins, AES-256-GCM encryption |
| STORAGE | Local archives, S3 or SFTP encrypted mirrors, remote retrieval when a local snapshot is missing |
| RECOVER | Distinct empty-target enforcement, authenticated archive, safe extraction, Compose/volume restore, healthcheck evidence |
| CONTROL | Web dashboard, owner-token API, SQLite jobs/events, explicit daily backup schedules and Telegram notifications |

The initial recovery scope is **selected Docker Compose projects**. Cold snapshots briefly stop selected services; the UI requires acknowledgement. Recovery tests need a separate empty target, which remains running afterward.

No readiness percentage or estimated recovery duration is fabricated. The UI shows the actual test status and measured duration.

## Limits

Initial snapshots support default local named volumes and project-local files. External bind mounts, external volumes/networks, anonymous volumes, symlinks/special files and unpublished local images are rejected. Host services, DNS and external managed databases are not restored.

Local/SFTP archives are limited to 20 GiB; the initial S3 implementation supports single-object uploads up to 5 GiB. No automatic retention deletion or disposable-VPS lifecycle is implemented. Only one control-plane process may use a registry.

Preserve the registry and encryption key separately from the external archives. The full manifest lives inside the encrypted tar and contains sensitive rendered Compose configuration.

## Validation

```sh
npm test
npm run check
python -m unittest discover -s test -p 'test_*.py'
```

Node/Python tests cover API authentication, persistence, job concurrency, scheduling, encryption/tampering, the AWS signing example, unsafe archive rejection, source-target refusal, and source restart after snapshot failure. CI also builds the Docker image.

The dashboard is checked locally. A real source VPS → separate recovery target run, live S3/SFTP transfer and Telegram delivery still need infrastructure credentials. This is an initial implementation; production recovery has not yet been demonstrated.

See [the operator guide](docs/operations.md) for deployment, storage settings, coverage and recovery details.
