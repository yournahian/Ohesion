/**
 * Calculates the total XP required to reach a specific level.
 * @param {number} level 
 * @returns {number}
 */
export function getRequiredXpForLevel(level) {
  if (level <= 1) return 0;
  // Smooth curve: Level 2 = 100 XP, Level 3 = 348 XP, Level 4 = 722 XP, Level 5 = 1208 XP...
  return Math.floor(100 * Math.pow(level - 1, 1.8));
}

/**
 * Calculates user's level based on their current total XP.
 * @param {number} xp 
 * @returns {number}
 */
export function getLevelFromXp(xp) {
  let level = 1;
  while (xp >= getRequiredXpForLevel(level + 1)) {
    level++;
  }
  return level;
}

/**
 * Bonus points awarded to the user upon reaching a new level.
 */
export const POINTS_PER_LEVEL = 50;
