import { Link } from 'expo-router';
import { View } from 'react-native';
import { Text } from '@/components/ui/AppText';

export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-surface-dim px-6">
      <Text className="text-lg font-semibold text-foreground">Екран не знайдено</Text>
      <Link href="/" className="mt-3 text-sm text-primary">
        На головну
      </Link>
    </View>
  );
}
