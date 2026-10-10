import { describe, expect, test, vi } from 'vitest';

/**
 * config.ts читает process.env на импорте, поэтому каждый кейс — свой резолв модуля
 * (vi.resetModules + динамический import). DATABASE_URL обязателен, подставляем фиктивный.
 *
 * Зачем тест: раньше PARSE_INTERVAL_MINUTES имел минимум 30 мин (вежливость к оператору).
 * После дозвола оператора (2026-10-10, див. AGENTS.md) минимум снят: короткие интервалы допустимы,
 * но 0 и отрицательные — ошибка на старте (cron не приймає нулевий крок).
 */
async function importConfig(overrides: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test'); // scan:allow: фикстура теста
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  return await import('../src/config.js');
}

describe('config: PARSE_INTERVAL_MINUTES', () => {
  test('ровно 30 минут принимается (типовой дефолт)', async () => {
    const { env } = await importConfig({ PARSE_INTERVAL_MINUTES: '30', PARSE_INTERVAL_JITTER_MINUTES: '5' });
    expect(env.PARSE_INTERVAL_MINUTES).toBe(30);
  });

  test('меньше 30 теперь допустимо (дозвіл оператора 2026-10-10)', async () => {
    const { env } = await importConfig({ PARSE_INTERVAL_MINUTES: '10', PARSE_INTERVAL_JITTER_MINUTES: '5' });
    expect(env.PARSE_INTERVAL_MINUTES).toBe(10);
  });

  test('0 и отрицательное отвергаются (cron не приймає нулевий крок)', async () => {
    await expect(importConfig({ PARSE_INTERVAL_MINUTES: '0' })).rejects.toThrow(/PARSE_INTERVAL_MINUTES/u);
    await expect(importConfig({ PARSE_INTERVAL_MINUTES: '-5' })).rejects.toThrow(/PARSE_INTERVAL_MINUTES/u);
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
