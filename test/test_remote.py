import pathlib
import tarfile
import unittest
import tempfile
import json
ROOT = pathlib.Path(__file__).resolve().parent.parent
scope = {"__name__": "reforge_test"}
source = "\n".join((ROOT / "src" / "remote" / file).read_text(encoding="utf-8-sig") for file in ["deploy.py", "snapshot.py", "recovery.py", "worker.py"])
exec(compile(source, "<worker>", "exec"), scope)
class ArchiveSecurityTests(unittest.TestCase):
    def member(self, name, kind=tarfile.REGTYPE):
        result = tarfile.TarInfo(name)
        result.type = kind
        return result
    def test_reject_traversal_absolute_links_and_duplicates(self):
        for members in [[self.member("projects/../../etc/passwd")], [self.member("/etc/passwd")], [self.member("projects/a", tarfile.SYMTYPE)], [self.member("volumes/a", tarfile.LNKTYPE)], [self.member("manifest.json"), self.member("manifest.json")]]:
            with self.assertRaises(RuntimeError):
                scope["validate_members"](members)
    def test_accept_project_and_volume_files(self):
        scope["validate_members"]([self.member("manifest.json"), self.member("projects/0/compose.yaml"), self.member("volumes/0/pgdata")])
    def test_health_checks_cannot_target_production(self):
        with self.assertRaises(RuntimeError):
            scope["health_check"]({"url": "https://production.example/health", "status": 200})
    def test_bind_path_cannot_escape_target(self):
        config = {"services": {"web": {"volumes": [{"type": "bind", "source": {"projectRelative": "../../../etc"}}]}}}
        with self.assertRaises(RuntimeError):
            scope["remap_config"](config, pathlib.Path("/opt/reforge/0"))
    def test_source_machine_cannot_be_target(self):
        original = scope["inventory"]
        scope["inventory"] = lambda: {"machineId": "source"}
        try:
            with self.assertRaisesRegex(RuntimeError, "source machine"):
                scope["clean_target"]("source")
        finally:
            scope["inventory"] = original
class SnapshotLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.project = self.root / "app"
        self.project.mkdir()
        (self.project / ".env").write_text("DATABASE_PASSWORD=secret")
        self.volume = self.root / "volume"
        self.volume.mkdir()
        (self.volume / "data").write_text("persisted-data")
        self.original = {name: scope[name] for name in ["ROOT", "resolve_projects", "database_dumps", "run", "safe_tree"]}
        scope["ROOT"] = self.root / "backups"
        self.commands = []
        scope["run"] = lambda args, **kwargs: self.commands.append(args) or ""
        scope["database_dumps"] = lambda projects, destination: []
        scope["resolve_projects"] = lambda paths: (
            {"machineId": "source"},
            [{"index": 0, "name": "app", "sourcePath": str(self.project), "imagePins": {"web": "registry/web@sha256:abc"}, "config": {}, "containers": []}],
            [{"name": "app_data", "mountpoint": str(self.volume), "archive": "volumes/0"}],
            ["running-container"], []
        )
        self.payload = {"backupId": "00000000-0000-4000-8000-000000000001", "paths": [str(self.project)], "healthChecks": [{"url": "http://127.0.0.1:8080/health", "status": 200}]}
    def tearDown(self):
        scope.update(self.original)
        self.temp.cleanup()
    def test_snapshot_contains_env_volume_and_manifest_and_restarts_source(self):
        summary = scope["prepare_snapshot"](self.payload)
        archive = scope["ROOT"] / (self.payload["backupId"] + ".tar")
        with tarfile.open(archive) as snapshot:
            self.assertEqual(snapshot.extractfile("projects/0/.env").read(), b"DATABASE_PASSWORD=secret")
            self.assertEqual(snapshot.extractfile("volumes/0/data").read(), b"persisted-data")
            self.assertEqual(json.load(snapshot.extractfile("manifest.json"))["sourceMachineId"], "source")
        self.assertEqual(self.commands[0][1], "stop")
        self.assertEqual(self.commands[-1][1], "start")
        self.assertNotIn("config", summary["projects"][0])
        scope["cleanup_snapshot"](self.payload)
        self.assertFalse(archive.exists())
    def test_failure_after_stopping_still_restarts_source(self):
        original_safe = scope["safe_tree"]
        def fail_on_volume(path):
            if str(path) == str(self.volume):
                raise RuntimeError("Injected failure while scanning volume")
            original_safe(path)
        scope["safe_tree"] = fail_on_volume
        with self.assertRaisesRegex(RuntimeError, "Injected failure"):
            scope["prepare_snapshot"](self.payload)
        self.assertEqual(self.commands[0][1], "stop")
        self.assertEqual(self.commands[-1][1], "start")
        self.assertFalse((scope["ROOT"] / (self.payload["backupId"] + ".tar")).exists())

if __name__ == "__main__":
    unittest.main()
