"""Use a temporary Linux Node runtime and filesystem; do not install system tools."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

desktop = Path(__file__).resolve().parent.parent
work = Path(tempfile.mkdtemp(prefix="layout-studio-mac-"))
print(f"Mac build workspace: {work}", flush=True)
try:
    base = "https://nodejs.org/dist/v24.21.0/"
    checksums = urllib.request.urlopen(base + "SHASUMS256.txt", timeout=60).read().decode()
    checksum, filename = next(line.split() for line in checksums.splitlines() if re.search(r"node-v24\.[0-9.]+-linux-x64\.tar\.xz$", line))
    archive = work / filename
    print(f"Downloading temporary Linux runtime: {filename}", flush=True)
    with urllib.request.urlopen(base + filename, timeout=120) as response, archive.open("wb") as target:
        shutil.copyfileobj(response, target)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != checksum:
        raise RuntimeError("Node runtime checksum mismatch")
    runtime = work / "node"
    runtime.mkdir()
    # Only unpack the checksum-verified official distribution inside this task's
    # temporary directory. Reject any entry escaping the archive root.
    with tarfile.open(archive) as package:
        for entry in package.getmembers():
            if Path(entry.name).is_absolute() or ".." in Path(entry.name).parts:
                raise RuntimeError("Unsafe runtime archive path")
    subprocess.run(["tar", "-xJf", str(archive), "-C", str(runtime), "--strip-components=1"], check=True)
    env = dict(os.environ, LAYOUT_STUDIO_MAC_WORKDIR=str(work))
    env["PATH"] = str(runtime / "bin") + ":" + env.get("PATH", "")
    subprocess.run([str(runtime / "bin/node"), str(desktop / "scripts/package-mac-cross.cjs"), *sys.argv[1:]], cwd=desktop, env=env, check=True)
finally:
    # The directory comes from mkdtemp and is independent of all source folders.
    if work.parent == Path(tempfile.gettempdir()).resolve() and work.name.startswith("layout-studio-mac-"):
        shutil.rmtree(work)
