import { Text, View } from 'react-native';

export default function SearchScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-surface-dim px-6">
      <Text className="text-lg font-semibold text-foreground">Пошук</Text>
      <Text className="mt-2 text-center text-sm text-muted-foreground">
        Екран у переносі з веб-версії.
      </Text>
    </View>
  );
}
