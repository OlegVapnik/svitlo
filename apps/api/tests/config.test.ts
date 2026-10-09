import { describe, expect, test, vi } from 'vitest';

/**
 * config.ts читает process.env на импорте, поэтому каждый кейс — свой резолв модуля
 * (vi.resetModules + динамический import). DATABASE_URL обязателен, подставляем фиктивный.
 *
 * Зачем тест: PARSE_INTERVAL_MINUTES — не «настройка скорости», а гарантия вежливости к оператору
 * (skills/scraper-adapter-hardening, hard rule 2). Опечатка вида 10 не должна тихо превратиться
 * в опрос WAF каждые 10 минут — процесс обязан упасть на старте.
 */
async function importConfig(overrides: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test'); // scan:allow: фикстура теста
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  return await import('../src/config.js');
}

describe('config: PARSE_INTERVAL_MINUTES', () => {
  test('ровно 30 минут принимается (минимум из skill)', async () => {
    const { env } = await importConfig({ PARSE_INTERVAL_MINUTES: '30', PARSE_INTERVAL_JITTER_MINUTES: '5' });
    expect(env.PARSE_INTERVAL_MINUTES).toBe(30);
  });

  test('меньше 30 — ошибка конфигурации на старте', async () => {
    await expect(importConfig({ PARSE_INTERVAL_MINUTES: '29' })).rejects.toThrow(/PARSE_INTERVAL_MINUTES/u);
    await expect(importConfig({ PARSE_INTERVAL_MINUTES: '10' })).rejects.toThrow(/PARSE_INTERVAL_MINUTES/u);
  });

  test('нецелое значение тоже отвергается', async () => {
    await expect(importConfig({ PARSE_INTERVAL_MINUTES: '45.5' })).rejects.toThrow(/PARSE_INTERVAL_MINUTES/u);
  });

  test('джиттер не может быть не меньше интервала — иначе запуски наплывают друг на друга', async () => {
    await expect(
      importConfig({ PARSE_INTERVAL_MINUTES: '30', PARSE_INTERVAL_JITTER_MINUTES: '30' }),
    ).rejects.toThrow(/PARSE_INTERVAL_JITTER_MINUTES/u);
  });
});
