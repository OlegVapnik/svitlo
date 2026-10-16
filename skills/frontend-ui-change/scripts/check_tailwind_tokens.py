#!/usr/bin/env python3
"""Проверка семантических токенов Tailwind v4 в apps/web/src/styles/globals.css.

Что проверяем и почему именно так:

1. **Базовые роли-утилиты** (`--color-foreground`, `--color-card`, `--color-border`, …) — на них
   завязаны десятки компонентов, и пропажа любой из них ломает вид всего приложения, а не одного
   экрана. Проверяем имя утилиты (`--color-*`), а не «сырую» переменную темы: значения живут в
   `--md-*`, и токен считается объявленным, когда он есть в `@theme inline`.
2. **Роли поверхностей** (тональные контейнеры, primary-группа, outline) — на них строится вся
   вёрстка. Если роль не зарегистрирована в `@theme inline`, Tailwind молча не сгенерирует класс
   (`bg-surface-container` просто ничего не сделает), и ошибка вылезет только глазами на телефоне.
3. **Роли состояния сети** (`--color-status*`) — ими красятся ровно четыре вещи: бейдж, текст
   таймера, линия прогресса и свечение. Значения приходят из блоков `[data-power-state='…']`,
   поэтому проверяем и наличие блоков, и полный набор переменных в каждом из них, и тёмный
   вариант: пропажа, например, `--md-status-border` оставляет бейдж без рамки — на графите он
   сливается с фоном, и заметить это по коду невозможно.
"""
import os
import re
import sys

CSS_PATH = os.path.join(sys.argv[1] if len(sys.argv) > 1 else ".", "apps/web/src/styles/globals.css")
if not os.path.exists(CSS_PATH):
    print(f"FAIL: {CSS_PATH} not found")
    sys.exit(1)

with open(CSS_PATH, "r", encoding="utf-8") as f:
    content = f.read()

# Базовые роли, которые читают существующие компоненты.
BASE_TOKENS = [
    "--color-background",
    "--color-foreground",
    "--color-card",
    "--color-border",
    "--color-primary",
    "--color-muted-foreground",
]

# Роли поверхностей и акцента: тональные контейнеры, primary-группа (акцент выбора) и обводки.
SURFACE_TOKENS = [
    "--color-surface",
    "--color-surface-dim",
    "--color-surface-container-lowest",
    "--color-surface-container-low",
    "--color-surface-container",
    "--color-surface-container-high",
    "--color-surface-container-highest",
    "--color-on-surface",
    "--color-on-surface-variant",
    "--color-on-primary",
    "--color-primary-container",
    "--color-on-primary-container",
    "--color-outline",
    "--color-outline-variant",
]

# Акценты состояния и «ювелирный» слой: грань 1px и хвост полосы прогресса.
STATUS_TOKENS = [
    "--color-status",
    "--color-status-text",
    "--color-status-soft",
    "--color-status-border",
    "--color-hairline",
    "--color-track",
]

missing = [t for t in BASE_TOKENS + SURFACE_TOKENS + STATUS_TOKENS if t not in content]
if missing:
    print(f"FAIL: missing tokens in globals.css: {missing}")
    sys.exit(1)

# Динамическая палитра: состояния, от которых зависит `data-power-state` (его пишет usePowerState
# на <html>, а сам Hero — ещё и на свою секцию, потому что может показывать график на завтра).
POWER_STATES = ["on", "warning", "off", "unknown"]
STATE_VARIABLES = ["--md-status:", "--md-status-text:", "--md-status-soft:", "--md-status-border:"]

state_problems = []
for state in POWER_STATES:
    blocks = re.findall(r"\[data-power-state='" + state + r"'\]([^}]*)\}", content)
    if not blocks:
        state_problems.append(f"{state}: нет блока палитры")
        continue
    if not all(variable in blocks[0] for variable in STATE_VARIABLES):
        state_problems.append(f"{state}: неполный набор --md-status*")
    if f".dark[data-power-state='{state}']" not in content:
        state_problems.append(f"{state}: нет варианта для тёмной темы")

if state_problems:
    print(f"FAIL: палитра состояний сети неполная: {state_problems}")
    sys.exit(1)

print(
    f"OK: {len(BASE_TOKENS)} базовых, {len(SURFACE_TOKENS)} ролей поверхностей и "
    f"{len(STATUS_TOKENS)} токенов состояния/грани объявлены; палитра для {len(POWER_STATES)} "
    f"состояний сети на месте (светлая и тёмная темы)"
)
sys.exit(0)
