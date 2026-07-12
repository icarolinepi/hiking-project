/** Стабільна палітра кольорів для порівняння людей на карті. */
export const ATHLETE_COLORS = [
  "#ff3b1f",
  "#4da3ff",
  "#5dff9a",
  "#ffb020",
  "#9b6bff",
  "#2ee6d6",
  "#ff5ec8",
  "#a8ff3d",
  "#00c2ff",
  "#ff4d6d",
  "#ffe566",
  "#ff7a45",
] as const;

/** У режимі порівняння: ти vs обрана людина. */
export const COMPARE_ME_COLOR = "#ff3b1f";
export const COMPARE_OTHER_COLOR = "#4da3ff";

export function colorForAthleteId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return ATHLETE_COLORS[hash % ATHLETE_COLORS.length];
}

export function athleteDisplayName(user: {
  firstname: string | null;
  lastname: string | null;
  username: string | null;
}): string {
  return (
    [user.firstname, user.lastname].filter(Boolean).join(" ") ||
    user.username ||
    "Атлет"
  );
}
