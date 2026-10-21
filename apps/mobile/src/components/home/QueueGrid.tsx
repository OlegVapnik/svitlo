import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { canonicalQueueCode, queueCodeMatches, queueOptionsForGrid } from '@svitlo/core/lib/queue';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Шість клітинок у рядку. Раніше групи йшли «пігулками» з `flex-wrap`, і кожна клітинка несла
 * окремий рядок під точку стану: 12 груп займали три нерівні ряди, а Київ із 60 групами —
 * дванадцять рядків на пів-екрана. Фіксовані шість колонок лягають рівно і для 12, і для 60 груп,
 * а стан показує сама клітинка: без світла — червона підложка, вибрана — рамка кольору primary.
 *
 * Ширина клітинки задана відсотком від контейнера, а не `flex-1`: у останньому рядку `flex-1`
 * розтягнув би дві групи на всю ширину, і сітка перестала б читатися як таблиця.
 */
const COLUMNS = 6;

interface QueueGridProps {
  regionCpu: string;
  queues: string[] | undefined;
  selected: string | null;
  /** Групи, у яких відключення йде ПРЯМО ЗАРАЗ (`isActiveNow`), а не просто є слот на сьогодні. */
  active: Set<string>;
  /** Чи оператор опублікував графік на сьогодні: без цього зелена точка була б вигадкою. */
  covered?: boolean;
  onSelect: (queue: string) => void;
}

const COLLAPSED_QUEUES = 12;

/**
 * Сетка групп 1/1…6/2. Состав берём из каталога области, а если он пуст — стандартные 12 подгрупп
 * (`queueOptionsForGrid` в ядре). Красная клетка — у групп, которые по графику без света сейчас.
 *
 * Сравнение кодов идёт через `queueCodeMatches`: у Києва каталог и график могут прийти в разных
 * кодировках («3» и «3/1»), и строгое равенство оставило бы группу без подсветки.
 */
export function QueueGrid({ regionCpu, queues, selected, active, covered, onSelect }: QueueGridProps) {
  const { palette } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const options = queueOptionsForGrid(queues);
  const activeCanonical = new Set([...active].map((code) => canonicalQueueCode(regionCpu, code)));
  const offTone = palette.status.off;
  const onTone = palette.status.on;
  const unknownTone = palette.status.unknown;

  // Київ — 60 груп: у розгорнутому вигляді це десять рядків, які відсувають графік і
  // «Найближчі відключення» за межі екрана. Показуємо 12, але вибрану групу не ховаємо:
  // інакше після вибору «40» людина не бачила б, яка клітинка активна.
  const selectedIndex = selected
    ? options.findIndex((queue) => queueCodeMatches(regionCpu, queue, selected))
    : -1;
  let visible = options;
  if (!expanded && options.length > COLLAPSED_QUEUES) {
    visible = options.slice(0, COLLAPSED_QUEUES);
    if (selectedIndex >= COLLAPSED_QUEUES) {
      visible = [...visible.slice(0, COLLAPSED_QUEUES - 1), options[selectedIndex]!].sort(
        (a, b) => options.indexOf(a) - options.indexOf(b),
      );
    }
  }

  const rows: string[][] = [];
  for (let index = 0; index < visible.length; index += COLUMNS) {
    rows.push(visible.slice(index, index + COLUMNS));
  }
  const cellWidth = `${100 / COLUMNS}%`;
  const offCount = options.filter((queue) => activeCanonical.has(canonicalQueueCode(regionCpu, queue))).length;
  const lightOn = covered === true;

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-foreground">Моя черга</Text>
        <Text className="text-xs font-medium text-muted-foreground">{options.length} груп</Text>
      </View>

      <View className="gap-1">
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} className="flex-row">
            {row.map((queue) => {
              const isSelected = selected != null && queueCodeMatches(regionCpu, queue, selected);
              const isOff = activeCanonical.has(canonicalQueueCode(regionCpu, queue));
              // Точка відповідає на питання «чи є світло зараз», а не «чи є слот на сьогодні»:
              // вдень у більшості груп слоти є, і червона точка на всіх читалася б як блекаут.
              const dotColor = isOff ? offTone.color : lightOn ? onTone.color : unknownTone.color;
              return (
                <View key={queue} style={{ width: cellWidth }} className="px-0.5">
                  <Pressable
                    onPress={() => onSelect(queue)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={
                      isOff
                        ? `Черга ${queue}: відключення зараз`
                        : `Черга ${queue}: ${lightOn ? 'світло за графіком' : 'немає даних'}`
                    }
                    style={{
                      borderColor: isSelected ? palette.primary : isOff ? offTone.border : palette.border,
                      backgroundColor: isOff ? offTone.soft : undefined,
                    }}
                    className={
                      isSelected
                        ? 'h-10 items-center justify-center gap-0.5 rounded-lg border-2 bg-primary-container active:opacity-80'
                        : 'h-10 items-center justify-center gap-0.5 rounded-lg border bg-surface-container-high active:opacity-70'
                    }
                  >
                    <Text
                      numberOfLines={1}
                      className="text-sm font-semibold leading-none"
                      style={{ color: isSelected ? palette.primary : isOff ? offTone.text : palette.foreground }}
                    >
                      {queue}
                    </Text>
                    <View
                      className="h-1 w-1 rounded-full"
                      style={{ backgroundColor: dotColor }}
                    />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </View>

      {options.length > COLLAPSED_QUEUES ? (
        <Pressable
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          className="min-h-9 flex-row items-center justify-center gap-1 rounded-lg border border-border bg-surface-container-low active:opacity-70"
        >
          <Text className="text-xs font-semibold text-foreground">
            {expanded ? 'Згорнути' : `Показати всі ${options.length} черг`}
          </Text>
        </Pressable>
      ) : null}

      <Text className="text-[11px] text-muted-foreground">
        {lightOn
          ? `Зелена точка — світло зараз, червона — відключення зараз${offCount > 0 ? ` (${offCount})` : ''}.`
          : 'Сіра точка — графік на сьогодні ще не опубліковано.'}
      </Text>
    </View>
  );
}
