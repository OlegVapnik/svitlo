import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import Svg, { Circle, Defs, Line, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import { formatMinutesUk } from '@svitlo/core/lib/scheduleWindow';

import { StatusPill } from '@/components/ui/StatusPill';
import { setBannerRenderer, type NotificationBanner } from '@/lib/notification-banner';
import { useTheme, type PowerState } from '@/theme/ThemeProvider';

/** Логический размер карточки: снимок делается в 3× (1080×570), текст не мылится. */
const CARD_WIDTH = 360;
const CARD_HEIGHT = 190;
const CAPTURE_SCALE = 3;

const TIMELINE_WIDTH = CARD_WIDTH - 32;
const TIMELINE_HEIGHT = 22;
const SLOT_GAP = 1;

/**
 * Плашка для шторки: скрытая карточка + снимок по требованию.
 *
 * Компонент монтируется один раз в корневом layout. Он держит карточку в пределах экрана
 * (Android не рисует слои за его границами — `captureRef` вернул бы пустой PNG), принимает
 * данные от `notifications.ts` и отдаёт путь к PNG.
 */
export function NotificationBannerHost() {
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const [banner, setBanner] = useState<NotificationBanner | null>(null);
  const resolveRef = useRef<((uri: string | null) => void) | null>(null);

  useEffect(() => {
    setBannerRenderer(
      (next) =>
        new Promise<string | null>((resolve) => {
          // Новый запрос отменяет предыдущий: одновременно в шторке живёт одна плашка.
          resolveRef.current?.(null);
          resolveRef.current = resolve;
          setBanner(next);
        }),
    );
    return () => {
      setBannerRenderer(null);
      // Не оставляем `showLiveNotification` в ожидании навсегда при размонтировании.
      resolveRef.current?.(null);
      resolveRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!banner) return;
    let cancelled = false;

    const shoot = async () => {
      // Два кадра: первый раскладывает карточку, второй дорисовывает SVG-градиент и шкалу.
      // В фоне requestAnimationFrame не тикает, поэтому ждём ещё и таймер: без него промис
      // завис бы и уведомление вообще не обновилось.
      await Promise.race([
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 120)),
      ]);
      if (cancelled) return;
      let uri: string | null = null;
      try {
        uri = await captureRef(cardRef, {
          format: 'png',
          quality: 1,
          width: CARD_WIDTH * CAPTURE_SCALE,
          height: CARD_HEIGHT * CAPTURE_SCALE,
          result: 'tmpfile',
        });
      } catch {
        uri = null;
      }
      const resolve = resolveRef.current;
      resolveRef.current = null;
      resolve?.(uri);
    };

    void shoot();
    return () => {
      cancelled = true;
    };
  }, [banner]);

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, zIndex: -1 }}
      collapsable={false}
    >
      <View ref={cardRef} collapsable={false} style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}>
        {banner ? <BannerCard banner={banner} /> : null}
      </View>
    </View>
  );
}


/** Карточка 1:1 с Hero-секцией главного экрана, но без интерактива. */
function BannerCard({ banner }: { banner: NotificationBanner }) {
  const { palette } = useTheme();
  const tone = palette.status[banner.state];

  return (
    <View
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        backgroundColor: palette.card,
        borderColor: palette.hairline,
        borderWidth: 1,
        borderRadius: 20,
        padding: 16,
        overflow: 'hidden',
      }}
    >
      {/* Свечение тона состояния в правом верхнем углу — как у Hero-карточки. */}
      <View pointerEvents="none" style={{ position: 'absolute', right: -50, top: -70 }}>
        <Svg width={260} height={260}>
          <Defs>
            <RadialGradient id="banner-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={tone.color} stopOpacity={0.22} />
              <Stop offset="1" stopColor={tone.color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={130} cy={130} r={130} fill="url(#banner-glow)" />
        </Svg>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <StatusPill state={banner.state} label={banner.pill} pulse={banner.state === 'on'} />
        <Text
          style={{
            color: palette.mutedForeground,
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 1.4,
          }}
        >
          {banner.queue ? `ЧЕРГА ${banner.queue}` : 'ЧЕРГА НЕ ВИБРАНА'}
        </Text>
      </View>

      <Text
        numberOfLines={1}
        style={{
          marginTop: 8,
          color: tone.text,
          fontSize: 22,
          fontWeight: '800',
          letterSpacing: -0.4,
        }}
      >
        {banner.headline}
      </Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Text numberOfLines={1} style={{ flex: 1, color: palette.mutedForeground, fontSize: 11 }}>
          {banner.detail}
        </Text>
        {banner.timer ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text
              style={{
                color: palette.mutedForeground,
                fontSize: 9,
                fontWeight: '700',
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              {banner.timer.prefix}
            </Text>
            <Text style={{ color: tone.text, fontSize: 16, fontWeight: '800' }}>
              {banner.timer.value}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1 }} />

      <BannerTimeline slots={banner.slots} marker={banner.nowFraction} state={banner.state} />

      <View
        style={{
          marginTop: 7,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ color: '#71717a', fontSize: 9, fontWeight: '600' }}>
          {banner.offMinutes > 0
            ? `Без світла за добу: ${formatMinutesUk(banner.offMinutes)}`
            : `Графік на ${banner.date}`}
        </Text>
        <Text style={{ color: '#71717a', fontSize: 9, fontWeight: '700' }}>
          00:00 · 12:00 · 24:00
        </Text>
      </View>
    </View>
  );
}

/**
 * 24-часовая шкала плашки: 48 получасовых сегментов, красные — со штриховкой, белая засечка —
 * текущая минута. Та же грамматика, что у `Timeline24h` главного экрана.
 */
function BannerTimeline({
  slots,
  marker,
  state,
}: {
  slots: (number | null)[];
  marker: number | null;
  state: PowerState;
}) {
  const innerWidth = TIMELINE_WIDTH - 8;
  const innerHeight = TIMELINE_HEIGHT - 8;
  const slotWidth = (innerWidth - SLOT_GAP * (slots.length - 1)) / Math.max(1, slots.length);
  const markerX = marker == null ? null : Math.max(0, Math.min(1, marker)) * innerWidth;

  return (
    <View
      style={{
        width: TIMELINE_WIDTH,
        height: TIMELINE_HEIGHT,
        backgroundColor: '#0e0e12',
        borderColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <Svg
        width={innerWidth}
        height={innerHeight}
        viewBox={`0 0 ${innerWidth} ${innerHeight}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', left: 4, top: 4 }}
      >
        <Defs>
          <Pattern
            id="banner-hatch"
            width={5}
            height={5}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <Line
              x1={0}
              y1={0}
              x2={0}
              y2={5}
              stroke="rgba(255,228,230,0.34)"
              strokeWidth={1.6}
              strokeLinecap="round"
            />
          </Pattern>
        </Defs>

        {slots.map((code, index) => (
          <Rect
            key={`slot-${index}`}
            x={index * (slotWidth + SLOT_GAP)}
            y={0}
            width={slotWidth}
            height={innerHeight}
            rx={1.5}
            fill={
              code === 3
                ? 'rgba(244,63,94,0.34)'
                : code === 2
                  ? 'rgba(245,158,11,0.26)'
                  : code === 1
                    ? 'rgba(16,185,129,0.24)'
                    : '#1b1b22'
            }
          />
        ))}

        {slots.map((code, index) =>
          code === 3 ? (
            <Rect
              key={`hatch-${index}`}
              x={index * (slotWidth + SLOT_GAP)}
              y={0}
              width={slotWidth}
              height={innerHeight}
              rx={1.5}
              fill="url(#banner-hatch)"
            />
          ) : null,
        )}

        {markerX != null ? (
          <>
            <Rect x={markerX - 4} y={0} width={8} height={innerHeight} fill="#ffffff" opacity={0.16} />
            <Rect x={markerX - 1} y={0} width={2} height={innerHeight} fill="#ffffff" />
          </>
        ) : null}

        {/* Тон состояния — тонкая полоса-подпись под шкалой, чтобы цвет читался и без текста. */}
        <Rect x={0} y={innerHeight - 1.5} width={innerWidth} height={1.5} fill={accentFor(state)} opacity={0.5} />
      </Svg>
    </View>
  );
}

/** Тот же цвет, что у уведомления: шкала не спорит с акцентом шторки. */
function accentFor(state: PowerState): string {
  switch (state) {
    case 'on':
    case 'allClear':
      return '#10B981';
    case 'warning':
      return '#F59E0B';
    case 'off':
      return '#F43F5E';
    default:
      return '#71717A';
  }
}

