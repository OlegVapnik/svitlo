import { describe, expect, it } from 'vitest';

import type { GridRegimeKind, GridRegimeSnapshot } from '@svitlo/shared';
import { visibleGridRegime } from '@svitlo/core';

import { gridRegimeBannerView } from '../src/lib/grid-regime-view';

function regime(
  kind: GridRegimeKind,
  overrides: Partial<GridRegimeSnapshot> = {},
): GridRegimeSnapshot {
  return {
    kind,
    level: kind === 'SGAV' || kind === 'GAV' ? 'emergency' : 'warning',
    titleUk: kind,
    messageUk: kind,
    affectedQueues: 'all',
    householdAffected: kind !== 'GOP_GOE',
    isEmergency: kind === 'SGAV' || kind === 'GAV',
    detectedAt: null,
    sourcePostUrl: null,
    ...overrides,
  };
}

const EMOJI = /\p{Extended_Pictographic}/u;

describe('gridRegimeBannerView', () => {
  it('СГАВ — критичний тон і текст про недіючі ГПВ', () => {
    const view = gridRegimeBannerView(regime('SGAV'));

    expect(view.tone).toBe('critical');
    expect(view.title).toContain('Введено СГАВ');
    expect(view.body).toContain('Погодинні графіки (ГПВ) зараз не діють');
    expect(view.queues).toEqual([]);
  });

  it('ГАВ — тривожний тон і перелік черг із масиву', () => {
    const view = gridRegimeBannerView(regime('GAV', { affectedQueues: ['2/2', '4/1'] }));

    expect(view.tone).toBe('alert');
    expect(view.title).toBe('Екстрені аварійні відключення (ГАВ)');
    expect(view.queues).toEqual(['2/2', '4/1']);
  });

  it('ГАВ для всієї області не дублює перелік у тексті', () => {
    const view = gridRegimeBannerView(regime('GAV'));
    expect(view.queues).toEqual([]);
  });

  it('ГОП/ГОЕ — нейтральний тон і пояснення для бізнесу', () => {
    const view = gridRegimeBannerView(
      regime('GOP_GOE', { affectedQueues: [], householdAffected: false }),
    );

    expect(view.tone).toBe('neutral');
    expect(view.body).toContain('лише для промисловості та бізнесу');
  });

  it('ГОП/ГОЕ не потрапляє на екран: visibleGridRegime повертає null', () => {
    const gop = regime('GOP_GOE', { affectedQueues: [], householdAffected: false });
    expect(visibleGridRegime(gop, '2/2')).toBeNull();
    expect(visibleGridRegime(gop, null)).toBeNull();
  });

  it('локальна аварія — інформаційний тон, ГПВ продовжує діяти', () => {
    const view = gridRegimeBannerView(regime('LOCAL_EMERGENCY'));

    expect(view.tone).toBe('info');
    expect(view.body).toContain('Погодинні графіки ГПВ продовжують діяти');
  });

  it('невідомий режим віддає текст оператора без вигадок', () => {
    const view = gridRegimeBannerView(
      regime('GPV', { titleUk: 'ГПВ', messageUk: 'Діє графік погодинних відключень' }),
    );

    expect(view.tone).toBe('neutral');
    expect(view.title).toBe('ГПВ');
    expect(view.body).toBe('Діє графік погодинних відключень');
  });

  it('жоден режим не містить емодзі', () => {
    for (const kind of [
      'SGAV',
      'GAV',
      'GOP_GOE',
      'LOCAL_EMERGENCY',
      'GPV',
      'CANCELLED',
    ] as GridRegimeKind[]) {
      const view = gridRegimeBannerView(regime(kind));
      expect(EMOJI.test(view.title), kind).toBe(false);
      expect(EMOJI.test(view.body), kind).toBe(false);
    }
  });
});
