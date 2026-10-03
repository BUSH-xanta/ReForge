import pathlib
import shutil

def deploy(payload):
    release = {}
    for line in pathlib.Path("/etc/os-release").read_text().splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            release[key] = value.strip('"')
    if release.get("ID") != "ubuntu" or release.get("VERSION_ID") != "24.04":
        raise RuntimeError("Automatic provisioning currently supports Ubuntu 24.04 only")
    ssh_port = str(int(payload["sshPort"]))
    actual_port = os.environ.get("SSH_CONNECTION", "").split()
    if not actual_port or actual_port[-1] != ssh_port:
        raise RuntimeError("Configured SSH port differs from the active connection")
    env = dict(os.environ, DEBIAN_FRONTEND="noninteractive")
    for command in [["apt-get", "update"], ["apt-get", "install", "-y", "docker.io", "docker-compose-v2", "ufw", "fail2ban"]]:
        result = subprocess.run(command, capture_output=True, env=env, timeout=900)
        if result.returncode:
            raise RuntimeError("Ubuntu package installation failed")
    run(["systemctl", "enable", "--now", "docker", "fail2ban"], timeout=90)
    path = pathlib.Path("/etc/ssh/sshd_config.d/00-reforge.conf")
    previous = path.read_bytes() if path.exists() else None
    path.write_text("PubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\nMaxAuthTries 3\nX11Forwarding no\n")
    checked = subprocess.run(["/usr/sbin/sshd", "-t"], capture_output=True)
    if checked.returncode:
        if previous is None:
            path.unlink()
        else:
            path.write_bytes(previous)
        raise RuntimeError("sshd configuration validation failed; previous config preserved")
    effective = run(["/usr/sbin/sshd", "-T"]).splitlines()
    if "passwordauthentication no" not in effective or "kbdinteractiveauthentication no" not in effective:
        raise RuntimeError("Existing SSH settings override hardening; resolve before enabling firewall")
    fail2ban = pathlib.Path("/etc/fail2ban/jail.d/reforge.local")
    fail2ban.write_text("[sshd]\nenabled = true\nbackend = systemd\nport = " + ssh_port + "\n")
    run(["systemctl", "restart", "fail2ban"], timeout=60)
    # Existing firewall rules are retained. SSH is allowed before enabling.
    run(["ufw", "allow", ssh_port + "/tcp"])
    for port in payload.get("allowedPorts", []):
        run(["ufw", "allow", str(int(port)) + "/tcp"])
    run(["ufw", "default", "deny", "incoming"])
    run(["ufw", "default", "allow", "outgoing"])
    run(["ufw", "--force", "enable"])
    run(["systemctl", "reload", "ssh"])
    subprocess.run(["modprobe", "tcp_bbr"], capture_output=True)
    available = run(["sysctl", "-n", "net.ipv4.tcp_available_congestion_control"])
    bbr = "bbr" in available.split()
    if bbr:
        pathlib.Path("/etc/sysctl.d/90-reforge.conf").write_text("net.core.default_qdisc=fq\nnet.ipv4.tcp_congestion_control=bbr\n")
        run(["sysctl", "-p", "/etc/sysctl.d/90-reforge.conf"])
    return {"docker": True, "sshHardening": True, "ufw": True, "fail2ban": True, "bbr": bbr, "note": "Existing UFW rules retained; only explicitly supplied TCP ports opened"}
