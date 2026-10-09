---
name: code-audit
description: "A repeatable method for auditing a codebase or project documentation and producing an honest verdict with prioritised findings, evidence levels and a staged rework plan. Use when asked to review a project, decide whether it is 'good or garbage', find weak spots, estimate rework, prepare a refactoring roadmap, or evaluate AI-generated code. Works with or without access to the source (map-only audits must say so). Триггеры: аудит, ревью проекта, слабые места, оценка качества, с чего начать переделку, технический долг, говно или нет."
---

# Code audit method

## Principles

1. **Say what you actually saw.** Every finding carries an evidence tag:
   `[fact]` — you read it in code/config/output; `[inference]` — follows logically from what you read; `[verify]` — a hypothesis, name the exact file/command that would confirm it.
   If you only read a description (e.g. `PROJECT_MAP.md`) and not the code, state that at the top.
2. **Verdict first**, in plain words: is it usable, what is its state, rewrite vs. refactor. Then the details.
3. **Be fair**: list what is good and must not be broken. Rewrites are rarely the answer; find the smallest set of changes with the biggest effect.
4. **Priorities**: P0 security / product-does-not-work / data loss; P1 structural problems that cause recurring bugs; P2 maintainability debt; P3 nits.
5. **Actionable**: every finding has a concrete fix, an owner-sized step, and a way to verify it.

## Procedure

1. **Scope**: what is the product, who uses it, what must never break. Read README/map first.
2. **Inventory** (with commands, not memory): `git log --oneline | head`, file counts, dependencies, tests list, CI, Dockerfiles, env files (names only).
3. **Run what you can**: install, typecheck, tests, build, start. Record exact results. If you cannot run anything, say so.
4. **Walk the checklist** below; for each area, read the actual files.
5. **Cross-check numbers**: where two parts of the system compute the same thing, compare them (that is where the real bugs hide).
6. **Write the report** (template below), then re-read it and delete anything you did not verify or tag.

## Checklist

- **Product reality**: does data refresh by itself? is any fake/demo data shown as real? does it work offline/poor network if it should?
- **Data model**: one source of truth per concept? duplicated business rules (server vs client)? derived values stored and recomputed? constraints in the DB?
- **API**: contract matches docs? fake pagination, ignored params, inconsistent identifiers, error format, caching?
- **Security**: exposed ports/default credentials, secrets in repo/logs, auth model, admin UI exposure, CORS, rate limit behind a proxy, input validation, PII.
- **Reliability/ops**: restart policy, health/readiness, monitoring of stale data, backups and a tested restore, HTTPS, resource limits, logs.
- **Time/locale/units**: time zones, DST, languages, currency/number formats.
- **Frontend**: duplicated logic, direct network calls, state handling, a11y, bundle size, error boundaries, offline/PWA behaviour.
- **Tests/process**: test pyramid vs risk, CI, git/history, linting, formatting, toolchain pinning, dependency freshness.
- **External dependencies**: scraping/unofficial APIs (fragility, legal/ToS), third-party quotas.
- **Docs**: accurate? contradictions inside the docs themselves?

## Report template

```
# <Project> audit — <date>
Scope & method: what was read/run; what was NOT (be explicit).
## Verdict (5–8 lines)
## Scores table (area → 0–10 → one-line reason)
## What is good (do not break)
## Findings (P0 → P3): <title> [fact|inference|verify]
   Evidence: <file/command/output>   Impact:   Fix:   Verify by:
## Staged plan: stage → goal → steps → rough effort → exit criterion
## Open decisions for the owner
## What I need to go deeper (files/logs)
```

## Anti-patterns

- Praise or condemnation without evidence; confident claims about code you did not open.
- A 100-item flat list: group, prioritise, cut.
- Recommending a rewrite because the code "feels messy".
- Hiding uncertainty. A short, tagged `[verify]` list is more valuable than invented certainty.
