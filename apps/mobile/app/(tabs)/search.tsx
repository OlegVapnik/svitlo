import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddressLookup } from '@/components/address/AddressLookup';
import { RegionPicker } from '@/components/home/RegionPicker';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';

/**
 * Пошук адреси: область → населений пункт → вулиця → будинок.
 *
 * Область вибирається тим самим RegionPicker, що й на Головній, тому активна область одна на
 * весь застосунок. Карта не потрібна: людина знає свою адресу, їй потрібен код групи й графік.
 */
export default function SearchScreen() {
  return (
    <SwipeableScreen>
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ gap: 16, paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1 gap-1 pr-3">
            <Text className="text-2xl font-bold tracking-tight text-foreground">Пошук</Text>
            <Text className="text-xs text-muted-foreground">Знайдіть свою групу за адресою.</Text>
          </View>
          <RegionPicker />
        </View>

        <AddressLookup />
      </ScrollView>
    </SafeAreaView>
    </SwipeableScreen>
  );
}
