import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

import { generateTimelineSlots } from '@svitlo/core/lib/timeline';
import { formatMinutesUk, minutesOfDay, minutesToHm, OFF_STATE_CODE } from '@svitlo/core/lib/scheduleWindow';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

import { useTheme, type PowerState } from '@/theme/ThemeProvider';

const STATE_LABEL: Record<PowerState, string> = {
  on: 'Світло є',
  warning: 'Скоро вимкнуть',
  off: 'Світла немає',
  allClear: 'Відключень немає',
  unknown: 'Немає даних',
};

const HOUR_TICKS = ['00:00', '06:00', '12:00', '18:00', '24:00'];

interface ShareInput {
  state: PowerState;
  queue: string | null;
  regionName: string;
  date: string;
  intervals: ScheduleIntervalUtc[];
  offMinutes: number;
  backInMinutes: number | null;
  nextInMinutes: number | null;
  offEndsAt: string | null;
}

/**
 * Премиальная карточка шеринга графика (1080x1440 PNG) в стиле Material Design 3.
 *
 * Карточка верстается обычными RN-компонентами (без Canvas/WebView) и снята в высоком
 * разрешении через captureRef для отправки в Telegram, Viber и Сторис.
 */
export function useShareSchedule(input: ShareInput) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [sharing, setSharing] = useState(false);

  const share = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(ref, {
        format: 'png',
        quality: 1,
        width: 1080,
        height: 1440,
        result: 'tmpfile',
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Поділитися графіком',
          UTI: 'public.png',
        });
      }
    } catch {
      // Пользователь отменил шеринг
    } finally {
      setSharing(false);
    }
  }, [sharing]);

  const hiddenCard = (
    <View
      ref={ref}
      collapsable={false}
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 360,
        height: 480,
        zIndex: -1,
      }}
    >
      <ShareCard {...input} />
    </View>
  );

  return { share, sharing, hiddenCard };
}

function ShareCard({
  state,
  queue,
  regionName,
  date,
  intervals,
  offMinutes,
  backInMinutes,
  nextInMinutes,
  offEndsAt,
}: ShareInput) {
  const { palette } = useTheme();
  const tone = palette.status[state];
  const slots = generateTimelineSlots(intervals, date, new Date());

  const detail =
    state === 'off' && offEndsAt
      ? `Вимкнено до ${minutesToHm(minutesOfDay(offEndsAt, date))}`
      : state === 'off' && backInMinutes != null
        ? `Очікується увімкнення через ${formatMinutesUk(backInMinutes)}`
        : state === 'warning' && nextInMinutes != null
          ? `Наступне відключення через ${formatMinutesUk(nextInMinutes)}`
          : state === 'on' && nextInMinutes != null
            ? `Наступне відключення через ${formatMinutesUk(nextInMinutes)}`
            : 'Відключень за графіком на сьогодні немає';

  const formattedDate = (() => {
    try {
      const [year, month, day] = date.split('-').map(Number);
      if (!year || !month || !day) return date;
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('uk-UA', {
        day: 'numeric',
        month: 'long',
        weekday: 'short',
      }).toUpperCase();
    } catch {
      return date;
    }
  })();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.card,
        borderColor: tone.border,
        borderWidth: 1.5,
        borderRadius: 32,
        padding: 24,
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      {/* Мягкий нативный верхний градиент статуса */}
      <LinearGradient
        pointerEvents="none"
        colors={[tone.soft, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.5 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 220 }}
      />

      {/* 1) Шапка с брендингом Svitlo и регионом */}
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {/* Брендовый лого-значок Svitlo */}
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                backgroundColor: tone.color,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="flash" size={18} color="#000000" />
            </View>
            <View>
              <Text style={{ color: palette.foreground, fontSize: 15, fontWeight: '800', letterSpacing: 0.5 }}>
                SVITLO
              </Text>
              <Text style={{ color: palette.mutedForeground, fontSize: 11, fontWeight: '600' }}>
                {regionName.toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Плашка даты */}
          <View
            style={{
              backgroundColor: palette.surfaceContainerHigh,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: palette.hairline,
            }}
          >
            <Text style={{ color: palette.foreground, fontSize: 11, fontWeight: '700' }}>
              {formattedDate}
            </Text>
          </View>
        </View>

        {/* 2) Главный доминирующий заголовок состояния */}
        <View style={{ gap: 6, marginTop: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: tone.color,
              }}
            />
            <Text style={{ color: tone.color, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }}>
              {state === 'off' ? 'Відключення за графіком' : state === 'on' ? 'Електропостачання є' : 'Увага'}
            </Text>
          </View>

          <Text
            style={{
              color: palette.foreground,
              fontSize: 34,
              fontWeight: '900',
              letterSpacing: -0.8,
              lineHeight: 38,
            }}
          >
            {STATE_LABEL[state]}
          </Text>

          <Text style={{ color: palette.mutedForeground, fontSize: 14, fontWeight: '500' }}>
            {detail}
          </Text>
        </View>

        {/* Информационные чипы: Черга и Загальный час без света */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
          {queue ? (
            <View
              style={{
                backgroundColor: tone.soft,
                borderColor: tone.border,
                borderWidth: 1,
                borderRadius: 14,
                paddingHorizontal: 12,
                paddingVertical: 6,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Ionicons name="grid-outline" size={13} color={tone.text} />
              <Text style={{ color: tone.text, fontSize: 13, fontWeight: '800' }}>
                ЧЕРГА {queue}
              </Text>
            </View>
          ) : null}

          <View
            style={{
              backgroundColor: palette.surfaceContainerHigh,
              borderColor: palette.hairline,
              borderWidth: 1,
              borderRadius: 14,
              paddingHorizontal: 12,
              paddingVertical: 6,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Ionicons name="time-outline" size={13} color={palette.mutedForeground} />
            <Text style={{ color: palette.foreground, fontSize: 13, fontWeight: '700' }}>
              Без світла: {formatMinutesUk(offMinutes)}
            </Text>
          </View>
        </View>
      </View>

      {/* 3) Выразительная 24-часовая полоса графика (Главный визуальный якорь) */}
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: palette.foreground, fontSize: 12, fontWeight: '700' }}>
            24-годинний графік доби
          </Text>
          <Text style={{ color: palette.mutedForeground, fontSize: 11, fontWeight: '600' }}>
            48 получасовых слотов
          </Text>
        </View>

        {/* Укрупненный стильный трек Timeline */}
        <View
          style={{
            flexDirection: 'row',
            height: 52,
            gap: 2,
            padding: 4,
            borderRadius: 16,
            backgroundColor: palette.surfaceDim,
            borderWidth: 1,
            borderColor: palette.hairline,
          }}
        >
          {slots.map((slot) => {
            const isOff = slot.stateCode === OFF_STATE_CODE;
            const isWarning = slot.stateCode === WARNING_STATE_CODE;
            const isOn = slot.stateCode === ON_STATE_CODE;

            const bg = isOff
              ? palette.status.off.color
              : isWarning
                ? palette.status.warning.color
                : isOn
                  ? palette.status.on.color
                  : palette.surfaceContainerHigh;

            return (
              <View
                key={slot.index}
                style={{
                  flex: 1,
                  borderRadius: 3,
                  backgroundColor: bg,
                  opacity: isOff || isWarning || isOn ? 0.85 : 0.25,
                }}
              />
            );
          })}
        </View>

        {/* Временная шкала под полосой */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }}>
          {HOUR_TICKS.map((tick) => (
            <Text key={tick} style={{ color: palette.mutedForeground, fontSize: 11, fontWeight: '700' }}>
              {tick}
            </Text>
          ))}
        </View>
      </View>

      {/* 4) Футер карточки с автоподписью */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTopWidth: 1,
          borderTopColor: palette.hairline,
          paddingTop: 12,
        }}
      >
        <Text style={{ color: palette.mutedForeground, fontSize: 11, fontWeight: '600' }}>
          Графік оновлюється в реальному часі
        </Text>
        <Text style={{ color: palette.foreground, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>
          svitlo.ua
        </Text>
      </View>
    </View>
  );
}
