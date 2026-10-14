import { useEffect, useState } from 'react';

/**
 * Тик времени, синхронизированный С МИНУТНОЙ ГРАНИЦЕЙ, и останавливающийся в фоновой вкладке.
 *
 * Зачем не раз в секунду. Обратный отсчёт в Hero показывает минуты, поэтому обновление
 * текста раз в секунду давало нулевую пользу ценой 60 перерисовок в минуту: телефон
 * просыпался, разогревался и тратил батарею на ровно ту же картинку. Здесь обновление
 * происходит один раз в минуту — когда реально меняется набор цифр.
 *
 * Зачем Page Visibility. Приложение открывают в основном в дороге и в темноте, то есть
 * телефон лежит в кармане с закрытым экраном. Таймер, тикающий в фоне, будил бы процесс
 * каждую минуту и держал радио включённым. Когда вкладка не видима — таймер не создан
 * вовсе, а не «сброшен»: синхронизация происходит сразу при возврате к вкладке.
 */
export function useMinuteTicker(): Date {
  const [now, setNow] = useState(() => new Date());
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!visible) return;

    let timer: number | undefined;

    // Ставим таймер ровно на следующую минутную границу, а не «через 60 секунд»:
    // иначе со временем накапливался бы сдвиг, и минута в интерфейсе менялась бы позже
    // настоящей на всё большее число секунд.
    const schedule = () => {
      const delay = (60 - (Date.now() / 1000) % 60) * 1000;
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };

    // При возврате к вкладке сразу синхронизируемся: пока вкладка была скрыта, могло
    // пройти несколько часов, и без этого отсчёт показывал бы время из прошлого.
    setNow(new Date());
    schedule();

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [visible]);

  return now;
}
