import { describe, expect, test } from 'vitest';
import { accountNumberSchema, subscriberPlaceInputSchema } from '@svitlo/shared';

/**
 * Контракт довідника «рахунок → вулиця + черга». Схема — единственная защита маршрута
 * GET /api/v1/places/:account от мусора: без неё любой текст уходил бы в SQL.
 */
describe('accountNumberSchema', () => {
  test('принимает 9–12 цифр и обрезает пробелы', () => {
    expect(accountNumberSchema.parse('987654321')).toBe('987654321');
    expect(accountNumberSchema.parse(' 9876543210 ')).toBe('9876543210'); // scan:allow: синтетический фикстур-номер
  });

  test('отвергает короткие, длинные и нецифровые номера', () => {
    expect(() => accountNumberSchema.parse('12345678')).toThrow(); // scan:allow: синтетический фикстур-номер
    expect(() => accountNumberSchema.parse('1234567890123')).toThrow();
    expect(() => accountNumberSchema.parse('98765432a')).toThrow();
    expect(() => accountNumberSchema.parse('')).toThrow();
  });
});

describe('subscriberPlaceInputSchema', () => {
  test('принимает улицу и чергу в формате «3» или «2/2»', () => {
    const parsed = subscriberPlaceInputSchema.parse({ account: '987654321', street: 'вул. Зарічна', queue: '2/2' });
    expect(parsed).toEqual({ account: '987654321', street: 'вул. Зарічна', queue: '2/2' });
  });

  test('отвергает короткую улицу и неверный код очереди', () => {
    expect(() => subscriberPlaceInputSchema.parse({ account: '987654321', street: 'З', queue: '3' })).toThrow();
    expect(() => subscriberPlaceInputSchema.parse({ account: '987654321', street: 'вул. Зарічна', queue: 'черга' })).toThrow();
  });
});