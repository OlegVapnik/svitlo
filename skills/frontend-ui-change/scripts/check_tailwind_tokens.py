#!/usr/bin/env python3
"""Проверка семантических токенов Tailwind v4 в apps/web/src/styles/globals.css.

Что проверяем и почему именно так:

1. **Базовые роли-утилиты** (`--color-foreground`, `--color-card`, `--color-border`, …) — на них
   завязаны десятки компонентов, и пропажа любой из них ломает вид всего приложения, а не одного
   экрана. Проверяем имя утилиты (`--color-*`), а не «сырую» переменную темы: в M3-редизайне
   значения переехали в `--md-*`, и токен считается объявленным, когда он есть в `@theme inline`.
2. **Роли M3 Expressive** (тональные поверхности, primary-группа, outline) — на них строится
   динамическая палитра и волнистые индикаторы. Если роль не зарегистрирована в `@theme inline`,
   Tailwind молча не сгенерирует класс (`bg-surface-container` просто ничего не сделает), и
   ошибка вылезет только глазами на телефоне.
"""
import os
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

# Роли M3 Expressive: тональные поверхности, primary-группа (меняется от data-power-state)
# и обводки. Без них не работают M3-классы в разметке.
M3_TOKENS = [
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

missing = [t for t in BASE_TOKENS + M3_TOKENS if t not in content]
if missing:
    print(f"FAIL: missing tokens in globals.css: {missing}")
    sys.exit(1)

# Динамическая палитра: состояния, от которых зависит `data-power-state` на <html>.
POWER_STATES = ["on", "warning", "off", "unknown"]
missing_states = [state for state in POWER_STATES if f"data-power-state='{state}'" not in content]
if missing_states:
    print(f"FAIL: globals.css has no palette for power states: {missing_states}")
    sys.exit(1)

print(
    f"OK: {len(BASE_TOKENS)} базовых и {len(M3_TOKENS)} M3-токенов объявлены, "
    f"палитра для {len(POWER_STATES)} состояний сети на месте"
)
sys.exit(0)