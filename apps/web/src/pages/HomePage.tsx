import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Zap,
  ZapOff,
  AlertTriangle,
  Clock,
  ArrowRight,
  Calendar,
  PhoneCall,
  MapPin,
  Building2,
} from 'lucide-react';
import { StatusIndicator } from '../components/status/StatusIndicator.js';
import { LastUpdated } from '../components/status/LastUpdated.js';
import { PowerSummaryCard } from '../components/status/PowerSummaryCard.js';
import { ReliabilityCard } from '../components/status/ReliabilityCard.js';
import { IncidentBanner } from '../components/incidents/IncidentBanner.js';
import { OutageCard } from '../components/outages/OutageCard.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { useStatus, useOutages, useIncidents, useReliability } from '../api/queries.js';
import { useMyQueues } from '../hooks/useMyQueues.js';
import { QueueScheduleBar } from '../components/schedule/QueueScheduleBar.js';
import type { ScheduleIntervalUtc } from '@energy-monitor/shared';
import { useEffect, useState } from 'react';
import type { Outage } from '@energy-monitor/shared';

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const { data: statusData, isLoading: statusLoading } = useStatus();
  const { data: reliabilityData, isLoading: reliabilityLoading } = useReliability();
  const { data: outagesData, isLoading: outagesLoading } = useOutages({ limit: 5 });
  const { data: incidentsData } = useIncidents();
  const { queues } = useMyQueues();
  const [queueSchedule, setQueueSchedule] = useState<ScheduleIntervalUtc[]>([]);
  const [scheduleError, setScheduleError] = useState(false);
  const [scheduleIsDemo, setScheduleIsDemo] = useState(false);
  const selectedQueue = queues[0];
  useEffect(() => {
    if (!selectedQueue) return;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    setScheduleError(false);
    fetch(`/api/v1/schedules?queue=${encodeURIComponent(selectedQueue)}&date=${date}`).then((res) => res.json()).then((res) => { setQueueSchedule(res.data.intervals); setScheduleIsDemo(Boolean(res.data.demo)); }).catch(() => setScheduleError(true));
  }, [selectedQueue]);

  const activeIncidents = incidentsData?.data?.filter((i) => i.status === 'active') || [];
  const status = statusData?.data;
  const outages = (outagesData?.data || []).map((item) => ({
    ...item,
    addressesRaw: item.addressesNormalized,
    sourceId: '',
    contentHash: '',
    firstSeenAt: item.startsAt,
    updatedAt: item.startsAt,
  })) as Outage[];

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16 md:pb-6">
      {/* Active Incident Banner */}
      {activeIncidents.length > 0 && <IncidentBanner incident={activeIncidents[0]!} />}

      {/* Grid Status Hero Card */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Стан енергосистеми Чернігівщини
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Моніторинг мережі АТ «Чернігівобленерго» в реальному часі
            </p>
          </div>
          {status?.lastUpdatedAt && <LastUpdated timestamp={status.lastUpdatedAt} />}
        </div>

        {/* Main Status Indicator */}
        <StatusIndicator level={status?.grid?.level || 'stable'} message={status?.grid?.message} />

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          <div className="p-3 rounded-xl bg-muted/40 border border-border/50">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ZapOff className="w-3.5 h-3.5 text-red-500" />
              <span>Активні</span>
            </div>
            <div className="text-xl font-bold text-foreground mt-1">
              {statusLoading ? <Skeleton className="h-6 w-8" /> : status?.activeOutages ?? 0}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-muted/40 border border-border/50">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5 text-amber-500" />
              <span>Заплановані</span>
            </div>
            <div className="text-xl font-bold text-foreground mt-1">
              {statusLoading ? <Skeleton className="h-6 w-8" /> : status?.scheduledOutages ?? 0}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-muted/40 border border-border/50">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
              <span>Аварії та роботи</span>
            </div>
            <div className="text-xl font-bold text-foreground mt-1">
              {statusLoading ? <Skeleton className="h-6 w-8" /> : status?.totalIncidents ?? status?.activeIncidents ?? 0}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              тривають: {statusLoading ? '—' : status?.activeIncidents ?? 0}
            </div>
          </div>
        </div>

        {/* Підсумок електропостачання — замінює раніше зашите «Надійність 98.2%». */}
        <PowerSummaryCard summary={status?.powerSummary} isLoading={statusLoading} />
        <ReliabilityCard report={reliabilityData?.data} isLoading={reliabilityLoading} />

        {/* Stale warning if data is old */}
        {status?.dataStale && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Дані можуть бути застарілими. Останнє оновлення було більше ніж 2 години тому.</span>
          </div>
        )}
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Link
          to="/outages"
          className="p-4 rounded-xl border border-border bg-card hover:border-primary/50 transition-all group flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-500">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Графік відключень</div>
              <div className="text-xs text-muted-foreground">Список, календар, карта</div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </Link>

        <Link
          to="/my-address"
          className="p-4 rounded-xl border border-border bg-card hover:border-primary/50 transition-all group flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Моя адреса</div>
              <div className="text-xs text-muted-foreground">Перевірка свого будинку</div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </Link>

        <Link
          to="/contacts"
          className="p-4 rounded-xl border border-border bg-card hover:border-primary/50 transition-all group flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-500">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Гаряча лінія</div>
              <div className="text-xs text-muted-foreground">0 800 210-310</div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </Link>

        <Link
          to="/streets"
          className="p-4 rounded-xl border border-border bg-card hover:border-primary/50 transition-all group flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-500">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Вулиці села</div>
              <div className="text-xs text-muted-foreground">Черга за адресою</div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      {selectedQueue && <Card><CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Мій графік · {localStorage.getItem('myQueueStreet') || 'Деснянське'} · {selectedQueue}</h2><Link to="/queues" className="text-sm text-primary underline">Мої черги</Link></div>
        {scheduleIsDemo && <p className="text-xs font-medium text-amber-600">ДЕМО-графік, синтетичні дані — не використовуйте для планування.</p>}
        {queueSchedule.length ? <QueueScheduleBar intervals={queueSchedule} date={new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} /> : <p className="text-sm text-muted-foreground">{scheduleError ? 'Не вдалося завантажити графік.' : 'Графік ще не імпортовано.'}</p>}
      </CardContent></Card>}

      {/* Upcoming Outages Preview */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Найближчі планові відключення</h2>
          <Link
            to="/outages"
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
          >
            <span>Всі відключення</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {outagesLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : outages.length === 0 ? (
          <div className="p-6 rounded-xl border border-border bg-card text-center text-sm text-muted-foreground">
            {t('outages.noOutages', 'Відключень не заплановано')}
          </div>
        ) : (
          <div className="space-y-2.5">
            {outages.map((outage) => (
              <OutageCard key={outage.id} outage={outage} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};