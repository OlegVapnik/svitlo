import { useCallback, useState } from 'react';
import { isQueueCode, normalizeQueueCode } from '../lib/queue.js';
import { normalizeRegionCpu } from '../lib/region.js';

/** Ключ localStorage: версионованный, чтобы ломать (мигрировать) устаревшие форматы. */
const BOOKMARKS_KEY = 'svitlo_bookmarks';
const BOOKMARKS_SCHEMA_VERSION = 1;

/**
 * Закладка групи/локації: «Дім — Київ, черга 3.1», «Батьки — с. Деснянське, черга 2/2»,
 * «Робота — Львів, черга 1.2». Користувач може тримати кілька закладок з РІЗНИХ областей
 * України й перемикатися між ними в 1 клік на головній і в /queues.
 */
export interface Bookmark {
  id: string;
  /** Людська підпис для чипа/списку (напр. «Дім» або «с. Деснянське»). */
  label: string;
  /** cpu області з каталогу /regions (напр. 'kyiv-city'). Кожна закладка несе СОЮ область. */
  regionCpu: string;
  /** Назва населеного пункту (села/смт/міста), якщо закладка = вулиця/село. */
  settlementName?: string;
  /** Назва вулиці, якщо закладка = конкретна вулиця в селі/місті. */
  streetName?: string;
  /** Черга у форматі застосунку ('3', '2/2'). */
  queue: string;
  /** Головна закладка — та, що показується в герої на головній, якщо декілька. */
  isPrimary?: boolean;
}

interface StoredBookmarks {
  schemaVersion: number;
  bookmarks: Bookmark[];
}

/** Перевіряє, чи валідна закладка: усі обов'язкові поля присутні, черга й область коректні. */
function isValidBookmark(value: unknown): value is Bookmark {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.id === 'string' && b.id.length > 0 &&
    typeof b.label === 'string' && b.label.trim().length > 0 &&
    typeof b.regionCpu === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.regionCpu) &&
    typeof b.queue === 'string'
  );
}

/**
 * Читає закладки з localStorage, відфільтровуючи мусор старих версій (схема, що не збігається
 * з поточною, вважається застарілою і не використовується).
 *
 * Експортовано, бо список потрібен і поза React-компонентом: фонова перевірка сповіщень про
 * відключення читає ті самі закладки, щоб знати, за якими чергами стежити.
 */
export function loadBookmarks(): Bookmark[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredBookmarks;
    if (parsed.schemaVersion !== BOOKMARKS_SCHEMA_VERSION) return [];
    return (parsed.bookmarks ?? []).filter(isValidBookmark);
  } catch {
    return [];
  }
}

/** Зберігає закладки в localStorage з актуальною версією схеми. */
function persistBookmarks(bookmarks: Bookmark[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: StoredBookmarks = { schemaVersion: BOOKMARKS_SCHEMA_VERSION, bookmarks };
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
}

function makeId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `bm-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Закладки груп/локацій з усієї України.
 *
 * На відміну від `useMyQueues` (масив рядків без області), закладка несе свою область,
 * населений пункт і вулицю — тому графік запитується по `regionCpu` закладки, а не по
 * глобальній поточній області.
 */
export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);

  const sync = useCallback((next: Bookmark[]) => {
    setBookmarks(next);
    persistBookmarks(next);
  }, []);

  /** Додає (або оновлює) закладку. Якщо така область+черга вже є — не створює дублікат, а повертає її id. */
  const addBookmark = useCallback((input: Omit<Bookmark, 'id'> & { allowDuplicate?: boolean }): string => {
    const queue = normalizeQueueCode(input.queue);
    if (!isQueueCode(queue)) return '';
    const regionCpu = normalizeRegionCpu(input.regionCpu);
    const label = input.label.trim();

    let next: Bookmark[];
    let createdId = '';
    setBookmarks((prev) => {
      // «Дім» і «Робота» можуть бути на одній групі: при allowDuplicate один адрес не
      // схлопується з іншим. Без флага поведінка попередня — одна закладка на область+чергу.
      const existing = prev.find(
        (b) =>
          b.regionCpu === regionCpu &&
          b.queue === queue &&
          (!input.allowDuplicate ||
            (b.settlementName === input.settlementName && b.streetName === input.streetName)),
      );
      if (existing) {
        // Уже є закладка на цю область+чергу. Раніше її підпис МОВЧКИ перезаписувався новим —
        // через що «Дім» і «Робота» на одній групі не могли існувати разом, а старе назва
        // зникало без запиту. Тепер існуючу закладку не чіпаємо: перейменувати її можна
        // явно (renameBookmark), додавання — не приховане редагування.
        next = prev;
        createdId = existing.id;
      } else {
        createdId = makeId();
        next = [...prev, {
          id: createdId,
          label: label || `${regionCpu} · ${queue}`,
          regionCpu,
          settlementName: input.settlementName,
          streetName: input.streetName,
          queue,
          isPrimary: prev.length === 0 ? true : input.isPrimary,
        }];
      }
      persistBookmarks(next);
      return next;
    });
    return createdId;
  }, []);

  /**
   * Перейменувати закладку («Дім», «Робота», «Вулиця Шевченка»).
   *
   * Раніше перейменувати було нечем: назва змінювалася лише побічним шляхом — повторним
   * addBookmark з тим самим region+queue, який ще й затирав адресу попередньої закладки.
   */
  const renameBookmark = useCallback((id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setBookmarks((prev) => {
      const next = prev.map((b) => (b.id === id ? { ...b, label: trimmed } : b));
      persistBookmarks(next);
      return next;
    });
  }, []);

  const removeBookmark = useCallback((id: string) => {
    setBookmarks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      // Якщо видалили головну й лишились інші — перша стає головною.
      if (next.length > 0 && !next.some((b) => b.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      persistBookmarks(next);
      return next;
    });
  }, []);

  /** Виставляє активну (головну) закладку — що показувати в герої на головній. */
  const setPrimaryBookmark = useCallback((id: string) => {
    setBookmarks((prev) => {
      const next = prev.map((b) => ({ ...b, isPrimary: b.id === id }));
      persistBookmarks(next);
      return next;
    });
  }, []);

  const primaryBookmark = bookmarks.find((b) => b.isPrimary) ?? bookmarks[0] ?? null;

  return {
    bookmarks,
    primaryBookmark,
    addBookmark,
    removeBookmark,
    setPrimaryBookmark,
    renameBookmark,
  };
}