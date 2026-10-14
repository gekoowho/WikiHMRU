#!/usr/bin/env python3
"""Check that every file in a WikiHMRU backup matches its manifest."""

import argparse
import hashlib
import json
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    args = parser.parse_args()
    root = args.backup.resolve()
    try:
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("format") != "wikihmru-backup-v1":
            raise ValueError("unsupported backup format")
        scope = manifest.get("scope", "full")
        if scope not in ("full", "images"):
            raise ValueError("unsupported backup scope")
        expected = manifest["sha256"]
        if not isinstance(expected, dict) or (scope == "full" and "database.dump" not in expected):
            raise ValueError("incomplete manifest")
        if scope == "images" and "database.dump" in expected:
            raise ValueError("unexpected database dump in images-only backup")
        for relative, digest in expected.items():
            path = root / relative
            if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
                raise ValueError(f"missing or unsafe file: {relative}")
            with path.open("rb") as source:
                actual = hashlib.file_digest(source, "sha256").hexdigest()
            if actual != digest:
                raise ValueError(f"checksum mismatch: {relative}")
        actual_files = {
            path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()
        }
        if actual_files != set(expected) | {"manifest.json"}:
            raise ValueError("backup contains unexpected or missing files")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Verification failed: {error}", file=sys.stderr)
        return 1
    print(f"Backup verified: {len(expected)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
