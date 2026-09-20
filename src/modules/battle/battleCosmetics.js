import { supabase } from '../../lib/supabase.js';

// In-memory cache for user cosmetics to guarantee fast retrieval and zero DB latency
const userCosmeticsCache = new Map(); // key: `${guildId}_${discordId}` => { battle_title, battle_emoji, battle_name_color }

/**
 * 4-Tier Cosmetic Store Catalog
 */
export const BATTLE_COSMETICS_CATALOG = {
  tier1: [
    { id: 'cos_emoji_sword', tier: 1, name: 'Duelist Blades', type: 'emoji', value: '⚔️', cost: 150, description: 'Twin crossed swords attached to your fighter name' },
    { id: 'cos_emoji_shield', tier: 1, name: 'Vanguard Aegis', type: 'emoji', value: '🛡️', cost: 150, description: 'Sturdy guardian shield emoji' },
    { id: 'cos_emoji_target', tier: 1, name: 'Sniper Sight', type: 'emoji', value: '🎯', cost: 150, description: 'Precision crosshairs badge' },
    { id: 'cos_emoji_bow', tier: 1, name: 'Ranger Recurve', type: 'emoji', value: '🏹', cost: 150, description: 'Traditional longbow marker' },
  ],
  tier2: [
    { id: 'cos_color_mint', tier: 2, name: 'Neon Mint Tag', type: 'title', value: '⟦MINT⟧', color: '#00F5D4', cost: 350, description: 'Luminescent mint brackets styling' },
    { id: 'cos_color_pink', tier: 2, name: 'Hot Pink Tag', type: 'title', value: '⟦ROSE⟧', color: '#FF007F', cost: 350, description: 'Vibrant cyberpunk magenta styling' },
    { id: 'cos_color_gold', tier: 2, name: 'Cyber Gold Tag', type: 'title', value: '⟦GOLD⟧', color: '#FFD166', cost: 350, description: 'Opulent gilded gold badge' },
    { id: 'cos_color_cyan', tier: 2, name: 'Azure Frost Tag', type: 'title', value: '⟦FROST⟧', color: '#00BBF9', cost: 350, description: 'Subzero glacial brackets' },
  ],
  tier3: [
    { id: 'cos_emoji_fire', tier: 3, name: 'Inferno Crest', type: 'emoji', value: '🔥', cost: 750, description: 'Blazing flame badge for fiery combatants' },
    { id: 'cos_emoji_crown', tier: 3, name: 'Monarch Crown', type: 'emoji', value: '👑', cost: 750, description: 'Regal golden crown reserved for champions' },
    { id: 'cos_emoji_lightning', tier: 3, name: 'Tempest Bolt', type: 'emoji', value: '⚡', cost: 750, description: 'High-voltage electric spark badge' },
    { id: 'cos_emoji_skull', tier: 3, name: 'Grim Reaper', type: 'emoji', value: '💀', cost: 750, description: 'Menacing skull insignia' },
    { id: 'cos_emoji_diamond', tier: 3, name: 'Diamond Core', type: 'emoji', value: '💎', cost: 750, description: 'Gleaming pristine gem of elite prestige' },
  ],
  tier4: [
    { id: 'cos_title_warlord', tier: 4, name: 'Warlord Title', type: 'title', value: '[Warlord]', cost: 1500, description: 'Overriding Mythic [Warlord] prefix tag' },
    { id: 'cos_title_godtier', tier: 4, name: 'GOD-TIER Title', type: 'title', value: '[GOD-TIER]', cost: 1500, description: 'Supreme Mythic [GOD-TIER] combatant prefix' },
    { id: 'cos_title_immortal', tier: 4, name: 'Immortal Title', type: 'title', value: '[Immortal]', cost: 1500, description: 'Mythic [Immortal] status marker' },
    { id: 'cos_title_apex', tier: 4, name: 'Apex Predator Title', type: 'title', value: '[Apex]', cost: 1500, description: 'Lethal [Apex] hunter identification' },
  ],
};

/**
 * Retrieves cosmetic attributes for a participant.
 */
export async function getUserCosmetics(guildId, discordId) {
  const key = `${guildId}_${discordId}`;
  if (userCosmeticsCache.has(key)) {
    return userCosmeticsCache.get(key);
  }

  try {
    const { data } = await supabase
      .from('users')
      .select('battle_name_color, battle_emoji, battle_title')
      .eq('guild_id', guildId)
      .eq('discord_id', discordId)
      .maybeSingle();

    if (data) {
      const cosmetics = {
        battle_name_color: data.battle_name_color || null,
        battle_emoji: data.battle_emoji || null,
        battle_title: data.battle_title || null,
      };
      userCosmeticsCache.set(key, cosmetics);
      return cosmetics;
    }
  } catch (_) {}

  return { battle_name_color: null, battle_emoji: null, battle_title: null };
}

/**
 * Formats a fighter's name with bolding, distinct brackets, titles, and emojis
 * so premium text visibly pops out inside live text event logs.
 */
export function formatParticipantName(displayName, cosmetics = {}) {
  const title = cosmetics?.battle_title ? `${cosmetics.battle_title} ` : '';
  const emoji = cosmetics?.battle_emoji ? `${cosmetics.battle_emoji} ` : '';

  if (title || emoji) {
    return `**${title}${emoji}${displayName}**`;
  }
  return `**${displayName}**`;
}

/**
 * Purchases a cosmetic item from the 4-tier catalog, deducting QP from the user profile.
 */
export async function purchaseCosmeticItem({ guildId, discordId, itemId }) {
  // Find item across all tiers
  let item = null;
  for (const tierList of Object.values(BATTLE_COSMETICS_CATALOG)) {
    const found = tierList.find((it) => it.id === itemId);
    if (found) {
      item = found;
      break;
    }
  }

  if (!item) {
    return { success: false, message: '❌ Invalid cosmetic item selected.' };
  }

  // Check user balance
  const { data: userRecord } = await supabase
    .from('users')
    .select('total_points')
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .maybeSingle();

  const currentPoints = Number(userRecord?.total_points || 0);
  if (currentPoints < item.cost) {
    return {
      success: false,
      message: `🪙 **Insufficient Cohesion Points:** You need **${item.cost} CP**, but only have **${currentPoints} CP**.`,
    };
  }

  const newPoints = currentPoints - item.cost;
  const updates = { total_points: newPoints };
  const currentCosmetics = await getUserCosmetics(guildId, discordId);

  if (item.type === 'emoji') {
    updates.battle_emoji = item.value;
    currentCosmetics.battle_emoji = item.value;
  } else if (item.type === 'title') {
    updates.battle_title = item.value;
    currentCosmetics.battle_title = item.value;
    if (item.color) {
      updates.battle_name_color = item.color;
      currentCosmetics.battle_name_color = item.color;
    }
  }

  // Update in-memory cache
  userCosmeticsCache.set(`${guildId}_${discordId}`, currentCosmetics);

  // Update Supabase
  try {
    await supabase.from('users').update(updates).eq('guild_id', guildId).eq('discord_id', discordId);
  } catch (err) {
    console.warn('[COSMETICS DB] Updated in-memory, DB error:', err.message);
  }

  return {
    success: true,
    item,
    remainingPoints: newPoints,
    cosmetics: currentCosmetics,
  };
}
