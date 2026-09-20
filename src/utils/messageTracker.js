import { supabase } from '../lib/supabase.js';

// In-memory real-time cache for high performance
// guild_channel_user: `${guildId}:${channelId}:${userId}` => count
const channelUserStats = new Map();
// guild_user: `${guildId}:${userId}` => count
const userTotalStats = new Map();
// Rolling message logs with timestamps for date filtering: [{ guildId, channelId, userId, timestamp }]
const rollingLogs = [];
const MAX_ROLLING_LOGS = 50000;

/**
 * Records a message event for a user in a specific channel.
 */
export async function trackMessage(guildId, channelId, userId) {
  if (!guildId || !channelId || !userId) return;

  const now = Date.now();

  // Update in-memory counts
  const chKey = `${guildId}:${channelId}:${userId}`;
  channelUserStats.set(chKey, (channelUserStats.get(chKey) || 0) + 1);

  const userKey = `${guildId}:${userId}`;
  userTotalStats.set(userKey, (userTotalStats.get(userKey) || 0) + 1);

  rollingLogs.push({ guildId, channelId, userId, timestamp: now });
  if (rollingLogs.length > MAX_ROLLING_LOGS) {
    rollingLogs.shift();
  }

  // Gracefully attempt to record to Supabase if table exists
  try {
    await supabase.rpc('increment_message_count', {
      p_guild_id: guildId,
      p_channel_id: channelId,
      p_discord_id: userId,
    }).catch(() => null);
  } catch (err) {
    // Ignore RPC error if not configured in postgres
  }
}

/**
 * Gets total message count for a user in a guild.
 */
export function getUserMessageCount(guildId, userId) {
  return userTotalStats.get(`${guildId}:${userId}`) || 0;
}

/**
 * Gets user's channel-by-channel breakdown in a guild.
 */
export function getUserChannelBreakdown(guildId, userId) {
  const breakdown = [];
  for (const [key, count] of channelUserStats.entries()) {
    const [gId, cId, uId] = key.split(':');
    if (gId === guildId && uId === userId) {
      breakdown.push({ channelId: cId, count });
    }
  }
  return breakdown.sort((a, b) => b.count - a.count);
}

/**
 * Gets message counts for all users in a specific channel.
 */
export function getChannelUserStats(guildId, channelId) {
  const stats = new Map();
  for (const [key, count] of channelUserStats.entries()) {
    const [gId, cId, uId] = key.split(':');
    if (gId === guildId && cId === channelId) {
      stats.set(uId, (stats.get(uId) || 0) + count);
    }
  }
  return stats;
}

/**
 * Fetches recent message history from a Discord channel directly,
 * aggregating counts per user with pagination and date range support.
 */
export async function auditChannelMessages(channel, options = 100) {
  const userCounts = new Map();
  if (!channel || !channel.isTextBased()) return userCounts;

  const maxMessages = typeof options === 'number' ? options : (options.maxMessages || 500);
  const startMs = typeof options === 'object' ? options.startMs : null;
  const endMs = typeof options === 'object' ? options.endMs : null;

  try {
    let lastId = null;
    let fetchedTotal = 0;
    const batchSize = 100;

    while (fetchedTotal < maxMessages) {
      const fetchOpts = { limit: Math.min(batchSize, maxMessages - fetchedTotal) };
      if (lastId) fetchOpts.before = lastId;

      const messages = await channel.messages.fetch(fetchOpts).catch(() => null);
      if (!messages || messages.size === 0) break;

      let reachedBeforeStart = false;

      for (const msg of messages.values()) {
        fetchedTotal++;
        lastId = msg.id;
        const msgTime = msg.createdTimestamp;

        if (endMs && msgTime > endMs) {
          continue;
        }

        if (startMs && msgTime < startMs) {
          reachedBeforeStart = true;
          break;
        }

        if (msg.author.bot) continue;
        const uId = msg.author.id;
        userCounts.set(uId, (userCounts.get(uId) || 0) + 1);

        // Sync into memory tracker
        const chKey = `${channel.guildId}:${channel.id}:${uId}`;
        channelUserStats.set(chKey, Math.max(channelUserStats.get(chKey) || 0, userCounts.get(uId)));
      }

      if (reachedBeforeStart || messages.size < fetchOpts.limit) {
        break;
      }
    }
  } catch (err) {
    console.warn('[AUDIT CHANNEL MSG WARN]:', err.message);
  }

  return userCounts;
}

/**
 * Filters message logs by date range.
 */
export function getLogsInDateRange(guildId, startMs, endMs, channelId = null) {
  return rollingLogs.filter(log => {
    if (log.guildId !== guildId) return false;
    if (channelId && log.channelId !== channelId) return false;
    if (startMs && log.timestamp < startMs) return false;
    if (endMs && log.timestamp > endMs) return false;
    return true;
  });
}
