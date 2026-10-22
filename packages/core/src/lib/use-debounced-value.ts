import { useEffect, useState } from 'react';

/**
 * Значение, которое меняется не чаще `delayMs`.
 *
 * Нужен там, где каждый символ в поле ввода превращается в сетевой запрос: без задержки
 * автокомплит улиц успевал сходить в D1 на «Х», «Хр», «Хре» и выжигал дневной лимит `rows_read`.
 * Сам ввод остаётся мгновенным — задерживается только запрос.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
