import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Контракт между XML-макетами виджетов и вызовами `RemoteViews` в Kotlin.
 *
 * Зачем тест: `RemoteViews` применяется в ПРОЦЕССЕ ЛАУНЧЕРА, а не в нашем. Ошибка вида
 * «view: android.widget.TextView doesn't have method: setBase(long)» не ловится `try/catch`
 * вокруг `updateAppWidget` — системный процесс просто рисует «Не вдалося завантажити віджет».
 * Именно так в 2.41.3 сломались все виджеты: `setChronometer` вызывался на `TextView`.
 *
 * Тест читает реальные макеты и реальный исходник провайдера, поэтому ловит расхождение
 * «id есть, но другого класса» до сборки APK.
 */

const ROOT = path.resolve(__dirname, '..');
const LAYOUT_DIR = path.join(ROOT, 'native-android/res/layout');
const RES_DIR = path.join(ROOT, 'native-android/res');
const XML_DIR = path.join(RES_DIR, 'xml');
/**
 * Исходник без комментариев: `setChronometer` упоминается в пояснении к регрессии, и тест
 * обязан отличать объяснение от реального вызова.
 */
const PROVIDER = readFileSync(
  path.join(ROOT, 'native-android/java/ua/com/svitlo/app/widget/SvitloWidgetProvider.kt'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/^\s*\/\/.*$/gmu, '');

/** Макет без XML-комментариев: в них встречается текст «<View>» как объяснение. */
function layoutXml(file: string): string {
  return readFileSync(path.join(LAYOUT_DIR, file), 'utf8').replace(/<!--[\s\S]*?-->/gu, '');
}

/** Провайдер виджета (`res/xml`) без комментариев: там тоже встречаются примеры атрибутов. */
function providerXml(file: string): string {
  return readFileSync(path.join(XML_DIR, file), 'utf8').replace(/<!--[\s\S]*?-->/gu, '');
}

/** `android.widget.TextView` и потомки, на которых `setTextViewText` работает. */
const TEXT_TAGS = new Set(['TextView', 'Button', 'EditText']);
const IMAGE_TAGS = new Set(['ImageView', 'ImageButton']);
const CHRONOMETER_TAGS = new Set(['Chronometer']);

interface LayoutId {
  tag: string;
  layout: string;
}

/** Разбирает макет в карту `id → имя XML-тега`, у которого объявлен `android:id`. */
function layoutIds(file: string): Map<string, LayoutId> {
  const xml = layoutXml(file);
  const ids = new Map<string, LayoutId>();
  const tagRegex = /<([A-Za-z][\w.]*)([^>]*?)(\/?)>/gu;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(xml)) !== null) {
    const [, rawTag, attrs] = match;
    const tag = rawTag.split('.').pop() ?? rawTag;
    const idMatch = /android:id="@\+id\/([\w]+)"/u.exec(attrs);
    if (idMatch) ids.set(idMatch[1], { tag, layout: file });
  }
  return ids;
}

const LAYOUT_FILES = readdirSync(LAYOUT_DIR).filter(
  (file) => file.startsWith('svitlo_widget_') && file.endsWith('.xml'),
);

const PROVIDER_FILES = readdirSync(XML_DIR).filter(
  (file) => file.startsWith('svitlo_widget_') && file.endsWith('.xml'),
);

const IDS_BY_LAYOUT = new Map(LAYOUT_FILES.map((file) => [file, layoutIds(file)]));

type Setter = 'text' | 'image' | 'chronometer' | 'any';

/** Все вызовы `views.set…(R.id.x, …)` из провайдера с ожидаемым семейством View. */
function providerCalls(): Array<{ id: string; setter: Setter; snippet: string }> {
  const calls: Array<{ id: string; setter: Setter; snippet: string }> = [];
  const regex = /views\.(set[A-Za-z]+)\(\s*R\.id\.(\w+)([^)]*)\)/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(PROVIDER)) !== null) {
    const [, method, id, rest] = match;
    let setter: Setter = 'any';
    if (/^setText/u.test(method) || method === 'setViewVisibility') setter = 'text';
    else if (/^setImageView/u.test(method) || method === 'setImageBitmap') setter = 'image';
    else if (/^setChronometer/u.test(method)) setter = 'chronometer';
    else if (method === 'setInt' && rest.includes('setBackgroundResource')) setter = 'any';
    calls.push({ id, setter, snippet: `${method}(R.id.${id}${rest})` });
  }
  return calls;
}

describe('контракт макетов виджетов', () => {
  it('находит все пять макетов виджетов', () => {
    expect([...IDS_BY_LAYOUT.keys()].sort()).toEqual([
      'svitlo_widget_capsule.xml',
      'svitlo_widget_command.xml',
      'svitlo_widget_event.xml',
      'svitlo_widget_fallback.xml',
      'svitlo_widget_places.xml',
      'svitlo_widget_timeline.xml',
    ]);
  });

  it('каждый R.id из провайдера существует хотя бы в одном макете', () => {
    const missing = providerCalls()
      .map((call) => call.id)
      .filter((id) => !LAYOUT_FILES.some((file) => IDS_BY_LAYOUT.get(file)!.has(id)));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('тип View совпадает во всех макетах, где встречается id', () => {
    const problems: string[] = [];
    for (const call of providerCalls()) {
      for (const file of LAYOUT_FILES) {
        const found = IDS_BY_LAYOUT.get(file)!.get(call.id);
        if (!found) continue;
        const compatible =
          call.setter === 'any' ||
          (call.setter === 'text' && TEXT_TAGS.has(found.tag)) ||
          (call.setter === 'image' && IMAGE_TAGS.has(found.tag)) ||
          (call.setter === 'chronometer' && CHRONOMETER_TAGS.has(found.tag));
        if (!compatible) {
          problems.push(`${file}: ${found.tag} для ${call.snippet}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('setChronometer не используется: Chronometer в RemoteViews уже ломал все виджеты', () => {
    expect(PROVIDER).not.toMatch(/views\.setChronometer\(/u);
    const chronometers = LAYOUT_FILES.filter((file) =>
      [...IDS_BY_LAYOUT.get(file)!.values()].some((entry) => entry.tag === 'Chronometer'),
    );
    expect(chronometers).toEqual([]);
  });

  it('в макетах нет голого <View>: RemoteViews надувает только @RemoteView', () => {
    const bare: string[] = [];
    for (const file of LAYOUT_FILES) {
      if (/<View[\s/>]/u.test(layoutXml(file))) bare.push(file);
    }
    expect(bare).toEqual([]);
  });

  it('у каждого id из списка общих элементов одинаковый тег во всех макетах', () => {
    const shared = ['widget_accent', 'widget_dot', 'widget_place', 'widget_queue', 'widget_pill'];
    for (const id of shared) {
      const tags = new Set(
        LAYOUT_FILES.map((file) => IDS_BY_LAYOUT.get(file)!.get(id)?.tag).filter(Boolean),
      );
      expect([...tags], `id ${id} объявлен разными тегами`).toHaveLength(1);
    }
  });
});

/** Атрибуты конкретного тега: нужен весь блок, а не только значение одного атрибута. */
function tagWithId(file: string, id: string): string | null {
  const xml = layoutXml(file);
  const regex = /<([A-Za-z][\w.]*)([^>]*?)\/?>/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    if (match[2].includes(`@+id/${id}"`)) return match[2];
  }
  return null;
}

/** `android:layout_height="8dp"` → 8; `wrap_content`/`match_parent` → null. */
function dpAttr(attrs: string, name: string): number | null {
  const match = new RegExp(`android:${name}="(\\d+)dp"`, 'u').exec(attrs);
  return match ? Number(match[1]) : null;
}

describe('размеры и точка состояния', () => {
  it('все пять провайдеров ограничивают ресайз сверху', () => {
    // Без `maxResizeWidth`/`maxResizeHeight` HyperOS не показывает ручку ресайза вовсе:
    // пользователь видит виджет, который «не змінює розмір».
    expect(PROVIDER_FILES).toHaveLength(5);
    for (const file of PROVIDER_FILES) {
      const xml = providerXml(file);
      expect(dpAttr(xml, 'maxResizeWidth'), `${file}: maxResizeWidth`).toBe(520);
      expect(dpAttr(xml, 'maxResizeHeight'), `${file}: maxResizeHeight`).toBe(420);
      expect(xml, `${file}: resizeMode`).toMatch(/android:resizeMode="horizontal\|vertical"/u);
      expect(xml, `${file}: updatePeriodMillis`).toMatch(
        /android:updatePeriodMillis="1800000"/u,
      );
    }
  });

  it('минимальные размеры: узкие виджеты сжимаются в одну строку, 4×2 — нет', () => {
    const expected: Record<string, { width: number; height: number }> = {
      'svitlo_widget_2x1.xml': { width: 110, height: 60 },
      'svitlo_widget_4x1.xml': { width: 180, height: 60 },
      'svitlo_widget_4x2.xml': { width: 250, height: 110 },
      'svitlo_widget_event_info.xml': { width: 110, height: 110 },
      'svitlo_widget_places_4x2.xml': { width: 110, height: 70 },
    };
    for (const [file, size] of Object.entries(expected)) {
      const xml = providerXml(file);
      expect(dpAttr(xml, 'minResizeWidth'), `${file}: minResizeWidth`).toBe(size.width);
      expect(dpAttr(xml, 'minResizeHeight'), `${file}: minResizeHeight`).toBe(size.height);
      // Заявленный (не-resize) размер задан явно: иначе лаунчер при перетаскивании
      // на рабочий стол присылает 0dp и макет схлопывается.
      expect(dpAttr(xml, 'minWidth'), `${file}: minWidth`).not.toBeNull();
      expect(dpAttr(xml, 'minHeight'), `${file}: minHeight`).not.toBeNull();
    }
  });

  it('у каждой точки состояния фиксированная высота, равная ширине', () => {
    // wrap_content на `<shape>` давал нулевую высоту: на HyperOS зелёная точка
    // превращалась в тире перед названием места.
    const problems: string[] = [];
    for (const file of LAYOUT_FILES) {
      const attrs = tagWithId(file, 'widget_dot');
      if (!attrs) continue;
      const width = dpAttr(attrs, 'layout_width');
      const height = dpAttr(attrs, 'layout_height');
      if (width === null) problems.push(`${file}: ширина точки не в dp`);
      if (height === null) problems.push(`${file}: высота точки не в dp (wrap_content?)`);
      if (width !== null && height !== null && width !== height) {
        problems.push(`${file}: точка ${width}×${height}dp, а должна быть квадратной`);
      }
      if (!/android:scaleType="fitCenter"/u.test(attrs)) {
        problems.push(`${file}: у точки нет scaleType=fitCenter`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('тексты виджета', () => {
  const STRINGS = readFileSync(path.join(RES_DIR, 'values/widget_strings.xml'), 'utf8');

  it('есть строки состояний: спокойный день, перенос, вечерний график', () => {
    for (const name of [
      'widget_no_outages_today',
      'widget_outage_moved',
      'widget_outage_cancelled',
      'widget_schedule_evening',
      'widget_schedule_pending',
    ]) {
      expect(STRINGS, name).toMatch(new RegExp(`<string name="${name}"`, 'u'));
    }
  });

  it('в макетах и строках нет эмодзи', () => {
    // Только Lucide-drawable: эмодзи в подписи на HyperOS превращается в «тофу».
    const emoji = /[\p{Extended_Pictographic}\uFE0F]/u;
    const offenders: string[] = [];
    for (const file of LAYOUT_FILES) {
      if (emoji.test(layoutXml(file))) offenders.push(`layout/${file}`);
    }
    for (const file of PROVIDER_FILES) {
      if (emoji.test(providerXml(file))) offenders.push(`xml/${file}`);
    }
    if (emoji.test(STRINGS)) offenders.push('values/widget_strings.xml');
    expect(offenders).toEqual([]);
  });
});

describe('привязка таймера и плиток', () => {
  it('кегль таймера приходит из макета, а не из жёсткого 24f', () => {
    expect(PROVIDER).toMatch(/timerSp: Float = BASE_TIMER_SP/u);
    expect(PROVIDER).not.toMatch(/COMPLEX_UNIT_SP,\s*24f\s*\)/u);
    const calls = [...PROVIDER.matchAll(/bindTimer\(context, views, payload([^)]*)\)/gu)].map(
      (match) => match[1],
    );
    expect(calls, 'все четыре макета должны звать bindTimer').toHaveLength(4);
    expect(calls.filter((args) => args.includes('timerSp = 20f'))).toHaveLength(1);
    expect(calls.filter((args) => args.includes('timerSp = 22f'))).toHaveLength(1);
    expect(calls.filter((args) => args.includes('timerSp = 24f'))).toHaveLength(2);
    // 2×1 живёт с autoSize из XML — единственный макет с таким флагом.
    expect(calls.filter((args) => args.includes('autoSize = true'))).toHaveLength(1);
  });

  it('в 4×2 подпись деталей не делит строку с таймером', () => {
    // Слипание «до відключенняНаступне відключення» на HyperOS: деталь должна стоять
    // отдельным рядом, то есть между таймером и деталью обязан закрыться LinearLayout.
    const xml = layoutXml('svitlo_widget_command.xml');
    const timer = xml.indexOf('@+id/widget_timer"');
    const detail = xml.indexOf('@+id/widget_detail"');
    expect(timer).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(timer);
    expect(xml.slice(timer, detail)).toContain('</LinearLayout>');
  });

  it('бейдж «За графіком» в 4×1 не сплющен', () => {
    const xml = layoutXml('svitlo_widget_timeline.xml');
    const pill = tagWithId('svitlo_widget_timeline.xml', 'widget_pill');
    expect(pill).not.toBeNull();
    expect(dpAttr(pill!, 'paddingVertical')).toBe(2);
    expect(pill!).toMatch(/android:textSize="9sp"/u);
    expect(pill!).toMatch(/android:gravity="center_vertical"/u);
    // Рядок пігулки не ниже 13dp — иначе текст обрезается снизу.
    const row = /<LinearLayout([^>]*android:minHeight="(\d+)dp"[^>]*)>[\s\S]*?widget_pill/u.exec(
      xml,
    );
    expect(row, 'рядок пігулки без minHeight').not.toBeNull();
    expect(Number(row![2])).toBeGreaterThanOrEqual(13);
  });
});
