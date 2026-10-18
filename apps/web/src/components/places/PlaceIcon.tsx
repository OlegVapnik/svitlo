import React from 'react';
import {
  Briefcase,
  Building2,
  GraduationCap,
  Heart,
  Home,
  Star,
  Trees,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { PlaceIcon as PlaceIconName } from '../../lib/saved-places.js';

/**
 * Вісім іконок місць в одному місці: і в чипах на головній, і у формі збереження, і в
 * списку. Раніше значок вгадувався з назви («Дім» → будиночок) — після перейменування на
 * «Офіс» чип продовжував показувати будиночок, бо назва й значок жили окремо.
 */
export const PLACE_ICON_COMPONENTS: Record<PlaceIconName, LucideIcon> = {
  home: Home,
  work: Briefcase,
  family: Heart,
  dacha: Trees,
  garage: Warehouse,
  office: Building2,
  school: GraduationCap,
  star: Star,
};

/** Ключі локалізації для підписів іконок (aria-label, підказка у формі). */
export const PLACE_ICON_LABEL_KEYS: Record<PlaceIconName, string> = {
  home: 'places.iconHome',
  work: 'places.iconWork',
  family: 'places.iconFamily',
  dacha: 'places.iconDacha',
  garage: 'places.iconGarage',
  office: 'places.iconOffice',
  school: 'places.iconSchool',
  star: 'places.iconStar',
};

export const PlaceIconMark: React.FC<{
  icon: PlaceIconName;
  className?: string;
}> = ({ icon, className }) => {
  const Icon = PLACE_ICON_COMPONENTS[icon] ?? Star;
  return <Icon className={className} strokeWidth={2.2} aria-hidden />;
};
