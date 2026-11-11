export type BadgeInfo = {
  key: string;
  label: string;
  description: string;
  emoji: string;
};

export const BADGES: Record<string, BadgeInfo> = {
  first_exam: {
    key: "first_exam",
    label: "Premier examen",
    description: "Tu as passé ton tout premier examen.",
    emoji: "📝",
  },
  perfect_score: {
    key: "perfect_score",
    label: "Sans faute",
    description: "100% de bonnes réponses à un examen.",
    emoji: "💯",
  },
  high_achiever: {
    key: "high_achiever",
    label: "Sur la lancée",
    description: "5 examens réussis à 80% ou plus.",
    emoji: "🔥",
  },
  first_course: {
    key: "first_course",
    label: "Premier cours",
    description: "Tu as importé ton premier document.",
    emoji: "📚",
  },
  group_joiner: {
    key: "group_joiner",
    label: "Esprit d'équipe",
    description: "Tu as rejoint ton premier groupe d'étude.",
    emoji: "🤝",
  },
};

export function levelFromXp(xp: number) {
  return Math.floor(xp / 100) + 1;
}

export function xpForNextLevel(xp: number) {
  const level = levelFromXp(xp);
  const currentLevelFloor = (level - 1) * 100;
  const progress = xp - currentLevelFloor;
  return { level, progress, needed: 100 };
}
