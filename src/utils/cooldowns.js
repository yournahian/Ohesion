const messageCooldowns = new Map();
const COOLDOWN_DURATION_MS = 60 * 1000; // 1 minute in milliseconds

/**
 * Checks if a user is currently on cooldown for XP gain.
 * If not on cooldown, registers the timestamp and returns false.
 * @param {string} guildId 
 * @param {string} userId 
 * @returns {boolean} true if user is on cooldown, false if eligible for XP
 */
export function isUserOnMessageCooldown(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const lastTimestamp = messageCooldowns.get(key);

  if (lastTimestamp && now - lastTimestamp < COOLDOWN_DURATION_MS) {
    return true;
  }

  messageCooldowns.set(key, now);
  return false;
}
