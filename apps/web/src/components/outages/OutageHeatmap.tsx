import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme.js';

interface HeatmapCell {
  dayOfWeek: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  hour: number;      // 0-23
  count: number;
}

interface OutageHeatmapProps {
  data: HeatmapCell[];
}

export const OutageHeatmap: React.FC<OutageHeatmapProps> = ({ data }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);

  const option = useMemo(() => {
    // Map data to [hour, dayOfWeek (0-6 starting Monday), count]
    const chartData = data.map((d) => {
      // Map 0 (Sun) to 6, 1 (Mon) to 0, etc.
      const dayIndex = d.dayOfWeek === 0 ? 6 : d.dayOfWeek - 1;
      return [d.hour, dayIndex, d.count];
    });

    const maxCount = Math.max(...data.map((d) => d.count), 5);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        formatter: (params: any) => {
          const [hour, dayIndex, count] = params.value;
          return `<b>${days[dayIndex]} ${hour}:00</b><br/>Відключень: <b>${count}</b>`;
        },
      },
      grid: {
        top: '10%',
        bottom: '15%',
        left: '10%',
        right: '5%',
      },
      xAxis: {
        type: 'category',
        data: hours,
        splitArea: { show: true },
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
          interval: 2,
          fontSize: 10,
        },
      },
      yAxis: {
        type: 'category',
        data: days,
        splitArea: { show: true },
        axisLabel: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 11,
        },
      },
      visualMap: {
        min: 0,
        max: maxCount,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: '0%',
        inRange: {
          color: isDark
            ? ['#1e293b', '#0369a1', '#0284c7', '#38bdf8', '#f43f5e']
            : ['#f1f5f9', '#bae6fd', '#38bdf8', '#0284c7', '#e11d48'],
        },
        textStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 10,
        },
      },
      series: [
        {
          name: 'Частота відключень',
          type: 'heatmap',
          data: chartData,
          label: {
            show: false,
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
          },
        },
      ],
    };
  }, [data, isDark, days, hours]);

  return (
    <div className="w-full bg-card p-4 rounded-xl border border-border shadow-sm">
      <h3 className="font-semibold text-sm mb-2 text-foreground">
        {t('charts.heatmap', 'Теплова карта: коли найчастіше вимикають')}
      </h3>
      <ReactECharts option={option} style={{ height: '280px', width: '100%' }} opts={{ renderer: 'svg' }} />
    </div>
  );
};