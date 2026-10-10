import { expect, test } from 'vitest';
import {
  isRepairIncident,
  shouldKeepRegionalIncident,
} from '../../src/services/outage-classification.js';

test('repair maintenance goes to incident classification', () => {
  expect(
    isRepairIncident('Виконання ремонтних робіт на обладнанні підстанції (ПС, РП, ТП, КТП)'),
  ).toBe(true);
  expect(isRepairIncident('Заходи обмеження')).toBe(false);
});

test('regional incident news must mention Chernihiv or Sumy oblast', () => {
  expect(
    shouldKeepRegionalIncident('Аварія на Чернігівщині', 'Чернігівська область без світла'),
  ).toBe(true);
  expect(shouldKeepRegionalIncident('Аварійні роботи', 'Подія сталася в іншому регіоні')).toBe(
    false,
  );
  expect(shouldKeepRegionalIncident('Новини Сумської області', 'Пошкоджена електролінія')).toBe(
    true,
  );
});
