import hashlib
import io
import pathlib
import shutil
import tarfile
import tempfile
import uuid

ROOT = pathlib.Path("/var/lib/reforge")
MAX_ARCHIVE = 20 * 1024 ** 3

def backup_id(value):
    return str(uuid.UUID(value))

def safe_tree(path):
    path = pathlib.Path(path)
    if path.is_symlink():
        raise RuntimeError("Symlinks are not supported in recovery snapshots")
    for directory, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            child = pathlib.Path(directory) / name
            if child.is_symlink() or not (child.is_dir() or child.is_file()):
                raise RuntimeError("Snapshot source contains a symlink or special file")

def resolve_projects(paths):
    details = inventory()
    if details["osId"] != "ubuntu" or not details["compose"]:
        raise RuntimeError("Ubuntu with Docker Compose is required")
    all_ids = run(["docker", "ps", "-aq"]).split()
    all_containers = json.loads(run(["docker", "inspect"] + all_ids)) if all_ids else []
    projects = []
    covered = set()
    captured_volumes = {}
    for index, raw in enumerate(paths):
        directory = pathlib.Path(raw)
        path = str(directory.resolve())
        if path != raw or not directory.is_dir() or directory.is_symlink():
            raise RuntimeError("Project path must be an existing canonical directory")
        members = [c for c in all_containers if (c["Config"].get("Labels") or {}).get("com.docker.compose.project.working_dir") == path]
        if not members:
            raise RuntimeError("Selected directory has no discovered Compose containers")
        labels = members[0]["Config"]["Labels"]
        name = labels["com.docker.compose.project"]
        files = labels.get("com.docker.compose.project.config_files", "").split(",")
        if not files or any(not f or not pathlib.Path(f).resolve().is_relative_to(directory) for f in files):
            raise RuntimeError("Compose files must be inside the selected project directory")
        compose_args = ["docker", "compose", "--project-directory", path, "-p", name]
        for file in files:
            compose_args += ["-f", file]
        config = json.loads(run(compose_args + ["config", "--format", "json"]))
        if any(network.get("external") for network in config.get("networks", {}).values()):
            raise RuntimeError("External Docker networks need a separate recovery plan")
        if any(volume.get("external") for volume in config.get("volumes", {}).values()):
            raise RuntimeError("External volumes are not supported by this snapshot format")
        pins = {}
        for service, settings in config["services"].items():
            service_containers = [c for c in members if c["Config"]["Labels"].get("com.docker.compose.service") == service]
            if not service_containers:
                raise RuntimeError("Every Compose service must have an existing container")
            image_info = json.loads(run(["docker", "image", "inspect", service_containers[0]["Image"]]))[0]
            digests = image_info.get("RepoDigests") or []
            if not digests:
                raise RuntimeError("Every service needs a registry image with a digest; publish locally built images first")
            pins[service] = digests[0]
            settings["image"] = digests[0]
            settings.pop("build", None)
            settings.pop("pull_policy", None)
            for mount in settings.get("volumes", []):
                if mount.get("type") == "bind":
                    source = pathlib.Path(mount["source"]).resolve()
                    if not source.is_relative_to(directory):
                        raise RuntimeError("Bind mount outside selected project: " + str(source))
                    mount["source"] = {"projectRelative": str(source.relative_to(directory))}
            for section in ["configs", "secrets"]:
                for item in settings.get(section, []):
                    # Service references are resolved against top-level definitions below.
                    if not isinstance(item, (str, dict)):
                        raise RuntimeError("Unsupported Compose secret/config reference")
        for section in ["configs", "secrets"]:
            for entry in config.get(section, {}).values():
                if entry.get("external") or entry.get("environment"):
                    raise RuntimeError("External or environment-backed Compose secrets/configs need a separate recovery plan")
                if "file" in entry:
                    file = pathlib.Path(entry["file"]).resolve()
                    if not file.is_relative_to(directory):
                        raise RuntimeError("Secret/config file outside selected project")
                    entry["file"] = {"projectRelative": str(file.relative_to(directory))}
        for container in members:
            if container["State"]["Status"] not in ["running", "exited", "created"]:
                raise RuntimeError("Container has unsupported state; resolve before backup")
            covered.add(container["Id"])
            for mount in container.get("Mounts", []):
                if mount["Type"] == "bind":
                    if not pathlib.Path(mount["Source"]).resolve().is_relative_to(directory):
                        raise RuntimeError("Container bind mount lies outside its project")
                elif mount["Type"] == "volume":
                    volume = json.loads(run(["docker", "volume", "inspect", mount["Name"]]))[0]
                    if not (volume.get("Labels") or {}).get("com.docker.compose.volume"):
                        raise RuntimeError("Anonymous volumes are not supported; declare named Compose volumes")
                    if volume["Driver"] != "local" or volume.get("Options"):
                        raise RuntimeError("Only default local Docker volumes are supported")
                    if volume["Name"] not in captured_volumes:
                        captured_volumes[volume["Name"]] = {"name": volume["Name"], "mountpoint": volume["Mountpoint"], "archive": "volumes/" + str(len(captured_volumes))}
                elif mount["Type"] != "tmpfs":
                    raise RuntimeError("Unsupported container mount")
        projects.append({"index": index, "name": name, "sourcePath": path, "config": config, "imagePins": pins, "containers": members})
    # Shared volumes with nonselected workloads cannot be captured consistently.
    for container in all_containers:
        if container["Id"] not in covered and any(m.get("Name") in captured_volumes for m in container.get("Mounts", [])):
            raise RuntimeError("Volume is shared with a workload outside the snapshot")
    warnings = list(details["warnings"])
    if any(c["Id"] not in covered for c in all_containers):
        warnings.append("Some Docker workloads are outside selected projects")
    running = [c["Id"] for p in projects for c in p["containers"] if c["State"]["Running"]]
    return details, projects, list(captured_volumes.values()), running, warnings

def database_dumps(projects, destination):
    output = []
    for project in projects:
        for container in project["containers"]:
            image = container["Config"]["Image"].lower()
            env = dict(v.split("=", 1) for v in container["Config"].get("Env", []) if "=" in v)
            args = None
            engine = None
            if "postgres" in image and container["State"]["Running"]:
                engine = "postgresql"
                args = ["docker", "exec", "-e", "PGPASSWORD=" + env.get("POSTGRES_PASSWORD", ""), container["Id"], "pg_dumpall", "--no-password", "-U", env.get("POSTGRES_USER", "postgres")]
            elif ("mysql" in image or "mariadb" in image) and container["State"]["Running"]:
                engine = "mysql"
                password = env.get("MYSQL_ROOT_PASSWORD", env.get("MARIADB_ROOT_PASSWORD", ""))
                binary = "mariadb-dump" if "mariadb" in image else "mysqldump"
                args = ["docker", "exec", "-e", "MYSQL_PWD=" + password, container["Id"], binary, "-uroot", "--all-databases", "--single-transaction", "--routines", "--events"]
            if args:
                filename = container["Id"][:12] + ".sql"
                with open(destination / filename, "wb") as stream:
                    result = subprocess.run(args, stdout=stream, stderr=subprocess.PIPE, timeout=600)
                if result.returncode:
                    raise RuntimeError("Database dump failed; inspect database credentials on source")
                output.append({"service": container["Config"]["Labels"].get("com.docker.compose.service"), "engine": engine, "file": "dumps/" + filename})
    return output

def prepare_snapshot(payload):
    ident = backup_id(payload["backupId"])
    details, projects, volumes, running, warnings = resolve_projects(payload["paths"])
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    archive = ROOT / (ident + ".tar")
    if archive.exists():
        raise RuntimeError("Backup id already exists")
    manifest = {"version": 1, "backupId": ident, "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceMachineId": details["machineId"], "scope": "selected-compose-projects",
        "projects": [{k: v for k, v in p.items() if k != "containers"} for p in projects],
        "volumes": volumes, "warnings": warnings, "healthChecks": payload["healthChecks"]}
    stopped = False
    try:
        with tempfile.TemporaryDirectory(prefix="stage-", dir=ROOT) as stage:
            dumps = pathlib.Path(stage) / "dumps"
            dumps.mkdir(mode=0o700)
            manifest["databaseDumps"] = database_dumps(projects, dumps)
            for project in projects:
                safe_tree(project["sourcePath"])
            # Stop before scanning volumes; DB files may be transient while online.
            if running:
                stopped = True
                run(["docker", "stop", "-t", "60"] + running, timeout=180)
            for volume in volumes:
                safe_tree(volume["mountpoint"])
            with tarfile.open(archive, "w", dereference=True) as tar:
                data = json.dumps(manifest).encode()
                member = tarfile.TarInfo("manifest.json")
                member.size = len(data)
                member.mode = 0o600
                tar.addfile(member, io.BytesIO(data))
                for project in projects:
                    tar.add(project["sourcePath"], arcname="projects/" + str(project["index"]))
                for volume in volumes:
                    tar.add(volume["mountpoint"], arcname=volume["archive"])
                tar.add(dumps, arcname="dumps")
            os.chmod(archive, 0o600)
            if archive.stat().st_size > MAX_ARCHIVE:
                raise RuntimeError("Snapshot exceeds the initial 20 GiB size limit")
    except Exception:
        archive.unlink(missing_ok=True)
        raise
    finally:
        if stopped:
            run(["docker", "start"] + running, timeout=180)
    # Never return resolved Compose configs: they contain environment secrets.
    return {"backupId": ident, "bytes": archive.stat().st_size, "createdAt": manifest["createdAt"],
        "sourceMachineId": manifest["sourceMachineId"], "projects": [{"name": p["name"], "path": p["sourcePath"], "images": p["imagePins"]} for p in projects],
        "volumes": [v["name"] for v in volumes], "databaseDumps": manifest["databaseDumps"],
        "warnings": warnings, "healthChecks": payload["healthChecks"], "scope": manifest["scope"]}

def stream_snapshot(payload):
    archive = ROOT / (backup_id(payload["backupId"]) + ".tar")
    with archive.open("rb") as source:
        shutil.copyfileobj(source, sys.stdout.buffer)
    return None

def cleanup_snapshot(payload):
    (ROOT / (backup_id(payload["backupId"]) + ".tar")).unlink(missing_ok=True)
    return {"cleaned": True}
