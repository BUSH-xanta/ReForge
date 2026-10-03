import time
import urllib.error
import urllib.parse
import urllib.request

def validate_members(members):
    seen = set()
    size = 0
    if len(members) > 200000:
        raise RuntimeError("Too many archive entries")
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] not in ["manifest.json", "projects", "volumes", "dumps"]:
            raise RuntimeError("Unsafe archive path")
        if member.name in seen:
            raise RuntimeError("Duplicate archive entry")
        seen.add(member.name)
        if not (member.isfile() or member.isdir()):
            raise RuntimeError("Links and special files are not supported")
        size += member.size
        if size > MAX_ARCHIVE:
            raise RuntimeError("Unpacked archive exceeds limit")

def clean_target(source_machine_id):
    data = inventory()
    if data["machineId"] == source_machine_id:
        raise RuntimeError("Recovery to the source machine is forbidden")
    if data["osId"] != "ubuntu" or not data["compose"]:
        raise RuntimeError("Prepare an Ubuntu target with Docker Compose first")
    if data["containers"] or data["volumes"] or data["hostDatabases"]:
        raise RuntimeError("Recovery target must have no containers, volumes or host databases")
    destination = pathlib.Path("/opt/reforge")
    if destination.exists() and any(destination.iterdir()):
        raise RuntimeError("Target already contains recovery files")
    if ROOT.exists() and any(p.name.startswith("restore-") for p in ROOT.iterdir()):
        raise RuntimeError("Target has a previous recovery attempt; inspect before retrying")
    return data

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def health_check(check):
    parsed = urllib.parse.urlparse(check["url"])
    if parsed.scheme not in ["http", "https"] or parsed.hostname not in ["localhost", "127.0.0.1", "::1"] or parsed.username or parsed.password:
        raise RuntimeError("Recovery check must address target localhost")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        response = opener.open(check["url"], timeout=5)
        status = response.status
        response.close()
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
    except (urllib.error.URLError, TimeoutError, OSError):
        status = None
    return {"url": check["url"], "expected": check["status"], "actual": status, "passed": status == check["status"]}

def remap_config(config, destination):
    for service in config["services"].values():
        for mount in service.get("volumes", []):
            if mount.get("type") == "bind":
                source = (destination / mount["source"]["projectRelative"]).resolve()
                if not source.is_relative_to(destination):
                    raise RuntimeError("Unsafe bind mount")
                mount["source"] = str(source)
    for section in ["secrets", "configs"]:
        for definition in config.get(section, {}).values():
            if "file" in definition:
                source = (destination / definition["file"]["projectRelative"]).resolve()
                if not source.is_relative_to(destination):
                    raise RuntimeError("Unsafe config path")
                definition["file"] = str(source)
    return config

def recover_snapshot(payload):
    ident = backup_id(payload["backupId"])
    clean_target(payload["sourceMachineId"])
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    stage = ROOT / ("restore-" + ident)
    stage.mkdir(mode=0o700)
    archive = stage / "snapshot.tar"
    started = time.monotonic()
    try:
        total = 0
        digest = hashlib.sha256()
        with archive.open("xb") as stream:
            os.chmod(archive, 0o600)
            while True:
                chunk = sys.stdin.buffer.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_ARCHIVE:
                    raise RuntimeError("Uploaded archive exceeds limit")
                digest.update(chunk)
                stream.write(chunk)
        if digest.hexdigest() != payload["sha256"]:
            raise RuntimeError("Uploaded archive checksum mismatch")
        unpack = stage / "unpack"
        unpack.mkdir(mode=0o700)
        with tarfile.open(archive, "r:") as tar:
            members = []
            for member in tar:
                members.append(member)
                if len(members) > 200000:
                    raise RuntimeError("Too many archive entries")
            validate_members(members)
            manifest_file = tar.extractfile("manifest.json")
            if manifest_file is None:
                raise RuntimeError("Missing recovery manifest")
            manifest = json.load(manifest_file)
            if manifest.get("version") != 1 or manifest.get("backupId") != ident or manifest.get("sourceMachineId") != payload["sourceMachineId"]:
                raise RuntimeError("Recovery manifest does not match backup")
            if not manifest.get("healthChecks"):
                raise RuntimeError("Application HTTP health checks are required")
            tar.extractall(unpack, members=members, numeric_owner=True, filter="fully_trusted")
        destination_root = pathlib.Path("/opt/reforge")
        destination_root.mkdir(mode=0o700, exist_ok=True)
        commands = []
        for project in manifest["projects"]:
            destination = destination_root / str(project["index"])
            shutil.move(str(unpack / "projects" / str(project["index"])), destination)
            config = remap_config(project["config"], destination)
            compose_path = destination / "reforge.recovery.json"
            compose_path.write_text(json.dumps(config))
            os.chmod(compose_path, 0o600)
            command = ["docker", "compose", "--project-directory", str(destination), "-p", project["name"], "-f", str(compose_path)]
            run(command + ["create", "--no-build"], timeout=900)
            commands.append(command)
        for volume in manifest["volumes"]:
            value = json.loads(run(["docker", "volume", "inspect", volume["name"]]))[0]
            target = pathlib.Path(value["Mountpoint"])
            source = unpack / volume["archive"]
            for child in target.iterdir():
                if child.is_dir() and not child.is_symlink():
                    shutil.rmtree(child)
                else:
                    child.unlink()
            for child in source.iterdir():
                shutil.move(str(child), target / child.name)
            os.chown(target, source.stat().st_uid, source.stat().st_gid)
            os.chmod(target, source.stat().st_mode & 0o7777)
        for command in commands:
            run(command + ["up", "-d", "--no-build"], timeout=300)
        deadline = time.monotonic() + 180
        services, checks = [], []
        while time.monotonic() < deadline:
            services = []
            for command in commands:
                ids = run(command + ["ps", "-aq"]).split()
                if not ids:
                    raise RuntimeError("No restored containers")
                for item in json.loads(run(["docker", "inspect"] + ids)):
                    health = (item["State"].get("Health") or {}).get("Status")
                    services.append({"name": item["Name"].lstrip("/"), "state": item["State"]["Status"], "health": health,
                        "passed": item["State"]["Running"] and health in [None, "healthy"]})
            checks = [health_check(check) for check in manifest["healthChecks"]]
            if all(s["passed"] for s in services) and all(c["passed"] for c in checks):
                break
            time.sleep(3)
        passed = bool(services) and all(s["passed"] for s in services) and all(c["passed"] for c in checks)
        return {"passed": passed, "backupId": ident, "targetMachineId": pathlib.Path("/etc/machine-id").read_text().strip(),
            "checkedAt": datetime.now(timezone.utc).isoformat(), "durationSeconds": round(time.monotonic() - started),
            "scope": manifest["scope"], "warnings": manifest["warnings"], "services": services, "checks": checks, "restorePath": str(destination_root)}
    finally:
        shutil.rmtree(stage, ignore_errors=True)
