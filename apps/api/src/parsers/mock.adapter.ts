import { ISourceAdapter, ParseResult, NormalizedOutage, NormalizedIncident } from './adapter.js';

const CHERNIHIV_AREAS = [
  'Чернігів',
  'Ніжин',
  'Прилуки',
  'Бахмач',
  'Борзна',
  'Городня',
  'Корюківка',
  'Мена',
  'Новгород-Сіверський',
  'Сновськ',
  'Сосниця',
  'Ічня',
  'Козелець',
  'Ріпки',
  'Куликівка',
];

const STREET_TEMPLATES: Record<string, string[]> = {
  'Чернігів': [
    'просп. Миру 15, 17, 19, 21; вул. Шевченка 12-48',
    'вул. Рокоссовського 2-14; вул. Всіхсвятська 3, 5, 7',
    'вул. Козацька 1-25; вул. Громадська 10-30',
    'просп. Перемоги 40-75; вул. Гонча 12, 14',
    'вул. Кільцева 1-18; вул. Бєлова 22-34',
  ],
  'Ніжин': [
    'вул. Гоголя 1-30; вул. Батюка 2-16',
    'вул. Шевченка 45-80; вул. Синяківська 1-15',
    'вул. Незалежності 10-25; вул. Носівський шлях 3-9',
  ],
  'Прилуки': [
    'вул. Київська 100-150; вул. Земська 2-20',
    'вул. Костянтинівська 15-45; вул. Гвардійська 1-18',
    'вул. Садова 5-30; вул. Ювілейна 2-14',
  ],
};

const REASONS = [
  'Плановий капітальний ремонт ТП-142',
  'Технічне обслуговування повітряної лінії ПЛ-10кВ',
  'Розчистка траси ліній електропередач від гілок',
  'Заміна трансформатора на підстанції',
  'Підключення нових споживачів',
  'Ліквідація наслідків пошкодження кабельної мережі',
];

export class MockAdapter implements ISourceAdapter {
  name = 'ChernihivoblenergoMockAdapter';
  sourceUrl = 'https://chernihivoblenergo.com.ua/blackouts';

  async fetch(): Promise<ParseResult> {
    // Simulate network delay
    await new Promise((r) => setTimeout(r, 200));

    const now = new Date();
    const outages: NormalizedOutage[] = [];

    // Generate 25 outages: 3 active right now, 10 for today, 7 for tomorrow, 5 for next days
    // 1. Active outages (started 1-2 hours ago, ends in 2-3 hours)
    for (let i = 0; i < 3; i++) {
      const area = CHERNIHIV_AREAS[i % CHERNIHIV_AREAS.length]!;
      const streets = STREET_TEMPLATES[area] || ['вул. Центральна 1-50, вул. Шкільна 2-20'];
      const startsAt = new Date(now.getTime() - (1 + i * 0.5) * 60 * 60 * 1000);
      const endsAt = new Date(now.getTime() + (2 + i * 0.5) * 60 * 60 * 1000);

      outages.push({
        startsAt,
        endsAt,
        areaName: area,
        addressesRaw: streets[i % streets.length]!,
        reason: REASONS[i % REASONS.length]!,
        queue: (i % 4) + 1,
      });
    }

    // 2. Scheduled outages for today (different time slots)
    const timeSlotsToday = [
      { startH: 9, endH: 13 },
      { startH: 13, endH: 17 },
      { startH: 14, endH: 18 },
      { startH: 17, endH: 21 },
      { startH: 18, endH: 22 },
    ];

    timeSlotsToday.forEach((slot, idx) => {
      const area = CHERNIHIV_AREAS[(idx + 3) % CHERNIHIV_AREAS.length]!;
      const streets = STREET_TEMPLATES[area] || ['вул. Молодіжна 1-15, вул. Садова 10-35'];
      const start = new Date(now);
      start.setHours(slot.startH, 0, 0, 0);
      const end = new Date(now);
      end.setHours(slot.endH, 0, 0, 0);

      outages.push({
        startsAt: start,
        endsAt: end,
        areaName: area,
        addressesRaw: streets[idx % streets.length]!,
        reason: REASONS[(idx + 2) % REASONS.length]!,
        queue: ((idx + 1) % 4) + 1,
      });
    });

    // 3. Outages for tomorrow
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const timeSlotsTomorrow = [
      { startH: 8, endH: 12 },
      { startH: 10, endH: 15 },
      { startH: 12, endH: 16 },
      { startH: 14, endH: 18 },
      { startH: 16, endH: 20 },
      { startH: 18, endH: 22 },
    ];

    timeSlotsTomorrow.forEach((slot, idx) => {
      const area = CHERNIHIV_AREAS[(idx + 7) % CHERNIHIV_AREAS.length]!;
      const start = new Date(tomorrow);
      start.setHours(slot.startH, 0, 0, 0);
      const end = new Date(tomorrow);
      end.setHours(slot.endH, 0, 0, 0);

      outages.push({
        startsAt: start,
        endsAt: end,
        areaName: area,
        addressesRaw: `вул. Соборності ${10 + idx * 5}-${25 + idx * 5}, пров. Лісовий 1-10`,
        reason: REASONS[(idx + 1) % REASONS.length]!,
        queue: (idx % 4) + 1,
      });
    });

    // 4. Outages for the next 2-4 days
    for (let dayOffset = 2; dayOffset <= 4; dayOffset++) {
      const futureDate = new Date(now);
      futureDate.setDate(futureDate.getDate() + dayOffset);

      for (let slot = 0; slot < 2; slot++) {
        const area = CHERNIHIV_AREAS[(dayOffset * 2 + slot) % CHERNIHIV_AREAS.length]!;
        const start = new Date(futureDate);
        start.setHours(9 + slot * 4, 0, 0, 0);
        const end = new Date(futureDate);
        end.setHours(13 + slot * 4, 0, 0, 0);

        outages.push({
          startsAt: start,
          endsAt: end,
          areaName: area,
          addressesRaw: `вул. Миру ${1 + slot * 10}-${15 + slot * 10}, вул. Паркова 2-18`,
          reason: REASONS[(dayOffset + slot) % REASONS.length]!,
          queue: ((dayOffset + slot) % 4) + 1,
        });
      }
    }

    // Incidents: 1 active, 1 resolved
    const incidents: NormalizedIncident[] = [
      {
        title: 'Пошкодження кабельної лінії 10 кВ у м. Чернігів',
        description:
          'Аварійне відключення частини абонентів району ЗАЗ через пошкодження підземного силового кабелю сторонньою організацією при проведенні земляних робіт. Аварійна бригада працює на місці.',
        startedAt: new Date(now.getTime() - 45 * 60 * 1000), // 45 mins ago
        etaAt: new Date(now.getTime() + 90 * 60 * 1000),     // in 1.5 hours
        severity: 'high',
      },
      {
        title: 'Аварійне відключення ТП-45 у м. Ніжин',
        description:
          'Спрацював захист трансформатора через грозову активність. Напругу відновлено в повному обсязі резервною лінією.',
        startedAt: new Date(now.getTime() - 5 * 60 * 60 * 1000),
        etaAt: null,
        severity: 'medium',
      },
    ];

    return {
      outages,
      incidents,
      gridLevel: 'warning',
      gridMessage:
        'В енергосистемі зберігається дефіцит потужності після нічних обстрілів. Застосовано графіки погодинних відключень (ГПВ) для 1–3 черг.',
      rawSnapshot: JSON.stringify({ outagesCount: outages.length, generatedAt: now.toISOString() }),
    };
  }
}
