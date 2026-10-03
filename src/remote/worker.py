"""Root-only operations invoked by the control plane over a strict OpenSSH connection."""
import base64
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone

def run(args, timeout=45, optional=False):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode and not optional:
        raise RuntimeError("Command failed: " + args[0])
    return result.stdout.strip()

def docker_json(args):
    output = run(["docker"] + args)
    return [json.loads(line) for line in output.splitlines() if line.strip()]

def inventory():
    release = {}
    with open("/etc/os-release") as stream:
        for line in stream:
            if "=" in line:
                key, value = line.strip().split("=", 1)
                release[key] = value.strip('"')
    docker_available = subprocess.run(["sh", "-c", "command -v docker"], capture_output=True).returncode == 0
    containers, volumes, projects, warnings = [], [], [], []
    compose = False
    if docker_available:
        # Failure to access Docker is a failed inventory, not an empty successful result.
        ids = run(["docker", "ps", "-aq"]).split()
        details = json.loads(run(["docker", "inspect"] + ids)) if ids else []
        compose = subprocess.run(["docker", "compose", "version"], capture_output=True).returncode == 0
        for item in details:
            labels = item["Config"].get("Labels") or {}
            image = item["Config"]["Image"]
            lowered = image.lower()
            database = "postgresql" if "postgres" in lowered else ("mysql" if "mysql" in lowered or "mariadb" in lowered else None)
            containers.append({
                "id": item["Id"][:12], "name": item["Name"].lstrip("/"), "image": image,
                "state": item["State"]["Status"],
                "health": (item["State"].get("Health") or {}).get("Status"),
                "project": labels.get("com.docker.compose.project"),
                "service": labels.get("com.docker.compose.service"), "database": database,
                "ports": item["NetworkSettings"].get("Ports") or {},
                "mounts": [{"type": m["Type"], "source": m["Source"], "destination": m["Destination"], "name": m.get("Name")} for m in item.get("Mounts", [])],
                "domains": [v for k, v in labels.items() if (k.endswith(".rule") and "Host(" in v) or k == "traefik.frontend.rule"]
            })
            workdir = labels.get("com.docker.compose.project.working_dir")
            if workdir and workdir not in [p["path"] for p in projects]:
                projects.append({"name": labels.get("com.docker.compose.project"), "path": workdir, "configFiles": labels.get("com.docker.compose.project.config_files", "")})
        volume_names = run(["docker", "volume", "ls", "-q"]).split()
        if volume_names:
            volumes = [{"name": v["Name"], "driver": v["Driver"], "labels": v.get("Labels") or {}} for v in json.loads(run(["docker", "volume", "inspect"] + volume_names))]
        if any(not c["project"] for c in containers):
            warnings.append("Standalone Docker containers are not covered by Compose recovery")
    host_databases = []
    for service in ["postgresql", "mysql", "mariadb"]:
        result = subprocess.run(["systemctl", "is-active", service], capture_output=True, text=True)
        if result.returncode == 0:
            host_databases.append(service)
    if host_databases:
        warnings.append("Host database services require separate backup coverage")
    return {
        "collectedAt": datetime.now(timezone.utc).isoformat(), "hostname": platform.node(),
        "machineId": open("/etc/machine-id").read().strip(), "os": release.get("PRETTY_NAME"), "osId": release.get("ID"),
        "kernel": platform.release(), "uptimeSeconds": float(open("/proc/uptime").read().split()[0]),
        "docker": docker_available, "compose": compose, "containers": containers, "volumes": volumes,
        "projects": projects, "hostDatabases": host_databases, "warnings": warnings,
        "listeningPorts": run(["ss", "-lntu"], optional=True),
        "bbr": run(["sysctl", "-n", "net.ipv4.tcp_congestion_control"], optional=True)
    }

def main(payload):
    if payload["action"] == "discover":
        return inventory()
    if payload["action"] == "deploy":
        return deploy(payload)
    if payload["action"] == "prepare":
        return prepare_snapshot(payload)
    if payload["action"] == "download":
        return stream_snapshot(payload)
    if payload["action"] == "cleanup":
        return cleanup_snapshot(payload)
    raise RuntimeError("Unknown operation")

if __name__ == "__main__":
    try:
        payload = json.loads(base64.b64decode(sys.argv[1]))
        result = main(payload)
        if result is not None:
            print(json.dumps(result))
    except Exception as error:
        # Do not print subprocess output: it may contain credentials.
        print("ReForge: " + str(error), file=sys.stderr)
        sys.exit(1)
