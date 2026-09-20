import { supabase } from '../lib/supabase.js';
import { logActivity } from '../utils/activityLogger.js';

// Cache to store guild inflation configuration: guildId -> { enabled: boolean, rate: number }
const guildInflationSettings = new Map();

/**
 * Configure inflation settings for a guild.
 * @param {string} guildId 
 * @param {boolean} enabled 
 * @param {number} rate - e.g. 0.05 for 5%
 */
export function setGuildInflation(guildId, enabled, rate = 0.05) {
  const finalRate = enabled ? Math.max(0.01, Math.min(0.5, rate)) : 0;
  guildInflationSettings.set(guildId, { enabled, rate: finalRate });
}

/**
 * Gets guild inflation setting.
 * @param {string} guildId 
 */
export function getGuildInflation(guildId) {
  return guildInflationSettings.get(guildId) || { enabled: false, rate: 0.05 };
}

/**
 * Executes the weekly point decay for all enabled guilds.
 * @param {import('discord.js').Client} client 
 */
export async function runWeeklyInflationDecay(client) {
  for (const [guildId, config] of guildInflationSettings.entries()) {
    if (!config.enabled || config.rate <= 0) continue;

    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;

      const { data: users, error } = await supabase
        .from('users')
        .select('discord_id, total_points')
        .eq('guild_id', guildId)
        .gt('total_points', 0);

      if (error || !users || users.length === 0) continue;

      let totalBurned = 0;
      for (const u of users) {
        const burnAmount = Math.ceil(u.total_points * config.rate);
        const newBalance = Math.max(0, u.total_points - burnAmount);
        totalBurned += burnAmount;

        await supabase
          .from('users')
          .update({ total_points: newBalance })
          .eq('guild_id', guildId)
          .eq('discord_id', u.discord_id);
      }

      await logActivity(guild, {
        title: '🔥 Weekly Point Inflation Decay Executed',
        description: `Cohesion's deflationary engine has executed this week's scheduled point burn to maintain economic stability.\n\n` +
          `• **Burn Rate:** \`${Math.round(config.rate * 100)}%\`\n` +
          `• **Total CP Burned:** \`${totalBurned.toLocaleString()} CP\`\n` +
          `• **Affected Members:** \`${users.length}\`\n\n` +
          `*Spend your Cohesion Points in active Raffles and Community Marketplace before the next burn!*`,
        color: 0xef476f,
      });
    } catch (err) {
      console.warn(`[INFLATION ERROR Guild ${guildId}]:`, err.message);
    }
  }
}

/**
 * Starts the weekly background scheduler.
 * @param {import('discord.js').Client} client 
 */
export function initInflationScheduler(client) {
  // Check every 24 hours if weekly burn is due
  setInterval(() => {
    const now = new Date();
    // Run on Sunday midnight
    if (now.getDay() === 0 && now.getHours() === 0) {
      runWeeklyInflationDecay(client);
    }
  }, 1000 * 60 * 60); // Check hourly
}
