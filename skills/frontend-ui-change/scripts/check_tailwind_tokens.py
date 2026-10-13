#!/usr/bin/env python3
import os, sys

CSS_PATH = os.path.join(sys.argv[1] if len(sys.argv) > 1 else ".", "apps/web/src/styles/globals.css")
if not os.path.exists(CSS_PATH):
    print(f"FAIL: {CSS_PATH} not found")
    sys.exit(1)

with open(CSS_PATH, "r", encoding="utf-8") as f:
    content = f.read()

required = ["--background", "--foreground", "--card", "--border", "--primary", "--muted-foreground"]
missing = [t for t in required if t not in content]
if missing:
    print(f"FAIL: missing tokens in globals.css: {missing}")
    sys.exit(1)

print("OK: all semantic tokens are defined and mapped")
sys.exit(0)