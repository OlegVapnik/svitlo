/**
 * Юніт-тести для чистої допоміжної функції readRegionParam (regions.service.ts).
 *
 * Перевірка граничних значень без підключення до БД та без мережевих запитів:
 * валідація довжини (>64), захист від сміття, відхилення великих літер,
 * обробка порожнього вводу та коректний розбір валідних cpu областей.
 */
process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test'; // scan:allow: фікстура теста
process.env['LOG_LEVEL'] ??= 'silent';

import { beforeAll, describe, expect, it } from 'vitest';
import type { AppError as AppErrorType } from '../../src/utils/errors.js';

let readRegionParam: typeof import('../../src/services/regions.service.js').readRegionParam;
let DEFAULT_REGION: string;
let AppError: typeof import('../../src/utils/errors.js').AppError;

describe('readRegionParam — граничні значення та валідація ?region=', () => {
  beforeAll(async () => {
    const regionsService = await import('../../src/services/regions.service.js');
    readRegionParam = regionsService.readRegionParam;
    DEFAULT_REGION = regionsService.DEFAULT_REGION;
    const errorsModule = await import('../../src/utils/errors.js');
    AppError = errorsModule.AppError;
  });
  it('порожній рядок повертає дефолтний регіон', () => {
    // ЧОМУ: клієнти без параметра ?region= або з порожнім ?region= мають без помилок отримувати дефолтну легасі-область (контракт /tmp/API-CONTRACT-regions.md).
    expect(readRegionParam('')).toBe(DEFAULT_REGION);
  });

  it('рядок лише з пробілів повертає дефолтний регіон', () => {
    // ЧОМУ: значення тримиться, тому пробільний рядок еквівалентний порожньому і не повинен викликати 400 помилку.
    expect(readRegionParam('   ')).toBe(DEFAULT_REGION);
  });

  it('undefined та null повертають дефолтний регіон', () => {
    // ЧОМУ: коли query-параметр зовсім не передано у запиті, Fastify передає undefined, який має безпечно фолбекнутися на DEFAULT_REGION.
    expect(readRegionParam(undefined)).toBe(DEFAULT_REGION);
    expect(readRegionParam(null)).toBe(DEFAULT_REGION);
  });

  it('валідний kebab-case cpu повертається без змін', () => {
    // ЧОМУ: стандартні ідентифікатори областей із фіда дзеркала (наприклад kyivska-oblast або chernihivska-oblast) є основним валідним вводом.
    expect(readRegionParam('kyivska-oblast')).toBe('kyivska-oblast');
    expect(readRegionParam('chernihivska-oblast')).toBe('chernihivska-oblast');
    expect(readRegionParam('lvivska-oblast')).toBe('lvivska-oblast');
    expect(readRegionParam('kyiv-city')).toBe('kyiv-city');
  });

  it('валідний cpu із цифрами успішно проходить валідацію', () => {
    // ЧОМУ: REGION_CPU_PATTERN дозволяє цифри у сегментах (наприклад region-1 або zone-2).
    expect(readRegionParam('region-1')).toBe('region-1');
  });

  it('валідний cpu з пробілами по краях очищається тримом', () => {
    // ЧОМУ: випадкові пробіли на початку чи в кінці не повинні відхиляти коректний запит користувача.
    expect(readRegionParam('  kyivska-oblast  ')).toBe('kyivska-oblast');
  });

  it('довжина рівно 64 символи (валідний cpu) успішно приймається', () => {
    // ЧОМУ: 64 символи — це максимально дозволена довжина ідентифікатора області (value.length <= 64).
    // Будуємо 64-символьний валідний kebab-case: 21 блок "ab-" (63) + "a" (1) = 64 символи.
    const valid64 = 'ab-'.repeat(21) + 'a';
    expect(valid64.length).toBe(64);
    expect(readRegionParam(valid64)).toBe(valid64);
  });

  it('довжина > 64 символів викликає помилку 400 VALIDATION_ERROR', () => {
    // ЧОМУ: задовгі ідентифікатори (>64) відхиляються як підозрілий ввід, щоб запобігти аномальним рядкам у логах та SQL-запитах.
    const tooLong = 'ab-'.repeat(21) + 'ab'; // 65 символів
    expect(tooLong.length).toBe(65);
    expect(() => readRegionParam(tooLong)).toThrow(AppError);
    try {
      readRegionParam(tooLong);
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(400);
      expect(appErr.code).toBe('VALIDATION_ERROR');
    }
  });

  it('сміття та спецсимволи викликають помилку 400 VALIDATION_ERROR', () => {
    // ЧОМУ: знаки оклику, слеші, пробіли всередині рядка — це підозрілі параметри, які не є валідним cpu.
    expect(() => readRegionParam('Kyiv City!')).toThrow(AppError);
    expect(() => readRegionParam('chernihiv/oblast')).toThrow(AppError);
    expect(() => readRegionParam('kyiv;drop-table')).toThrow(AppError);
  });

  it('символ підкреслення викликає помилку 400 VALIDATION_ERROR', () => {
    // ЧОМУ: формат вимагає виключно kebab-case (дефіс), snake_case заборонений контрактом.
    expect(() => readRegionParam('chernihivska_oblast')).toThrow(AppError);
  });

  it('великі літери (uppercase) викликають помилку 400 VALIDATION_ERROR', () => {
    // ЧОМУ: ідентифікатори cpu за контрактом складаються виключно з малих латинських літер, CamelCase або UPPERCASE є невалідними.
    expect(() => readRegionParam('Chernihivska-Oblast')).toThrow(AppError);
    expect(() => readRegionParam('KYIV')).toThrow(AppError);
  });

  it('кирилиця викликає помилку 400 VALIDATION_ERROR', () => {
    // ЧОМУ: cpu — це технічний латинський slug із дзеркала; українські назви віддаються полем nameUa і не використовуються як cpu в параметрі ?region=.
    expect(() => readRegionParam('чернігівська-область')).toThrow(AppError);
  });

  it('подвійні дефіси або дефіси на кінцях викликають помилку 400 VALIDATION_ERROR', () => {
    // ЧОМУ: регулярний вираз REGION_CPU_PATTERN вимагає непорожні сегменти між дефісами, тому -kyiv чи kyiv--oblast є невалідними.
    expect(() => readRegionParam('-kyiv')).toThrow(AppError);
    expect(() => readRegionParam('kyiv-')).toThrow(AppError);
    expect(() => readRegionParam('kyiv--oblast')).toThrow(AppError);
  });
});
