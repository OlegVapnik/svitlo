import * as Haptics from 'expo-haptics';

/**
 * Мягкий нативный системный отклик (микро-клик), вместо резкой сильной вибрации.
 */
export function triggerSoftHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/**
 * Тактильный щелчок при выборе (как затвор камеры или фиксатор переключателя).
 */
export function triggerSelectionHaptic(): void {
  void Haptics.selectionAsync();
}

