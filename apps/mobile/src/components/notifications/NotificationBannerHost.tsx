import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import Svg, { Rect } from 'react-native-svg';

import { formatMinutesUk } from '@svitlo/core/lib/scheduleWindow';

import { setBannerRenderer, type NotificationBanner } from '@/lib/notification-banner';
import { useTheme, type PowerState } from '@/theme/ThemeProvider';

/** Логический размер карточки: снимок делается в 3× (1080×780), текст не мылится. */
const CARD_WIDTH = 360;
const CARD_HEIGHT = 260;
const CAPTURE_SCALE = 3;

const TIMELINE_WIDTH = CARD_WIDTH - 32;
const TIMELINE_HEIGHT = 16;

/** Минимальная палитра плашки: зелёный / красный / серый — как в макете. */
const ACCENT: Record<PowerState, { color: string; soft: string }> = {
  on: { color: '#10B981', soft: 'rgba(16,185,129,0.14)' },
  warning: { color: '#10B981', soft: 'rgba(16,185,129,0.14)' },
  allClear: { color: '#10B981', soft: 'rgba(16,185,129,0.14)' },
  off: { color: '#F43F5E', soft: 'rgba(244,63,94,0.14)' },
  unknown: { color: '#71717A', soft: 'rgba(113,113,122,0.16)' },
};

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
      // Два кадра: первый раскладывает карточку, второй дорисовывает SVG-шкалу.
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

/** Карточка по макету: шапка «Svitlo», крупный таймер, сплошная шкала суток и кнопки. */
function BannerCard({ banner }: { banner: NotificationBanner }) {
  const { palette } = useTheme();
  const accent = ACCENT[banner.state];
  const chipText = banner.queue ? `${banner.pill} · Черга ${banner.queue}` : banner.pill;
  const summaryText =
    banner.offMinutes > 0
      ? `Без світла за добу: ${formatMinutesUk(banner.offMinutes)}${
          banner.offRanges.length > 0 ? ` · ${banner.offRanges.join(', ')}` : ''
        }`
      : 'Без світла за добу: 0 хв';

  return (
    <View
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        backgroundColor: palette.card,
        borderRadius: 20,
        padding: 16,
        overflow: 'hidden',
      }}
    >
      {/* Шапка: зелёный круг с молнией, «Svitlo» и текущее время; справа — чип очереди. */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: '#10B981',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 15 }}>⚡</Text>
        </View>
        <Text
          style={{
            marginLeft: 8,
            color: palette.foreground,
            fontSize: 14,
            fontWeight: '700',
          }}
        >
          Svitlo
        </Text>
        {banner.clockTime ? (
          <Text style={{ color: palette.mutedForeground, fontSize: 14 }}>
            {` · ${banner.clockTime}`}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <View
          style={{
            backgroundColor: accent.soft,
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Text style={{ color: accent.color, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>
            {chipText}
          </Text>
        </View>
      </View>

      {/* Статусная строка: точка состояния + короткий статус цветом акцента. */}
      <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent.color }}
        />
        <Text style={{ color: accent.color, fontSize: 13, fontWeight: '700' }}>
          {banner.headline}
        </Text>
      </View>

      {/* Главное число: крупный таймер либо (без таймера) состояние. */}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.55}
        style={{
          marginTop: 2,
          color: palette.foreground,
          fontSize: 40,
          fontWeight: '900',
          lineHeight: 42,
        }}
      >
        {banner.timer ? banner.timer.value : banner.headline}
      </Text>
      {banner.timer ? (
        <Text style={{ marginTop: 1, color: palette.mutedForeground, fontSize: 12, lineHeight: 15 }}>
          {banner.event
            ? `${banner.timer.prefix} · ${banner.event.verb} `
            : banner.timer.prefix}
          {banner.event ? (
            <Text style={{ color: palette.foreground, fontWeight: '700' }}>
              {banner.event.time}
            </Text>
          ) : null}
        </Text>
      ) : null}

      {/* Шкала суток: сплошная зелёная лента, красные блоки отключений, белый маркер «зараз». */}
      <View style={{ marginTop: 10 }}>
        <BannerTimeline slots={banner.slots} marker={banner.nowFraction} />
        <View
          style={{
            marginTop: 3,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ color: palette.mutedForeground, fontSize: 10, lineHeight: 12 }}>00:00</Text>
          <Text
            style={{
              color: palette.mutedForeground,
              fontSize: 10,
              lineHeight: 12,
              position: 'absolute',
              left: '50%',
              transform: [{ translateX: -50 }],
            }}
          >
            12:00
          </Text>
          <Text style={{ color: palette.mutedForeground, fontSize: 10, lineHeight: 12 }}>24:00</Text>
        </View>
      </View>

      {/* Сводка за добу: красный маркер + минуты и диапазоны отключений. */}
      <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: '#F43F5E' }} />
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: palette.mutedForeground, fontSize: 11, lineHeight: 14 }}
        >
          {summaryText}
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      {/* Кнопки — часть картинки (декоративные): реальные действия дают системные кнопки. */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View
          style={{
            flex: 1,
            height: 44,
            borderRadius: 999,
            backgroundColor: '#10B981',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#05231a', fontSize: 14, fontWeight: '700' }}>
            Поділитися графіком
          </Text>
        </View>
        <View
          style={{
            flex: 1,
            height: 44,
            borderRadius: 999,
            backgroundColor: '#1f1f27',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: palette.foreground, fontSize: 14, fontWeight: '600' }}>
            Оновити
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * 24-часовая шкала плашки: сплошная лента без зазоров — зелёный «світло є» (можливе отключение
 * тоже зелёный: янтарного в плашке больше нет), отключения — сплошной красный, белый маркер —
 * текущая минута.
 */
function BannerTimeline({
  slots,
  marker,
}: {
  slots: (number | null)[];
  marker: number | null;
}) {
  const slotWidth = TIMELINE_WIDTH / Math.max(1, slots.length);
  const markerX = marker == null ? null : Math.max(0, Math.min(1, marker)) * TIMELINE_WIDTH;

  return (
    <View
      style={{
        width: TIMELINE_WIDTH,
        height: TIMELINE_HEIGHT,
        backgroundColor: '#0e0e12',
        borderRadius: 999,
        overflow: 'hidden',
      }}
    >
      <Svg
        width={TIMELINE_WIDTH}
        height={TIMELINE_HEIGHT}
        viewBox={`0 0 ${TIMELINE_WIDTH} ${TIMELINE_HEIGHT}`}
        preserveAspectRatio="none"
      >
        {slots.map((code, index) => (
          <Rect
            key={`slot-${index}`}
            x={index * slotWidth}
            y={0}
            width={slotWidth + 0.5}
            height={TIMELINE_HEIGHT}
            rx={0}
            fill={code === 3 ? '#F43F5E' : code === 1 || code === 2 ? '#10B981' : '#1b1b22'}
          />
        ))}

        {markerX != null ? (
          <>
            <Rect
              x={markerX - 3.5}
              y={0}
              width={7}
              height={TIMELINE_HEIGHT}
              fill="#ffffff"
              opacity={0.25}
            />
            <Rect
              x={markerX - 1.5}
              y={0}
              width={3}
              height={TIMELINE_HEIGHT}
              rx={1.5}
              fill="#ffffff"
            />
          </>
        ) : null}
      </Svg>
    </View>
  );
}
