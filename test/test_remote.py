import pathlib
import tarfile
import unittest
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
if __name__ == "__main__":
    unittest.main()
