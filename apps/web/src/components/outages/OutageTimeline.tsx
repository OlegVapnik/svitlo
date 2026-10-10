import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme.js';
import type { Outage } from '@svitlo/shared';

interface OutageTimelineProps {
  outages: Outage[];
}

export const OutageTimeline: React.FC<OutageTimelineProps> = ({ outages }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const option = useMemo(() => {
    if (!outages || outages.length === 0) return {};

    // Keep nearest events across the full visible range, including multi-day maintenance.
    const displayOutages = [...outages].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, 40);
    // Підпис рядка має бути унікальним, інакше кілька подій одного району з однією
    // причиною зливаються в однакові «ДЕСНЯНСЬКЕ · …» і графік неможливо прочитати.
    const categories = displayOutages.map((o) => {
      const when = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' }).format(new Date(o.startsAt));
      return `${when} · ${o.reason ?? 'відключення'}`;
    });

    // Prepare multi-day Gantt data.
    const data = displayOutages.map((o, index) => {
      const start = new Date(o.startsAt).getTime();
      const end = new Date(o.endsAt).getTime();
      const isCurrentlyActive = Date.now() >= start && Date.now() <= end;
      const isMaintenance = /ремонтн|виконання ремонтних робіт/iu.test(o.reason ?? '');

      return {
        name: o.areaName,
        value: [index, start, end, end - start],
        itemStyle: {
          color: isCurrentlyActive || isMaintenance
            ? '#ef4444' // red for active and repair incidents
            : o.status === 'scheduled'
            ? '#f59e0b' // amber for scheduled
            : '#10b981', // green for resolved/normally finished outages.
          borderRadius: 4,
        },
      };
    });

    const now = Date.now();

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const val = params.value;
          const start = new Date(val[1]).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
          const end = new Date(val[2]).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
          const durationHours = ((val[3]) / (1000 * 60 * 60)).toFixed(1);
          return `<div style="font-weight:600;margin-bottom:4px">${params.name}</div><div>${t('outages.from')}: <b>${start}</b></div><div>${t('outages.to')}: <b>${end}</b></div><div>Тривалість: <b>${durationHours} год</b></div>`;
        },
      },
      grid: {
        left: '25%',
        right: '5%',
        top: '10%',
        bottom: '10%',
      },
      xAxis: {
        type: 'time',
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
          formatter: (value: number) => new Date(value).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: isDark ? '#334155' : '#e2e8f0',
            type: 'dashed',
          },
        },
      },
      yAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 11,
          width: 90,
          overflow: 'truncate',
        },
        splitLine: { show: false },
        axisLine: {
          lineStyle: { color: isDark ? '#475569' : '#cbd5e1' },
        },
      },
      series: [
        {
          type: 'custom',
          renderItem: (params: any, api: any) => {
            const categoryIndex = api.value(0);
            const timeStart = api.coord([api.value(1), categoryIndex]);
            const timeEnd = api.coord([api.value(2), categoryIndex]);
            const barHeight = api.size([0, 1])[1] * 0.6;

            const rectWidth = Math.max(timeEnd[0] - timeStart[0], 2);

            return {
              type: 'rect',
              shape: {
                x: timeStart[0],
                y: timeStart[1] - barHeight / 2,
                width: rectWidth,
                height: barHeight,
                r: [4, 4, 4, 4],
              },
              style: api.style(),
            };
          },
          encode: {
            x: [1, 2],
            y: 0,
          },
          data,
          markLine: {
            symbol: 'none',
            label: {
              show: true,
              formatter: 'Зараз',
              position: 'end',
              color: '#ef4444',
            },
            lineStyle: {
              color: '#ef4444',
              type: 'solid',
              width: 2,
            },
            data: [{ xAxis: now }],
          },
        },
      ],
    };
  }, [outages, isDark, t]);

  if (!outages || outages.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        {t('common.noData')}
      </div>
    );
  }

  return (
    <div className="w-full bg-card p-4 rounded-xl border border-border shadow-sm overflow-hidden">
      <h3 className="font-semibold text-sm mb-2 text-foreground flex items-center justify-between">
        <span>Графік відключень та ремонтів · до 40 записів</span>
        <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500"></span> Зараз
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500"></span> Заплановано
        </span>
      </h3>
      <ReactECharts
        option={option}
        style={{ height: `${Math.max(Math.min(outages.length, 40) * 36 + 60, 260)}px`, width: '100%' }}
        opts={{ renderer: 'svg' }}
      />
    </div>
  );
};