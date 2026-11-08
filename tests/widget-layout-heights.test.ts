import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Контракт высот в XML-макетах виджетов.
 *
 * Зачем тест: в 2.41.3 на реальном экране (POCO F5 Pro) таймер 18sp обрезало ровно
 * пополам — его ряд был `layout_height="16dp"`, а у `TextView` ещё и `fontPadding`.
 * Ошибка не видна ни компилятору, ни RemoteViews: лаунчер просто рисует половину букв.
 *
 * Правила:
 *  - текстовая вьюха (`TextView`/`Chronometer`) не может иметь фиксированную высоту в dp
 *    меньше 28dp — только `wrap_content`;
 *  - у каждой текстовой вьюхи `includeFontPadding="false"`, иначе системный шрифт выше
 *    расчётной строки и снова режется;
 *  - горизонтальный ряд, в котором стоит крупный текст (>= 14sp), тоже не может быть
 *    фиксированным и низким — это тот же баг уровнем выше.
 */

const LAYOUT_DIR = path.resolve(__dirname, '../native-android/res/layout');
const LAYOUT_FILES = readdirSync(LAYOUT_DIR).filter(
  (file) => file.startsWith('svitlo_widget_') && file.endsWith('.xml'),
);

const TEXT_TAGS = new Set(['TextView', 'Chronometer']);
const MIN_TEXT_HEIGHT_DP = 28;
const LARGE_TEXT_SP = 14;

interface Node {
  tag: string;
  attrs: Record<string, string>;
  parent: Node | null;
}

/** Минимальный разбор XML: теги, атрибуты и родительская цепочка (без внешних зависимостей). */
function parseLayout(file: string): Node[] {
  const xml = readFileSync(path.join(LAYOUT_DIR, file), 'utf8').replace(/<!--[\s\S]*?-->/gu, '');
  const nodes: Node[] = [];
  const stack: Node[] = [];
  const tagRegex = /<(\/?)([A-Za-z][\w.]*)((?:\s+[\w:]+="[^"]*")*)\s*(\/?)>/gu;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(xml)) !== null) {
    const [, closing, rawTag, rawAttrs, selfClosing] = match;
    const tag = rawTag.split('.').pop() ?? rawTag;
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrRegex = /([\w:]+)="([^"]*)"/gu;
    let attr: RegExpExecArray | null;
    while ((attr = attrRegex.exec(rawAttrs)) !== null) attrs[attr[1]] = attr[2];
    const node: Node = { tag, attrs, parent: stack[stack.length - 1] ?? null };
    nodes.push(node);
    if (!selfClosing) stack.push(node);
  }
  return nodes;
}

/** Вьюха реально рисует текст: у неё есть текст или размер шрифта (оверлеи кликов — без них). */
function rendersText(node: Node): boolean {
  return Boolean(node.attrs['android:text'] ?? node.attrs['android:textSize']);
}

/** `0dp` + вес — это «занять остаток», а не жёсткая высота: текст не режется. */
function isFlexible(node: Node): boolean {
  return Number(node.attrs['android:layout_weight'] ?? '0') > 0;
}

function dpValue(value: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)dp$/u.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

function spValue(value: string | undefined): number {
  const match = /^(\d+(?:\.\d+)?)sp$/u.exec(value ?? '');
  return match ? Number(match[1]) : 0;
}

describe('высоты текста в макетах виджетов', () => {
  it('находит все макеты', () => {
    expect(LAYOUT_FILES.length).toBeGreaterThanOrEqual(6);
  });

  it('ни один TextView/Chronometer не имеет фиксированной высоты меньше 28dp', () => {
    const problems: string[] = [];
    for (const file of LAYOUT_FILES) {
      for (const node of parseLayout(file)) {
        if (!TEXT_TAGS.has(node.tag)) continue;
        if (!rendersText(node) || isFlexible(node)) continue;
        const height = dpValue(node.attrs['android:layout_height']);
        if (height !== null && height < MIN_TEXT_HEIGHT_DP) {
          const id = node.attrs['android:id'] ?? node.attrs['android:text'] ?? '(без id)';
          problems.push(`${file}: ${node.tag} ${id} → ${height}dp`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('у каждой текстовой вьюхи отключён fontPadding', () => {
    const problems: string[] = [];
    for (const file of LAYOUT_FILES) {
      for (const node of parseLayout(file)) {
        if (!TEXT_TAGS.has(node.tag)) continue;
        if (!rendersText(node)) continue;
        if (node.attrs['android:includeFontPadding'] !== 'false') {
          const id = node.attrs['android:id'] ?? node.tag;
          problems.push(`${file}: ${id}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('горизонтальный ряд с крупным текстом не зажат фиксированной высотой', () => {
    const problems: string[] = [];
    for (const file of LAYOUT_FILES) {
      for (const node of parseLayout(file)) {
        if (node.tag !== 'LinearLayout') continue;
        if (node.attrs['android:orientation'] !== 'horizontal') continue;
        const height = dpValue(node.attrs['android:layout_height']);
        if (height === null || height >= MIN_TEXT_HEIGHT_DP) continue;
        const hasLargeText = parseLayout(file).some(
          (child) =>
            child.parent === node &&
            TEXT_TAGS.has(child.tag) &&
            spValue(child.attrs['android:textSize']) >= LARGE_TEXT_SP,
        );
        if (hasLargeText) problems.push(`${file}: ряд ${height}dp с текстом ≥ ${LARGE_TEXT_SP}sp`);
      }
    }
    expect(problems).toEqual([]);
  });
});
