/**
 * Захисні жести нативної оболонки.
 *
 * У APK сторінка живе в Android WebView. Навіть із `user-select: none` WebView показує
 * контекстне меню (копировать/поиск/поделиться) по довгому натисканню на посиланні чи кнопці —
 * саме воно видає застосунок за браузер. У звичайному браузері меню залишаємо: там людині
 * справді може знадобитися «Відкрити в новій вкладці» або «Копіювати адресу».
 *
 * Міст `SvitloNative` є тільки в APK (MainActivity.java), тому перевірка на нього — надійна
 * ознака нативного режиму й не потребує user-agent-сниффинга.
 */
const INTERACTIVE_SELECTOR = 'a, button, input, textarea, [role="button"], [role="tab"]';

function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as Window & { SvitloNative?: unknown }).SvitloNative);
}

export function installNativeGuards(): void {
  if (!isNativeShell()) return;

  document.addEventListener(
    'contextmenu',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Поля вводу не чіпаємо: без системного меню не буде вставки й «виділити все».
      if (target.closest('input, textarea, [contenteditable="true"], .selectable-text')) return;
      if (!target.closest(INTERACTIVE_SELECTOR)) return;
      event.preventDefault();
    },
    { capture: true },
  );
}
