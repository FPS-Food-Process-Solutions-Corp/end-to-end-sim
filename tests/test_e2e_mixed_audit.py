"""No-service identity tests for the strict mixed-order audit."""

import hashlib
import shutil
from copy import deepcopy

import pytest

from tools.e2e_mixed_audit import CLIENT_MODULE_FILES, selected_client_identity


@pytest.fixture
def client_identity(tmp_path):
    source = tmp_path / "platform-client"
    package = source / "hr_client"
    package.mkdir(parents=True)
    hashes = {}
    pinned = {}
    loaded = {}
    for filename in CLIENT_MODULE_FILES:
        path = package / filename
        content = ("# selected " + filename + "\r\n").encode("ascii") if filename == "client.py" else ("# selected " + filename + "\n").encode("ascii")
        path.write_bytes(content)
        raw = hashlib.sha256(content).hexdigest()
        normalized = hashlib.sha256(content.replace(b"\r\n", b"\n")).hexdigest()
        hashes[filename] = raw
        record = {"path": str(path.resolve()), "sha256": raw, "normalized_sha256": normalized}
        pinned[filename] = record.copy()
        loaded["hr_client." + filename[:-3]] = record.copy()
    manifest = {
        "schema": 2,
        "client_source": str(source.resolve()),
        "device_id": "humanoid_robot",
        "client_pin_scheme": "sha256-crlf-to-lf-v1",
        "loaded_client_file": str((package / "client.py").resolve()),
        "loaded_client_sha256": hashes["client.py"],
        "loaded_client_normalized_sha256": pinned["client.py"]["normalized_sha256"],
        "pinned_sources": pinned,
        "loaded_sources": loaded,
    }
    return source, hashes, manifest


def test_accepts_selected_source_with_exact_raw_and_normalized_hashes(client_identity):
    source, hashes, manifest = client_identity
    assert hashes["client.py"] != manifest["loaded_client_normalized_sha256"]
    assert selected_client_identity(manifest, source, hashes)


def test_rejects_wrong_root_even_when_module_bytes_match(client_identity, tmp_path):
    source, hashes, manifest = client_identity
    other = tmp_path / "other-client"
    shutil.copytree(source, other)
    assert not selected_client_identity(manifest, other, hashes)


def test_rejects_source_change_after_hash_capture(client_identity):
    source, hashes, manifest = client_identity
    (source / "hr_client" / "pending_failure.py").write_bytes(b"# changed after capture\n")
    assert not selected_client_identity(manifest, source, hashes)


def test_rejects_wrong_caller_hash_and_missing_module(client_identity):
    source, hashes, manifest = client_identity
    wrong = hashes.copy()
    wrong["settings.py"] = "0" * 64
    assert not selected_client_identity(manifest, source, wrong)
    assert not selected_client_identity(manifest, source, {"client.py": hashes["client.py"]})
    (source / "hr_client" / "settings.py").unlink()
    assert not selected_client_identity(manifest, source, hashes)


@pytest.mark.parametrize(
    ("section", "key", "field", "value"),
    [
        ("loaded_sources", "hr_client.client", "path", "/wrong/hr_client/client.py"),
        ("loaded_sources", "hr_client.pending_completion", "sha256", "0" * 64),
        ("loaded_sources", "hr_client.pending_failure", "normalized_sha256", "0" * 64),
        ("pinned_sources", "settings.py", "normalized_sha256", "0" * 64),
    ],
)
def test_rejects_substantive_manifest_mismatch(client_identity, section, key, field, value):
    source, hashes, original = client_identity
    manifest = deepcopy(original)
    manifest[section][key][field] = value
    assert not selected_client_identity(manifest, source, hashes)


def test_rejects_missing_normalized_hash_or_top_level_client_mismatch(client_identity):
    source, hashes, original = client_identity
    manifest = deepcopy(original)
    manifest["loaded_sources"]["hr_client.client"].pop("normalized_sha256")
    assert not selected_client_identity(manifest, source, hashes)
    manifest = deepcopy(original)
    manifest["loaded_client_sha256"] = "0" * 64
    assert not selected_client_identity(manifest, source, hashes)
