import { expect, test } from 'vitest';
import { MockAdapter } from '../../src/parsers/mock.adapter.js';

test('MockAdapter returns valid result', async () => {
  const adapter = new MockAdapter();
  const res = await adapter.fetch();
  expect(res.gridLevel).toBe('warning');
  expect(res.outages.length).toBeGreaterThan(0);
  expect(res.incidents.length).toBeGreaterThan(0);
});
