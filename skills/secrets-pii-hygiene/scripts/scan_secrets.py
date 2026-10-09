#!/usr/bin/env python3
"""
Lightweight secret / PII scanner. Never prints the secret itself (values are masked).

Usage:
  python3 scan_secrets.py [ROOT]            scan a directory tree
  python3 scan_secrets.py ROOT --also /tmp  scan extra directories too
Exit code: 0 clean, 1 findings.

Suppressing a reviewed false positive:
  - add `scan:allow` in a comment on that line, or
  - list a path / path:line in ROOT/.scan-allowlist (one per line, '#' comments allowed).
Code-like values (z.string().default(, authHeader.split() and trivial numbers (000000000) are ignored automatically.
"""
import os
import re
import sys
from pathlib import Path

SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".turbo", ".next", "coverage", "__pycache__",
             ".pnpm-store", ".ai-backup"}
SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".woff",
            ".woff2", ".ttf", ".otf", ".mp4", ".lock", ".dump", ".sqlite", ".pem"}
MAX_BYTES = 2_000_000
PLACEHOLDER = re.compile(r"(change[-_ ]?me|changeme|example|placeholder|your[-_ ]|xxx+|\*{3,}|<[^>]+>|\$\{|\$\(|^\s*$|"
                         r"test|dummy|secret$|password$|token$|todo)", re.I)

RULES = [
    ("assigned-secret",
     re.compile(r"(?i)\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY)[A-Z0-9_]*)\s*[:=]\s*['\"]?([^\s'\"#]{8,})")),
    ("bearer-header",
     re.compile(r"(?i)\bBearer\s+([A-Za-z0-9._~+/=-]{16,})")),
    ("private-key",
     re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("jwt",
     re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")),
    ("db-url-password",
     re.compile(r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s:/@]+:([^\s@]{3,})@")),
    ("account-number",
     re.compile(r"(?i)(?:особов\w*\s+рахун\w*|лицев\w*\s+сч[её]т\w*|account(?:_?number)?|personal[_ ]account|acc(?:ount)?_?id)"
                r"[^0-9\n]{0,25}(\d{6,12})\b")),
    ("cookie-session",
     re.compile(r"(?i)\b(?:set-)?cookie\s*[:=]\s*[^\n]{0,40}(?:session|sid|token)[^\n]{0,10}=([A-Za-z0-9%._-]{12,})")),
]


def mask(s: str) -> str:
    s = s.strip()
    if len(s) <= 6:
        return "***"
    return s[:2] + "***" + s[-2:] + f" (len {len(s)})"


def is_placeholder(value: str) -> bool:
    return bool(PLACEHOLDER.search(value))


def looks_like_code(value: str) -> bool:
    """z.string().default(  authHeader.split(  process.env.X  -> code, not a secret."""
    v = value.rstrip(";,)")
    if re.fullmatch(r"[a-z]+(-[a-z]+)+", v):          # plain words like must-be-dropped: a phrase, not a secret
        return True
    return bool(re.search(r"[()\[\]{}<>]", v)) or bool(re.match(r"^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+\.?$", v))


def trivial_number(value: str) -> bool:
    """000000000, 111111111, 123456789 are placeholders in docs/tests."""
    return len(set(value)) == 1 or value in ("123456789", "1234567890", "987654321")


def load_allowlist(root: Path) -> list:
    f = root / ".scan-allowlist"
    if not f.exists():
        return []
    return [l.strip() for l in f.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]


def scan_file(path: Path, root: Path, findings: list, allow: list = ()) -> None:
    try:
        if path.stat().st_size > MAX_BYTES:
            return
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return
    rel = os.path.relpath(path, root) if str(path).startswith(str(root)) else str(path)
    for lineno, line in enumerate(text.splitlines(), 1):
        if len(line) > 4000 or "scan:allow" in line:
            continue
        if any(a in f"{rel}:{lineno}" or a in rel for a in allow if a.startswith(("/", ".")) or ":" in a or "/" in a):
            continue
        for name, rx in RULES:
            for m in rx.finditer(line):
                val = m.group(m.lastindex) if m.lastindex else m.group(0)
                if name in ("assigned-secret", "bearer-header", "db-url-password") and (is_placeholder(val) or looks_like_code(val)):
                    continue
                if name == "account-number" and trivial_number(val):
                    continue
                if any(a == val for a in allow):
                    continue
                # .env.example / docs with placeholders are fine; real-looking values are not
                findings.append((rel, lineno, name, mask(val)))


def walk(base: Path, findings: list) -> None:
    allow = load_allowlist(base)
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in SKIP_EXT:
                continue
            scan_file(p, base, findings, allow)


def check_repo_hygiene(root: Path, findings: list) -> None:
    gi = root / ".gitignore"
    wanted = [".env", "node_modules", "snapshots", "operator-samples", "sample-responses", "nohup.out", "dist"]
    if not gi.exists():
        findings.append((".gitignore", 0, "missing-gitignore", "file not found"))
    else:
        txt = gi.read_text(encoding="utf-8", errors="ignore")
        for w in wanted:
            if not re.search(rf"(^|/){re.escape(w)}(/|\*|$|\.)", txt, re.M):
                findings.append((".gitignore", 0, "gitignore-missing-entry", w))
    if not (root / ".git").exists():
        findings.append((".", 0, "no-git", "no .git directory: nothing can be rolled back; back up before edits"))
    else:
        import subprocess
        try:
            out = subprocess.run(["git", "-C", str(root), "ls-files", ".env", ".env.local", ".env.production"],
                                 capture_output=True, text=True, timeout=20).stdout.split()
            for f in out:
                findings.append((f, 0, "env-file-tracked", "tracked by git: remove from index and rotate its secrets"))
        except Exception:
            pass
    for d in ("snapshots", "operator-samples", "sample-responses", "1"):
        if (root / d).exists():
            findings.append((d + "/", 0, "sensitive-dir-present", "contains raw captures? verify they are git-ignored and scrubbed"))
    for f in ("apps/api/nohup.out", "nohup.out"):
        if (root / f).exists():
            findings.append((f, 0, "log-artifact", "runtime log in repo: delete (may contain tokens)"))


def main() -> int:
    argv = sys.argv[1:]
    extra = []
    if "--also" in argv:
        i = argv.index("--also")
        extra = argv[i + 1:i + 2]
        argv = argv[:i] + argv[i + 2:]
    root = Path(argv[0] if argv else ".").resolve()
    findings: list = []
    walk(root, findings)
    for e in extra:
        p = Path(e)
        if p.exists():
            walk(p, findings)
    check_repo_hygiene(root, findings)

    if not findings:
        print("OK: no findings.")
        return 0
    print(f"{len(findings)} finding(s) — values are masked:\n")
    for rel, ln, rule, snip in sorted(findings):
        loc = f"{rel}:{ln}" if ln else rel
        print(f"  {loc:<55} {rule:<22} {snip}")
    print("\nFix: remove/rotate, scrub fixtures, update .gitignore. Do NOT paste the raw values anywhere.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
