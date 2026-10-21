import type { StatusResponse } from '@svitlo/shared';
import { and, eq, gt, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/connection.js';
import { gridStatus, outageEvents, scheduleSlots, sources } from '../db/schema.js';
import { getIncidents } from './incidents.service.js';
import { getPowerSummary } from './power-summary.service.js';
import { summarizeSourceHealth } from './source-breaker.js';

/**
 * Збирає контракт `GET /api/v1/status` для області.
 *
 * Чому це сервіс, а не тіло маршруту. Той самий стан мережі потрібен двом ендпоінтам: `/status`
 * (його тягне веб-вкладка) і `/sync` (ним гідратується офлайн-кеш телефону). Доти логіка жила
 * прямо в обробнику `/status`, і `/sync` довелося б або дублювати шість запитів до БД, або
 * робити внутрішній HTTP-виклик через `fastify.inject` — обидва варіанти гарантують, що через
 * місяць цифри на головній і в офлайн-пакеті розійдуться. Тепер джерело правди одне.
 *
 * `now` передається параметром, а не береться всередині: тести заморожують час, і обчислення
 * «активна група зараз» мусить рахуватися від нього, а не від системного годинника.
 */
export async function buildStatusPayload(region: string, now: Date = new Date()): Promise<StatusResponse> {
  const [status] = await db.select().from(gridStatus).orderBy(sql`${gridStatus.updatedAt} desc`).limit(1);

  // Рахуємо КАНОНІЧНІ події (invariant 5 у outage-data-core): одна реальна перерва = одна подія,
  // а не 30 адресних рядків. Статус ОБЧИСЛЮЄТЬСЯ, а не береться зі сховища: cancelled_at →
  // скасовано, інакше за starts_at/ends_at і «зараз». «Зараз» приходить з JS (Date), не з SQL
  // now(), щоб тест міг заморозити час; ORM-шлях мапить Date у рядок для timestamptz
  // (postgres.js валиться лише на Date у сирому sql-шаблоні — див. outage-events-writer.ts).
  const [activeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outageEvents)
    .where(
      and(
        isNull(outageEvents.cancelledAt),
        lte(outageEvents.startsAt, now),
        or(isNull(outageEvents.endsAt), gte(outageEvents.endsAt, now)),
      ),
    );
  const [scheduledRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outageEvents)
    .where(and(isNull(outageEvents.cancelledAt), gt(outageEvents.startsAt, now)));
  const activeOutages = activeRow?.count ?? 0;
  const scheduledOutages = scheduledRow?.count ?? 0;

  // Той самий список, що й на сторінці «Аварії та ремонтні роботи».
  const incidentList = await getIncidents(now);
  const activeIncidents = incidentList.filter((incident) => incident.status === 'active').length;
  const scheduledIncidents = incidentList.filter((incident) => incident.status === 'scheduled').length;

  // Счётчики по группам за графиком ГПВ области.
  //
  // Раньше «активні/заплановані» считались только по outage_events, а это точечные ремонтные
  // отключения — их единицы, и при выключенном аварийном сборе показатели обнулялись, хотя
  // реальный график по группам в базе был. Теперь они считаются по schedule_slots: столько
  // групп области реально сейчас без света / погашены дальше по графику.
  const kyivDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const kyivTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const [activeGroupsRow] = await db
    .select({ count: sql<number>`count(distinct ${scheduleSlots.queue})::int` })
    .from(scheduleSlots)
    .where(
      and(
        eq(scheduleSlots.region, region),
        eq(scheduleSlots.date, kyivDate),
        eq(scheduleSlots.stateCode, 3),
        lte(scheduleSlots.timeFrom, kyivTime),
        or(gte(scheduleSlots.timeTo, kyivTime), eq(scheduleSlots.timeTo, '00:00')),
      ),
    );
  const [scheduledGroupsRow] = await db
    .select({ count: sql<number>`count(distinct ${scheduleSlots.queue})::int` })
    .from(scheduleSlots)
    .where(
      and(
        eq(scheduleSlots.region, region),
        eq(scheduleSlots.date, kyivDate),
        eq(scheduleSlots.stateCode, 3),
        gt(scheduleSlots.timeFrom, kyivTime),
      ),
    );
  const activeGroups = activeGroupsRow?.count ?? 0;
  const scheduledGroups = scheduledGroupsRow?.count ?? 0;

  const powerSummary = await getPowerSummary(region, now);
  const lastUpdatedAt = status?.updatedAt ?? null;
  const dataStale = !lastUpdatedAt || now.getTime() - lastUpdatedAt.getTime() > 2 * 60 * 60 * 1000;
  // Рівень беремо з таблиці `grid_status`, але обов'язково звужуємо до трьох станів контракту:
  // колонка — звичайний `text`, і будь-яке нерозпізнане значення (стара миграція, ручна правка)
  // інакше потрапило б у `StatusResponse` як довільний рядок. Нерозпізнане показуємо як 'stable' —
  // рівно так само робить клієнт (`status?.grid?.level ?? 'stable'` у HomePage), тому поведінка
  // для людини не змінюється.
  const storedLevel = status?.level;
  const level: StatusResponse['grid']['level'] =
    storedLevel === 'warning' || storedLevel === 'emergency' ? storedLevel : 'stable';
  const gridMessage = status?.message ?? '';

  // Circuit breaker источников (skills/scraper-adapter-hardening требует dataStale + lastError +
  // nextAttemptAt): оператор может заблокировать IP, и тогда честный ответ «когда данные
  // обновятся» важнее пустого экрана. Персональных данных здесь нет — last_error уже прогнан
  // через sanitizeSourceError (длинные цифровые последовательности заменены на <number>).
  const sourceRows = await db
    .select({
      name: sources.name,
      consecutiveFailures: sources.consecutiveFailures,
      pausedUntil: sources.pausedUntil,
      lastError: sources.lastError,
    })
    .from(sources)
    .where(sql`is_active = true`);
  const sourceHealth = summarizeSourceHealth(sourceRows, now, {
    schedulerEnabled: env.ENABLE_SCHEDULER,
    intervalMinutes: env.PARSE_INTERVAL_MINUTES,
  });

  return {
    grid: { level, message: gridMessage },
    activeOutages,
    scheduledOutages,
    // Счётчики групп за графиком ГПВ области (region у вище).
    activeGroups,
    scheduledGroups,
    activeIncidents,
    scheduledIncidents,
    totalIncidents: incidentList.length,
    lastUpdatedAt: lastUpdatedAt?.toISOString() ?? null,
    dataStale,
    ...sourceHealth,
    powerSummary,
  };
}
