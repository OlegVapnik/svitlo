---
name: agent-discipline
description: "Universal working protocol for ANY task that edits files, runs commands, or makes claims about code, data or servers: read before editing, verify before claiming, small reversible steps, explicit stop conditions, fixed report format. Use at the start of EVERY coding, refactoring, bug-fixing, debugging or analysis task, especially with fast/small models that tend to guess file names, APIs and results. Триггеры: исправь, добавь, переделай, рефакторинг, багфикс, проверь, почини, сделай."
---

# Agent discipline

Why this exists: the costly failures of coding agents are not "wrong algorithm", they are
(1) editing from a guess instead of from the file, (2) saying "done" without running anything,
(3) wide diffs nobody can review, (4) destructive commands. This protocol removes those four.

## The loop (follow in order, do not skip)

1. **Restate** the task in one sentence and write the *observable* success criterion
   ("`pnpm --filter @svitlo/api test` passes and `GET /outages` returns `meta.total == 6`").
   If you cannot state a criterion, ask exactly one clarifying question, then continue.
2. **Orient** before touching anything:
   - list the directory, read every file you will change, read its direct importers/callers;
   - `grep -rn "<symbol>"` for every function/type you will rename or change;
   - never edit a file you have not read in this session;
   - never invent file paths, function names, package versions, CLI flags or env vars.
     Confirm with `ls`, `grep`, `<tool> --help`, `package.json`, lockfile, or the type definitions.
3. **Safety net**:
   - if the repo has git: `git status` must be understood; work on a branch `ai/<topic>`;
   - if there is no git: copy the files you will change to `.ai-backup/<YYYYMMDD-HHMM>/` first.
4. **Plan**: at most 7 bullets, list the files to touch. Choose the *smallest* diff that meets the criterion.
   If the plan touches more than 5 files, or contains any risky action (below), show the plan and wait for approval when a human is present.
5. **Implement in small steps.** After each step run the cheapest relevant check
   (typecheck of the package, the one test file, a `curl`). Fix before moving on.
6. **Verify with evidence**: run the commands and quote the actual output lines.
   Label each claim as one of: `verified` (you ran it), `reasoned` (not run, derived from code), `assumed`.
7. **Report** using the template at the bottom.

## Risky actions: ask first, always

Deleting or overwriting many files; `rm -rf`; `git reset --hard`; `git push --force`; dropping/truncating tables;
destructive migrations; rotating or printing secrets; editing `.env`; running a script you have not read;
calls to third-party production APIs; anything that cannot be undone from the backup/branch.

## Anti-hallucination rules

- Unknown means unknown. Write "unknown — to find out run `<command>`" instead of guessing.
- Numbers, versions, line counts: copy from tool output, never from memory.
- Library APIs: check the installed version (lockfile or `node_modules/<pkg>/package.json`) and read its `.d.ts`
  or docs for the exact signature before using it.
- Do not weaken a test to make it pass. If an assertion is wrong, say why and fix the assertion explicitly.
- Do not silence errors (`any`, `@ts-ignore`, empty `catch`, `|| true`) without a one-line comment explaining why.
- No drive-by refactors. Put them under "Noticed but not changed".
- Do not claim a file exists, a test passes, or a service is running unless you just observed it.

## When something fails

- Same error twice: stop editing. Re-read the full error. Write at least two hypotheses and test the cheapest first.
- The third attempt must use a different approach from the first two.
- After 5 tool calls on one sub-problem without progress, stop and report what you know and what you tried.

## Context hygiene (important for small context windows)

- `grep` first, then read only the relevant line range of big files (>300 lines).
- Keep a running "facts" list of at most 10 lines (paths, decisions, commands that worked) and refer to it.
- Pipe long output through `head`/`tail`/`grep`.

## Report template (always use)

```
Done: <1–2 lines>
Changed: <file> — <why> (one line per file)
Verified: <command> → <result>   (or "not run: <reason>")
Assumptions / not verified:
Noticed but not changed:
Next step (if any):
```

Reply in the user's language. Keep identifiers and code in English, keep domain terms (відключення, черга, ГПВ) as they appear in the code.
