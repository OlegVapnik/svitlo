import { describe, expect, it } from 'vitest';

import {
  classifyGridRegimePost,
  gridRegimeAppliesToQueue,
  latestGridRegime,
  visibleGridRegime,
  type GridRegimeKind,
  type GridRegimeSnapshot,
} from '../src/grid-regime.ts';

describe('classifyGridRegimePost', () => {
  it('СГАВ — критичний режим, графіки не діють', () => {
    const regime = classifyGridRegimePost(
      'Увага! Введено спеціальний графік аварійних відключень (СГАВ) по області.',
    );

    expect(regime?.kind).toBe('SGAV');
    expect(regime?.level).toBe('emergency');
    expect(regime?.isEmergency).toBe(true);
    expect(regime?.householdAffected).toBe(true);
  });

  it('ГАВ — екстрені відключення за командою Укренерго', () => {
    const regime = classifyGridRegimePost(
      'За командою Укренерго застосовано графік аварійних відключень (ГАВ). Черги 2/2 та 4/1.',
    );

    expect(regime?.kind).toBe('GAV');
    expect(regime?.level).toBe('emergency');
    expect(regime?.affectedQueues).toEqual(['2/2', '4/1']);
  });

  it('ГПВ — штатні погодинні відключення за чергами', () => {
    const regime = classifyGridRegimePost(
      'Завтра діє графік погодинних відключень (ГПВ). Відключення за розкладом черг.',
    );

    expect(regime?.kind).toBe('GPV');
    expect(regime?.level).toBe('warning');
    expect(regime?.isEmergency).toBe(false);
    expect(regime?.affectedQueues).toBe('all');
  });

  it('ГОП/ГОЕ — лише промисловість, побут не лякаємо', () => {
    const regime = classifyGridRegimePost(
      'Введено графік обмеження потужності (ГОП) для промислових підприємств та бізнесу.',
    );

    expect(regime?.kind).toBe('GOP_GOE');
    expect(regime?.householdAffected).toBe(false);
    expect(regime?.isEmergency).toBe(false);
    expect(regime?.affectedQueues).toEqual([]);
  });

  it('локальна аварія не скасовує ГПВ по області', () => {
    const regime = classifyGridRegimePost(
      'Локальна аварія: пошкодження мережі на окремих вулицях. Графік ГПВ по області не скасовано.',
    );

    expect(regime?.kind).toBe('LOCAL_EMERGENCY');
    expect(regime?.level).toBe('warning');
    expect(regime?.isEmergency).toBe(false);
    expect(regime?.messageUk).toContain('не скасовано');
  });

  it('скасування ГАВ повертає до ГПВ, а не показує аварію', () => {
    const regime = classifyGridRegimePost('ГАВ скасовано. Повертаємось до графіків ГПВ.');

    expect(regime?.kind).toBe('CANCELLED');
    expect(regime?.level).toBe('stable');
    expect(regime?.isEmergency).toBe(false);
  });

  it('пост не про режим мережі → null', () => {
    expect(classifyGridRegimePost('Відремонтували дорогу на центральній площі.')).toBeNull();
  });
});

describe('latestGridRegime', () => {
  const now = Date.parse('2026-10-30T12:00:00.000Z');

  it('бере найсвіжіший релевантний пост', () => {
    const regime = latestGridRegime(
      [
        {
          title: 'ГАВ скасовано, повертаємось до ГПВ',
          publishedAt: '2026-10-30T11:00:00.000Z',
          url: 'https://t.me/operator/2',
        },
        {
          title: 'Введено ГАВ',
          publishedAt: '2026-10-30T09:00:00.000Z',
          url: 'https://t.me/operator/1',
        },
      ],
      { now },
    );

    expect(regime?.kind).toBe('CANCELLED');
    expect(regime?.detectedAt).toBe('2026-10-30T11:00:00.000Z');
    expect(regime?.sourcePostUrl).toBe('https://t.me/operator/2');
  });

  it('ігнорує застарілі пости старші за добу', () => {
    const regime = latestGridRegime(
      [{ title: 'Введено ГАВ', publishedAt: '2026-10-28T09:00:00.000Z' }],
      { now },
    );

    expect(regime).toBeNull();
  });

  it('пропускає нерелевантні пости й шукає режим далі', () => {
    const regime = latestGridRegime(
      [
        { title: 'Новини громади', publishedAt: '2026-10-30T11:30:00.000Z' },
        { title: 'Діє ГПВ за графіком черг', publishedAt: '2026-10-30T10:00:00.000Z' },
      ],
      { now },
    );

    expect(regime?.kind).toBe('GPV');
  });
});

function snapshot(
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

describe('gridRegimeAppliesToQueue', () => {
  it('all стосується будь-якої черги, навіть невибраної', () => {
    expect(gridRegimeAppliesToQueue({ affectedQueues: 'all' }, '2/2')).toBe(true);
    expect(gridRegimeAppliesToQueue({ affectedQueues: 'all' }, null)).toBe(true);
  });

  it('масив — лише коли черга в переліку', () => {
    const regime = { affectedQueues: ['2/2', '4/1'] };
    expect(gridRegimeAppliesToQueue(regime, '2/2')).toBe(true);
    expect(gridRegimeAppliesToQueue(regime, ' 4/1 ')).toBe(true);
    expect(gridRegimeAppliesToQueue(regime, '3/1')).toBe(false);
    expect(gridRegimeAppliesToQueue(regime, null)).toBe(false);
    expect(gridRegimeAppliesToQueue(regime, '')).toBe(false);
  });

  it('порожній масив не означає «всі»', () => {
    expect(gridRegimeAppliesToQueue({ affectedQueues: [] }, '2/2')).toBe(false);
  });
});

describe('visibleGridRegime', () => {
  it('СГАВ показуємо лише для своєї черги', () => {
    expect(visibleGridRegime(snapshot('SGAV'), '2/2')?.kind).toBe('SGAV');
    const narrow = snapshot('SGAV', { affectedQueues: ['3/1'] });
    expect(visibleGridRegime(narrow, '2/2')).toBeNull();
    expect(visibleGridRegime(narrow, '3/1')?.kind).toBe('SGAV');
  });

  it('ГАВ показуємо для всієї області або своєї черги', () => {
    expect(visibleGridRegime(snapshot('GAV'), null)?.kind).toBe('GAV');
    const narrow = snapshot('GAV', { affectedQueues: ['1/1', '5/2'] });
    expect(visibleGridRegime(narrow, '5/2')?.kind).toBe('GAV');
    expect(visibleGridRegime(narrow, '2/2')).toBeNull();
  });

  it('ГОП/ГОЕ не показуємо ніколи: побутовому користувачу плашка про бізнес не потрібна', () => {
    const gop = snapshot('GOP_GOE', {
      affectedQueues: [],
      householdAffected: false,
      isEmergency: false,
      level: 'warning',
    });
    expect(visibleGridRegime(gop, null)).toBeNull();
    expect(visibleGridRegime(gop, '2/2')).toBeNull();
    expect(visibleGridRegime(gop, '35/1')).toBeNull();
  });

  it('локальна аварія видима незалежно від черги', () => {
    expect(visibleGridRegime(snapshot('LOCAL_EMERGENCY'), null)?.kind).toBe(
      'LOCAL_EMERGENCY',
    );
  });

  it('ГПВ і скасування не додають банера', () => {
    expect(visibleGridRegime(snapshot('GPV'), '2/2')).toBeNull();
    expect(visibleGridRegime(snapshot('CANCELLED'), '2/2')).toBeNull();
    expect(visibleGridRegime(null, '2/2')).toBeNull();
  });
});

describe('тексти режимів без емодзі', () => {
  it('класифікатор не додає юнікод-емодзі в заголовок чи пояснення', () => {
    const posts = [
      'Введено спеціальний графік аварійних відключень (СГАВ) по області.',
      'За командою Укренерго застосовано графік аварійних відключень (ГАВ). Черги 2/2 та 4/1.',
      'Введено графік обмеження потужності (ГОП) для промислових підприємств та бізнесу.',
      'Локальна аварія на мережі: без світла частина вулиць. ГПВ діє.',
      'Діє графік погодинних відключень (ГПВ) за чергами.',
    ];
    const emoji = /\p{Extended_Pictographic}/u;
    for (const post of posts) {
      const regime = classifyGridRegimePost(post);
      expect(regime, post).not.toBeNull();
      expect(emoji.test(regime!.titleUk), post).toBe(false);
      expect(emoji.test(regime!.messageUk), post).toBe(false);
    }
  });
});
