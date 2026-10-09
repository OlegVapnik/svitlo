import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme.js';

interface AreaStat {
  areaName: string;
  count: number;
  totalMinutes: number;
}

interface DayStat {
  date: string;
  count: number;
  totalMinutes: number;
}

interface OutageBarChartProps {
  byArea: AreaStat[];
  byDay: DayStat[];
}

export const OutageBarChart: React.FC<OutageBarChartProps> = ({ byArea, byDay }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [viewMode, setViewMode] = useState<'area' | 'day'>('area');
  const [metric, setMetric] = useState<'count' | 'duration'>('count');

  const option = useMemo(() => {
    const isArea = viewMode === 'area';
    const items = isArea ? byArea.slice(0, 10) : byDay.slice(-7);

    const categories = items.map((i) => (isArea ? (i as AreaStat).areaName : (i as DayStat).date));
    const data = items.map((i) => (metric === 'count' ? i.count : Math.round(i.totalMinutes / 60)));

    const yAxisName = metric === 'count' ? 'Кількість' : 'Годин';

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const item = params[0];
          return `<b>${item.name}</b><br/>${yAxisName}: <b>${item.value}</b>`;
        },
      },
      grid: {
        top: '15%',
        bottom: '20%',
        left: '12%',
        right: '5%',
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
          rotate: isArea ? 35 : 0,
          fontSize: 10,
        },
      },
      yAxis: {
        type: 'value',
        name: yAxisName,
        nameTextStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 11,
        },
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
        },
        splitLine: {
          lineStyle: {
            color: isDark ? '#334155' : '#e2e8f0',
            type: 'dashed',
          },
        },
      },
      series: [
        {
          name: yAxisName,
          type: 'bar',
          data,
          itemStyle: {
            color: metric === 'count' ? '#0ea5e9' : '#f59e0b',
            borderRadius: [4, 4, 0, 0],
          },
        },
      ],
    };
  }, [viewMode, metric, byArea, byDay, isDark]);

  return (
    <div className="w-full bg-card p-4 rounded-xl border border-border shadow-sm">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
        <h3 className="font-semibold text-sm text-foreground">
          {t('charts.byArea', 'Статистика відключень')}
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/50">
            <button
              onClick={() => setViewMode('area')}
              className={`px-2 py-1 rounded-md transition-colors ${
                viewMode === 'area' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground'
              }`}
            >
              За районами
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={`px-2 py-1 rounded-md transition-colors ${
                viewMode === 'day' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground'
              }`}
            >
              За днями
            </button>
          </div>

          <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/50">
            <button
              onClick={() => setMetric('count')}
              className={`px-2 py-1 rounded-md transition-colors ${
                metric === 'count' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground'
              }`}
            >
              Кількість
            </button>
            <button
              onClick={() => setMetric('duration')}
              className={`px-2 py-1 rounded-md transition-colors ${
                metric === 'duration' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground'
              }`}
            >
              Години
            </button>
          </div>
        </div>
      </div>

      <ReactECharts option={option} style={{ height: '260px', width: '100%' }} opts={{ renderer: 'svg' }} />
    </div>
  );
};