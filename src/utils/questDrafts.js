/**
 * In-memory & cached Quest Presets / Drafts storage for Cohesion.
 * Allows admins to quickly apply complex quest filters with 1 click.
 */

const guildDrafts = new Map();

// Built-in default presets
const DEFAULT_PRESETS = [
  {
    name: 'standard_raid',
    description: 'Standard raid: 50 CP, 24h duration, Like + Retweet + Reply.',
    points: 50,
    duration: '24h',
    buttons: 'like, rt, comment',
    leadEngagersBonus: 10,
    verifiedOnly: false,
    requireFollow: false,
    minCharacters: 5,
    keyword: '',
  },
  {
    name: 'high_priority',
    description: 'High priority raid: 100 CP, 6h duration, 2x Lead Engagers bonus.',
    points: 100,
    duration: '6h',
    buttons: 'like, rt, comment',
    leadEngagersBonus: 25,
    verifiedOnly: false,
    requireFollow: true,
    minCharacters: 15,
    keyword: '#Cohesion',
  },
  {
    name: 'verified_only',
    description: 'Exclusive raid: 150 CP, 12h, Twitter Blue / X Premium verified only.',
    points: 150,
    duration: '12h',
    buttons: 'like, rt',
    leadEngagersBonus: 30,
    verifiedOnly: true,
    requireFollow: true,
    minCharacters: 0,
    keyword: '',
  },
];

/**
 * Gets all available drafts for a guild.
 * @param {string} guildId 
 * @returns {Array<Object>}
 */
export function getGuildDrafts(guildId) {
  const custom = guildDrafts.get(guildId) || [];
  return [...DEFAULT_PRESETS, ...custom];
}

/**
 * Saves a new custom draft for a guild.
 * @param {string} guildId 
 * @param {Object} draft 
 */
export function saveGuildDraft(guildId, draft) {
  if (!guildDrafts.has(guildId)) {
    guildDrafts.set(guildId, []);
  }
  const list = guildDrafts.get(guildId);
  const existingIndex = list.findIndex((d) => d.name.toLowerCase() === draft.name.toLowerCase());
  if (existingIndex >= 0) {
    list[existingIndex] = draft;
  } else {
    list.push(draft);
  }
}

/**
 * Deletes a custom draft from a guild.
 * @param {string} guildId 
 * @param {string} draftName 
 */
export function deleteGuildDraft(guildId, draftName) {
  if (!guildDrafts.has(guildId)) return false;
  const list = guildDrafts.get(guildId);
  const filtered = list.filter((d) => d.name.toLowerCase() !== draftName.toLowerCase());
  guildDrafts.set(guildId, filtered);
  return true;
}
