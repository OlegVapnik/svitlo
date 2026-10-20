import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { Text, View } from 'react-native';
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
 * Красивая PNG-карточка через react-native-view-shot + expo-sharing.
 *
 * Карточка верстается обычными RN-компонентами (никакого Canvas/WebView) и живёт за
 * пределами экрана: пользователь её не видит, но captureRef снимает её как отдельный слой.
 * 3x-размер даёт 1080 px по ширине — хватает для Telegram и сторис.
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
      // Пользователь отменил шеринг или слой ещё не отрисован — молча выходим.
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
        // Держим карточку в пределах экрана, но под контентом: Android не рендерит слои,
        // вынесенные за границы (translateX: -2000), и captureRef вернул бы пустой PNG.
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
      ? `До ${minutesToHm(minutesOfDay(offEndsAt, date))}`
      : state === 'off' && backInMinutes != null
        ? `Світло через ${formatMinutesUk(backInMinutes)}`
        : state === 'warning' && nextInMinutes != null
          ? `Вимкнуть через ${formatMinutesUk(nextInMinutes)}`
          : state === 'on' && nextInMinutes != null
            ? `Відключення через ${formatMinutesUk(nextInMinutes)}`
            : 'За графіком на сьогодні';

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#09090b',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        borderRadius: 32,
        padding: 28,
        justifyContent: 'space-between',
      }}
    >
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tone.color }} />
          <Text style={{ color: '#a1a1aa', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>
            SVITLO · {regionName.toLocaleUpperCase('uk-UA')}
          </Text>
        </View>

        <Text style={{ color: tone.text, fontSize: 42, fontWeight: '800', marginTop: 18 }}>
          {STATE_LABEL[state]}
        </Text>
        <Text style={{ color: '#a1a1aa', fontSize: 16 }}>{detail}</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <View
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: tone.border,
              backgroundColor: tone.soft,
              paddingHorizontal: 14,
              paddingVertical: 6,
            }}
          >
            <Text style={{ color: tone.text, fontSize: 14, fontWeight: '700' }}>
              {queue ? `Черга ${queue}` : 'Черга не вибрана'}
            </Text>
          </View>
          <Text style={{ color: '#71717a', fontSize: 13 }}>{date}</Text>
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <Text style={{ color: '#a1a1aa', fontSize: 12, fontWeight: '600' }}>
          Без світла за добу: {formatMinutesUk(offMinutes)}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            height: 38,
            gap: 1,
            padding: 5,
            borderRadius: 12,
            backgroundColor: '#0e0e12',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.06)',
          }}
        >
          {slots.map((slot) => {
            const isOff = slot.stateCode === OFF_STATE_CODE;
            const isOn = slot.stateCode === 1;
            return (
              <View
                key={slot.index}
                style={{
                  flex: 1,
                  borderRadius: 3,
                  backgroundColor: isOff
                    ? 'rgba(244,63,94,0.55)'
                    : isOn
                      ? 'rgba(16,185,129,0.45)'
                      : '#1b1b22',
                }}
              />
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: '#71717a', fontSize: 11, fontWeight: '600' }}>00:00</Text>
          <Text style={{ color: '#71717a', fontSize: 11, fontWeight: '600' }}>12:00</Text>
          <Text style={{ color: '#71717a', fontSize: 11, fontWeight: '600' }}>24:00</Text>
        </View>

        <Text style={{ color: '#52525b', fontSize: 11 }}>Графік оновлюється автоматично · svitlo</Text>
      </View>
    </View>
  );
}
