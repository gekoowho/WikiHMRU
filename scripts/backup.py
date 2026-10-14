#!/usr/bin/env python3
"""Back up the Supabase database and private wiki images to a local directory.

Requires pg_dump and the environment variables listed in README.md. The
service-role key is used only on the machine running this script.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from uuid import uuid4


BUCKET = "wiki-images"
PAGE_SIZE = 100


def api_request(base, key, endpoint, payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        f"{base}/storage/v1/{endpoint}",
        data=body,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
        method="POST" if body is not None else "GET",
    )
    return urlopen(request, timeout=60)


def image_names(base, key):
    """Walk Storage folders and paginate each folder."""
    pending = [""]
    visited = set()
    names = set()
    while pending:
        prefix = pending.pop()
        if prefix in visited:
            continue
        visited.add(prefix)
        offset = 0
        while True:
            with api_request(base, key, f"object/list/{BUCKET}", {
                "prefix": prefix, "limit": PAGE_SIZE, "offset": offset,
                "sortBy": {"column": "name", "order": "asc"},
            }) as response:
                page = json.load(response)
            if not isinstance(page, list):
                raise RuntimeError("Unexpected Storage listing response")
            for item in page:
                name = item.get("name")
                if not isinstance(name, str) or not name or name in (".", "..") or "/" in name:
                    raise RuntimeError("Unexpected Storage object name")
                full_name = f"{prefix}/{name}" if prefix else name
                if item.get("id") is None:
                    pending.append(full_name)
                else:
                    names.add(full_name)
            if len(page) < PAGE_SIZE:
                break
            offset += len(page)
    return sorted(names)


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_backup(destination, base, key, db_url=None):
    if db_url is not None and not shutil.which("pg_dump"):
        raise RuntimeError("pg_dump is required (install the PostgreSQL client)")
    parsed = urlparse(base)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise RuntimeError("SUPABASE_URL must be a valid HTTPS project URL")
    base = base.rstrip("/")
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.chmod(destination, 0o700)
    try:
        files = {}
        if db_url is not None:
            db_file = destination / "database.dump"
            # Keep the connection URL out of subprocess arguments and error output.
            pg_env = os.environ.copy()
            pg_env["PGCONNECT_TIMEOUT"] = "20"
            pg_env["PGDATABASE"] = db_url
            with db_file.open("wb") as output:
                process = subprocess.run(
                    ["pg_dump", "--format=custom", "--no-owner", "--no-acl",
                     "--file=-"],
                    env=pg_env, stdout=output, stderr=subprocess.PIPE, text=False,
                )
            if process.returncode:
                # pg_dump might include connection details; do not echo stderr.
                raise RuntimeError("pg_dump failed; check database URL, network access and client version")
            if not db_file.stat().st_size:
                raise RuntimeError("pg_dump produced an empty file")
            files["database.dump"] = checksum(db_file)
        names = image_names(base, key)
        for name in names:
            # Storage object names come from the API. Reject traversal before
            # using them as paths in the backup directory.
            parts = name.split("/")
            if any(part in ("", ".", "..") or "\\" in part for part in parts):
                raise RuntimeError("Unsafe Storage object path")
            relative = Path("images", *parts)
            image_file = destination / relative
            image_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            endpoint = f"object/authenticated/{BUCKET}/{quote(name, safe='/')}"
            with api_request(base, key, endpoint) as response, image_file.open("wb") as output:
                shutil.copyfileobj(response, output)
            files[relative.as_posix()] = checksum(image_file)

        manifest = {
            "format": "wikihmru-backup-v1",
            "scope": "full" if db_url is not None else "images",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "supabase_host": parsed.hostname,
            "image_count": len(names),
            "sha256": files,
        }
        (destination / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    except Exception:
        shutil.rmtree(destination)
        raise
    return len(names)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True,
                        help="parent directory for the private backup folder")
    parser.add_argument("--images-only", action="store_true",
                        help="back up private Storage images without a database dump")
    args = parser.parse_args()
    required = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    if not args.images_only:
        required += ("SUPABASE_DB_URL",)
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        parser.error("missing environment variable(s): " + ", ".join(missing))
    output_root = args.output_dir.expanduser().resolve()
    if output_root.is_relative_to(Path(__file__).resolve().parent.parent):
        parser.error("backup destination must be outside the repository")
    target = output_root / ("wikihmru-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8])
    try:
        count = run_backup(target, os.environ["SUPABASE_URL"],
                           os.environ["SUPABASE_SERVICE_ROLE_KEY"],
                           None if args.images_only else os.environ["SUPABASE_DB_URL"])
    except (RuntimeError, OSError, HTTPError, URLError) as error:
        # HTTP and PostgreSQL errors can include request details or secrets.
        print(f"Backup failed ({type(error).__name__}). Check credentials and connectivity.", file=sys.stderr)
        return 1
    verification = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("verify_backup.py")), str(target)],
        check=False,
    )
    if verification.returncode:
        print("Backup was saved but did not pass verification; inspect it before use.", file=sys.stderr)
        return 1
    print(f"Backup saved to {target} ({count} images). Keep this directory private.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
