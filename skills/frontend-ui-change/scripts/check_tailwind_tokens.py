#!/usr/bin/env python3
"""
Find Tailwind semantic color classes that will generate NO CSS because the token is
missing from tailwind.config.* or globals.css (shadcn-style: bg-card, text-muted-foreground, ...).

Usage:  python3 check_tailwind_tokens.py [REPO_ROOT]
        python3 check_tailwind_tokens.py . --web apps/web

Heuristic, no Node needed. Convention assumed: config maps colors to hsl(var(--name)) / var(--name),
and a class like `text-muted-foreground` is valid when `--muted-foreground` is mapped in the config.
Exit code 1 when problems are found.
"""
import re
import sys
from pathlib import Path

PREFIXES = ("bg", "text", "border", "ring", "outline", "fill", "stroke", "from", "via", "to",
            "divide", "placeholder", "decoration", "caret", "accent", "shadow", "ring-offset")
# Default shadcn token names. Extra names are discovered from globals.css.
SHADCN = {"background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
          "primary", "primary-foreground", "secondary", "secondary-foreground", "muted",
          "muted-foreground", "accent", "accent-foreground", "destructive",
          "destructive-foreground", "border", "input", "ring"}
# CSS variables that are not colors
NON_COLOR_VARS = {"radius"}


def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = Path(args[0] if args else ".").resolve()
    web = root / "apps" / "web"
    if "--web" in sys.argv:
        web = root / sys.argv[sys.argv.index("--web") + 1]

    cfg = next((web / n for n in ("tailwind.config.ts", "tailwind.config.js", "tailwind.config.cjs",
                                  "tailwind.config.mjs") if (web / n).exists()), None)
    css = web / "src" / "styles" / "globals.css"
    if cfg is None or not css.exists():
        print(f"ERROR: need {web}/tailwind.config.* and {css}")
        return 2

    cfg_text, css_text = read(cfg), read(css)
    css_vars = {v for v in re.findall(r"--([a-zA-Z0-9-]+)\s*:", css_text)} - NON_COLOR_VARS
    mapped = set(re.findall(r"var\(\s*--([a-zA-Z0-9-]+)\s*\)", cfg_text))

    problems = 0
    unmapped = sorted(css_vars - mapped)
    if unmapped:
        problems += 1
        print("Defined in globals.css but NOT mapped in tailwind config (classes will not exist):")
        for v in unmapped:
            print(f"  --{v}")
        print()

    undefined_in_css = sorted(mapped - css_vars)
    if undefined_in_css:
        problems += 1
        print("Mapped in tailwind config but NOT defined in globals.css (colors will be empty):")
        for v in undefined_in_css:
            print(f"  --{v}")
        print()

    known = SHADCN | css_vars
    names = sorted(known, key=len, reverse=True)
    name_re = "|".join(re.escape(n) for n in names)
    pref_re = "|".join(sorted((re.escape(p) for p in PREFIXES), key=len, reverse=True))
    # (?<![\w-]) avoids matching inside longer class names; the lookahead ensures a full token
    class_re = re.compile(rf"(?<![\w-])(?:[a-z-]+:)*(?:{pref_re})-({name_re})(?:/\d{{1,3}})?(?![\w-])")

    missing = {}
    src = web / "src"
    for f in list(src.rglob("*.tsx")) + list(src.rglob("*.ts")) + list(src.rglob("*.css")):
        if "node_modules" in f.parts:
            continue
        for lineno, line in enumerate(read(f).splitlines(), 1):
            for m in class_re.finditer(line):
                name = m.group(1)
                if name not in mapped:
                    missing.setdefault(name, []).append(f"{f.relative_to(root)}:{lineno}")

    if missing:
        problems += 1
        print("Classes used in code whose token is NOT mapped (they generate no CSS):")
        for name, where in sorted(missing.items()):
            print(f"  {name}   ({len(where)} uses) e.g. {', '.join(where[:3])}")
        print()

    # inline style / z-index workarounds
    hacks = []
    for f in src.rglob("*.tsx"):
        t = read(f)
        if re.search(r"style=\{\{[^}]*(background|backgroundColor|color)\s*:\s*['\"](#|rgb|hsl)", t):
            hacks.append(f"{f.relative_to(root)}: inline color in style prop")
        if re.search(r"zIndex\s*:\s*\d{2,}", t):
            hacks.append(f"{f.relative_to(root)}: inline zIndex")
    if hacks:
        print("Possible workarounds to review after the tokens are fixed:")
        for h in hacks:
            print(f"  {h}")
        print()

    if problems == 0:
        print("OK: all semantic tokens are defined and mapped.")
        return 0
    print("FAILED: fix tokens in BOTH globals.css and tailwind.config.*")
    return 1


if __name__ == "__main__":
    sys.exit(main())
