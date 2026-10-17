import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Outage } from '@svitlo/shared';
import { isValidIso } from '../../lib/date.js';

interface OutageCalendarProps {
  outages: Outage[];
  selectedDate: Date | null;
  onSelectDate: (date: Date | null) => void;
}

export const OutageCalendar: React.FC<OutageCalendarProps> = ({
  outages,
  selectedDate,
  onSelectDate,
}) => {
  const { t } = useTranslation();
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // First day of current month
  const firstDay = new Date(year, month, 1);
  // Total days in month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Day of week for first day (0 = Sunday, map to Monday = 0)
  const startDayOfWeek = (firstDay.getDay() + 6) % 7;

  const monthNames = [
    'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
    'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
  ];
  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  // Map outage counts to dates (YYYY-MM-DD)
  const outageCountByDate = React.useMemo(() => {
    const map = new Map<string, number>();
    outages.forEach((o) => {
      // Отключение с нечитаемой датой нельзя разместить на календаре: getTime() вернёт NaN,
      // курсор перестанет двигаться, и цикл по суткам развалится. Пропускаем такую запись —
      // это случится, если в ответе API хоть одно поле даты придёт мусорным.
      if (!isValidIso(o.startsAt) || !isValidIso(o.endsAt)) return;
      const start = new Date(o.startsAt);
      const end = new Date(o.endsAt);
      const cursor = new Date(start);
      while (cursor <= end) {
        const dateKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        map.set(dateKey, (map.get(dateKey) || 0) + 1);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [outages]);

  const cells = [];
  // Empty slots for previous month days
  for (let i = 0; i < startDayOfWeek; i++) {
    cells.push(<div key={`empty-${i}`} className="h-10 sm:h-12 border border-border/20 bg-muted/10 rounded-lg" />);
  }

  // Days of current month
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const count = outageCountByDate.get(dateStr) || 0;
    const isSelected = selectedDate && `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}` === dateStr;
    const today = new Date();
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

    cells.push(
      <button
        key={`day-${day}`}
        onClick={() => {
          if (isSelected) {
            onSelectDate(null); // Deselect
          } else {
            onSelectDate(new Date(year, month, day));
          }
        }}
        className={`h-10 sm:h-12 border rounded-lg p-1 text-left flex flex-col justify-between transition-all cursor-pointer relative ${
          isSelected
            ? 'border-primary bg-primary/10 shadow-xs'
            : isToday
            ? 'border-primary/50 bg-card'
            : 'border-border/40 bg-card hover:border-border'
        }`}
      >
        <span className={`text-xs font-semibold ${isToday ? 'text-primary' : 'text-foreground'}`}>
          {day}
        </span>
        {count > 0 && (
          <span className="self-end px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
            {count}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="w-full bg-card p-4 rounded-xl border border-border shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm text-foreground">
          {monthNames[month]} {year}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={nextMonth}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 mb-2 text-center">
        {dayNames.map((d) => (
          <span key={d} className="text-xs font-medium text-muted-foreground">
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">{cells}</div>

      {selectedDate && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Обрано: {selectedDate.toLocaleDateString()}</span>
          <button onClick={() => onSelectDate(null)} className="text-primary hover:underline">
            Скинути вибір
          </button>
        </div>
      )}
    </div>
  );
};