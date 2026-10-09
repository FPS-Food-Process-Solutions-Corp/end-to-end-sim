"""Archive Mac bundles on a POSIX filesystem, preserving symlinks and modes."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import stat
import struct
import sys
import zipfile

output = Path(sys.argv[1]).resolve()
version = sys.argv[2]
results = []
for directory in map(Path, sys.argv[3:]):
    arch = directory.name.rsplit("-", 1)[-1]
    if arch not in ("x64", "arm64"):
        raise RuntimeError(f"Unexpected architecture: {arch}")
    app = directory / "Layout Studio.app"
    metadata = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    executable = app / "Contents/MacOS" / metadata["CFBundleExecutable"]
    data = executable.read_bytes()[:12]
    expected_cpu = {"x64": 0x01000007, "arm64": 0x0100000C}[arch]
    if struct.unpack("<II", data[:8]) != (0xFEEDFACF, expected_cpu):
        raise RuntimeError(f"Wrong Mach-O architecture: {executable}")
    if not executable.stat().st_mode & 0o111:
        raise RuntimeError("Executable permissions were lost")
    package = app / "Contents/Resources/app.asar"
    if not package.is_file() or package.stat().st_size < 1000000:
        raise RuntimeError("Application data is missing")
    destination = output / f"Layout-Studio-{version}-mac-{arch}-unsigned.zip"
    links = 0
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for folder, dirs, files in os.walk(app, followlinks=False):
            for name in sorted(dirs + files):
                file = Path(folder) / name
                relative = file.relative_to(directory).as_posix()
                if file.is_symlink():
                    target = os.readlink(file)
                    if os.path.isabs(target) or not file.resolve().is_relative_to(app.resolve()):
                        raise RuntimeError(f"Link escapes the app: {relative}")
                    info = zipfile.ZipInfo(relative)
                    info.create_system = 3
                    info.external_attr = file.lstat().st_mode << 16
                    archive.writestr(info, target)
                    links += 1
                else:
                    archive.write(file, relative)
    with zipfile.ZipFile(destination) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("ZIP integrity failure")
        main_entry = archive.getinfo(executable.relative_to(directory).as_posix())
        if not (main_entry.external_attr >> 16) & 0o111:
            raise RuntimeError("ZIP lost executable permissions")
        archived_links = sum(stat.S_ISLNK(item.external_attr >> 16) for item in archive.infolist())
        if links != archived_links or not links:
            raise RuntimeError("ZIP lost framework symlinks")
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    results.append({"file": destination.name, "sha256": digest, "arch": arch, "bytes": destination.stat().st_size,
                    "symlinks": links, "bundle_id": metadata["CFBundleIdentifier"],
                    "validation": "ZIP CRC, Mach-O CPU, executable permissions and symlinks checked; not launched or signed on macOS"})
    print(f"Created and structurally checked: {destination}", flush=True)
(output / "mac-cross-report.json").write_text(json.dumps(results, indent=2) + "\n")
(output / "SHA256SUMS.txt").write_text("".join(f"{item['sha256']}  {item['file']}\n" for item in results))
