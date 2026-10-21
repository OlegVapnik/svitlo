import { describe, expect, test } from 'vitest';
import {
  extractIncidentArea,
  extractIncidentCause,
  extractIncidentDetails,
  extractIncidentTimeRange,
} from '../../src/services/incident-details.js';

describe('extractIncidentArea', () => {
  test('розпізнає село Деснянське та місто Чернігів', () => {
    expect(extractIncidentArea('Аварійне відключення у с. Деснянське, вул. Зарічна')).toBe('Деснянське');
    expect(extractIncidentArea('Пошкодження кабелю у м. Чернігів')).toBe('Чернігів');
  });

  test('віддає перевагу області, якщо її згадано першою', () => {
    expect(extractIncidentArea('На Чернігівщині без світла залишились кілька сіл')).toBe('Чернігівська область');
    expect(extractIncidentArea('Сумська область: пошкоджено електролінію')).toBe('Сумська область');
  });

  test('працює зі скороченнями м./с./смт як запасний варіант', () => {
    expect(extractIncidentArea('Відключено смт Замглай')).toBe('Замглай');
    expect(extractIncidentArea('без згадки місця')).toBeNull();
  });
});

describe('extractIncidentCause', () => {
  test('визначає типові причини знеструмлення', () => {
    expect(extractIncidentCause('Внаслідок обстрілу пошкоджено лінію 10 кВ')).toBe('Обстріл / бойові дії');
    expect(extractIncidentCause('Обрив дроту на повітряній лінії')).toBe('Пошкодження мережі');
    expect(extractIncidentCause('Спрацював захист трансформатора на ТП-45')).toBe('Аварія на обладнанні');
    expect(extractIncidentCause('Виконання ремонтних робіт на обладнанні підстанції')).toBe('Ремонтні роботи');
    expect(extractIncidentCause('Через негоду та сильний вітер')).toBe('Негода');
    expect(extractIncidentCause('Застосовано графік погодинних відключень')).toBe('Перевантаження мережі');
  });

  test('повертає null, якщо причини немає', () => {
    expect(extractIncidentCause('Вітаємо зі святом')).toBeNull();
  });
});

describe('extractIncidentTimeRange', () => {
  test('витягує проміжок часу у різних форматах', () => {
    expect(extractIncidentTimeRange('Відключення з 14:30 до 18:00')).toBe('14:30 – 18:00');
    expect(extractIncidentTimeRange('Години без світла 09.00-12.00')).toBe('09:00 – 12:00');
    expect(extractIncidentTimeRange('без часу')).toBeNull();
  });
});

describe('extractIncidentDetails', () => {
  test('повертає місце, причину та час разом', () => {
    const details = extractIncidentDetails('Через обстріл у Чернігівській області, м. Ніжин, без світла з 14:30 до 18:00');
    expect(details.area).toBe('Чернігівська область');
    expect(details.cause).toBe('Обстріл / бойові дії');
    expect(details.timeRange).toBe('14:30 – 18:00');
  });
});
