"""Strict client source pins across LF and CRLF checkouts."""

import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest

from humanoid_harness.integration import __main__ as launcher


def test_canonical_merged_client_modules_match_reviewed_pin():
    source = Path(launcher.client_module.__file__).resolve().parent.parent
    pinned = (
        (launcher.client_module, "client.py", launcher.EXPECTED_CLIENT_SHA256),
        (launcher.pending_completion_module, "pending_completion.py", launcher.EXPECTED_COMPLETION_SHA256),
        (launcher.pending_failure_module, "pending_failure.py", launcher.EXPECTED_FAILURE_SHA256),
        (launcher.settings_module, "settings.py", launcher.EXPECTED_SETTINGS_SHA256),
    )
    for module, filename, expected in pinned:
        result = launcher.verify_source_file(module, source, filename, expected)
        assert result["sha256"] == hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
        assert result["normalized_sha256"] == expected


def test_lf_and_crlf_checkout_bytes_both_match_same_reviewed_content(tmp_path):
    source = tmp_path / "client"
    file = source / "hr_client" / "client.py"
    file.parent.mkdir(parents=True)
    original = Path(launcher.client_module.__file__).read_bytes().replace(b"\r\n", b"\n")
    module = SimpleNamespace(__file__=str(file))
    file.write_bytes(original)
    lf = launcher.verify_source_file(module, source, "client.py", launcher.EXPECTED_CLIENT_SHA256)
    file.write_bytes(original.replace(b"\n", b"\r\n"))
    crlf = launcher.verify_source_file(module, source, "client.py", launcher.EXPECTED_CLIENT_SHA256)
    assert lf["normalized_sha256"] == crlf["normalized_sha256"]
    assert lf["sha256"] != crlf["sha256"]


def test_substantive_edit_refused_even_when_module_path_is_correct(tmp_path):
    source = tmp_path / "client"
    file = source / "hr_client" / "client.py"
    file.parent.mkdir(parents=True)
    file.write_bytes(Path(launcher.client_module.__file__).read_bytes() + b"\n# changed\n")
    with pytest.raises(ValueError, match="not pinned"):
        launcher.verify_source_file(SimpleNamespace(__file__=str(file)), source, "client.py", launcher.EXPECTED_CLIENT_SHA256)


def test_wrong_import_source_refused_even_when_content_matches(tmp_path):
    selected = tmp_path / "selected"
    wrong = tmp_path / "wrong" / "hr_client" / "client.py"
    wrong.parent.mkdir(parents=True)
    wrong.write_bytes(Path(launcher.client_module.__file__).read_bytes())
    with pytest.raises(ValueError, match="outside selected source"):
        launcher.verify_source_file(SimpleNamespace(__file__=str(wrong)), selected, "client.py", launcher.EXPECTED_CLIENT_SHA256)
