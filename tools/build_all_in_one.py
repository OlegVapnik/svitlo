#!/usr/bin/env python3
"""
Build ALL_IN_ONE.md: AGENTS.md + every SKILL.md (frontmatter stripped) in one file.
Use it for chat-only models (no file access): paste it as the system prompt / first message,
or upload it as a knowledge file.
Usage:
  python3 tools/build_all_in_one.py                      # everything -> ALL_IN_ONE.md
  python3 tools/build_all_in_one.py --only outage-data-core,kyiv-time   # AGENTS + discipline + onboarding + these
                                                                         # (smaller: better for small context windows)
"""
import sys
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
order = ["agent-discipline", "energymon-onboarding", "outage-data-core", "db-migrations",
         "api-endpoint-change", "scraper-adapter-hardening", "frontend-ui-change", "kyiv-time",
         "secrets-pii-hygiene", "ops-deploy-check", "test-strategy", "code-audit"]

only = None
if "--only" in sys.argv:
    only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    unknown = only - set(order)
    assert not unknown, f"unknown skills: {unknown}"
    only |= {"agent-discipline", "energymon-onboarding"}
    order = [n for n in order if n in only]
out_name = "ALL_IN_ONE.md" if only is None else "BUNDLE_" + "_".join(n for n in order if n not in ("agent-discipline", "energymon-onboarding")) + ".md"

parts = ["# EnergyMonitor — all instructions in one file\n",
         "How to use: the section 'AGENTS' is always active. For each task, apply the matching 'SKILL' section(s). "
         "References to `skills/<name>/SKILL.md` mean the section with that name below.\n",
         "\n---\n\n# AGENTS\n\n", (root / "AGENTS.md").read_text(encoding="utf-8")]

for name in order:
    text = (root / "skills" / name / "SKILL.md").read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    assert m, f"bad frontmatter in {name}"
    desc = re.search(r'^description:\s*"(.*)"\s*$', m.group(1), re.M)
    parts.append(f"\n\n---\n\n# SKILL: {name}\n\nWhen to use: {desc.group(1) if desc else ''}\n{m.group(2)}")

out = root / out_name
out.write_text("".join(parts), encoding="utf-8")
print(f"written {out} ({out.stat().st_size // 1024} KB, ~{out.stat().st_size // 4} tokens)")
