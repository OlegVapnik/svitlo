#!/usr/bin/env python3
import os, re, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
# `.cache` и `build` — локальные кеши Gradle/Android (в .gitignore): в них лежат документация и
# Kotlin-DSL самого инструмента, где слово `password` встречается сотнями раз. В репозиторий они не
# попадают, и находки в них означали бы только одно: настоящая находка утонула бы в шуме.
IGNORE_DIRS = {".git", "node_modules", "dist", ".turbo", "coverage", ".cache", ".gradle", "build", "__pycache__"}
SECRET_RE = re.compile(
    r"""["']?(?:ADMIN_TOKEN|POSTGRES_PASSWORD|CAPTCHA_SOLVER_API_KEY|password|secret)["']?\s*[:=]\s*["']([A-Za-z0-9_\-./+=]{8,})["']""",
    re.IGNORECASE,
)
ALLOW_VALUES = {"energymon", "development-admin-token", "change-me-in-production"}

findings = 0
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
    for fname in filenames:
        if fname.endswith((".png", ".jpg", ".ico", ".woff2", ".dump", ".lock", ".yaml")):
            continue
        fpath = os.path.join(dirpath, fname)
        try:
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                for lineno, line in enumerate(f, 1):
                    if "scan:allow" in line:
                        continue
                    m = SECRET_RE.search(line)
                    if m:
                        val = m.group(1)
                        if not val.isascii() or val in ALLOW_VALUES or val.startswith("${"):
                            continue
                        print(f"[WARN] {fpath}:{lineno}: potential secret assigned")
                        findings += 1
        except Exception:
            pass

print(f"scan_secrets: complete ({findings} findings)")
sys.exit(0)