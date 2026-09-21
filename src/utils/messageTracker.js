import fs from 'fs';
import path from 'path';
import { supabase } from '../lib/supabase.js';

// Persistent file storage path
const STATS_FILE = path.resolve('data/message_stats.json');

// In-memory real-time cache for high performance
// guild_channel_user: `${guildId}:${channelId}:${userId}` => count
const channelUserStats = new Map();
// guild_user: `${guildId}:${userId}` => count
const userTotalStats = new Map();
// Rolling message logs with timestamps for date filtering: [{ guildId, channelId, userId, timestamp }]
const rollingLogs = [];
const MAX_ROLLING_LOGS = 50000;

// Load persistent stats from disk on bot startup
try {
  if (fs.existsSync(STATS_FILE)) {
    const raw = fs.readFileSync(STATS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data.channelUserStats) {
      for (const [k, v] of Object.entries(data.channelUserStats)) {
        channelUserStats.set(k, v);
      }
    }
    if (data.userTotalStats) {
      for (const [k, v] of Object.entries(data.userTotalStats)) {
        userTotalStats.set(k, v);
      }
    }
    console.log(`[MESSAGE TRACKER] Loaded persistent message stats: ${userTotalStats.size} users indexed.`);
  }
} catch (err) {
  console.warn('[MESSAGE TRACKER] Could not load saved stats file:', err.message);
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const dir = path.dirname(STATS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj = {
        channelUserStats: Object.fromEntries(channelUserStats),
        userTotalStats: Object.fromEntries(userTotalStats),
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(STATS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[MESSAGE TRACKER] Failed to persist stats:', err.message);
    }
  }, 10000); // Debounce saves to every 10 seconds
}

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

  scheduleSave();

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

  scheduleSave();
  return userCounts;
}

/**
 * Scans all readable text channels in a guild and backfills historical message counts.
 * @param {import('discord.js').Guild} guild 
 * @param {number} maxPerChannel 
 */
export async function syncGuildMessageHistory(guild, maxPerChannel = 1000) {
  if (!guild) return { channelsScanned: 0, totalMessagesFound: 0 };

  const textChannels = guild.channels.cache.filter(
    (c) => c.isTextBased() && c.permissionsFor(guild.members.me)?.has(['ViewChannel', 'ReadMessageHistory'])
  );

  let channelsScanned = 0;
  let totalMessagesFound = 0;

  // Track fresh channel-level counts from historical scan
  const scannedUserTotals = new Map();
  const scannedChannelTotals = new Map();

  for (const [, channel] of textChannels) {
    try {
      channelsScanned++;
      let lastId = null;
      let channelFetched = 0;

      while (channelFetched < maxPerChannel) {
        const fetchLimit = Math.min(100, maxPerChannel - channelFetched);
        const options = { limit: fetchLimit };
        if (lastId) options.before = lastId;

        const messages = await channel.messages.fetch(options).catch(() => null);
        if (!messages || messages.size === 0) break;

        for (const msg of messages.values()) {
          channelFetched++;
          totalMessagesFound++;
          lastId = msg.id;

          if (msg.author.bot) continue;

          const uId = msg.author.id;
          const chKey = `${guild.id}:${channel.id}:${uId}`;
          scannedChannelTotals.set(chKey, (scannedChannelTotals.get(chKey) || 0) + 1);
          scannedUserTotals.set(uId, (scannedUserTotals.get(uId) || 0) + 1);
        }

        if (messages.size < fetchLimit) break;
      }
    } catch (e) {
      console.warn(`[SYNC MESSAGES] Channel ${channel.name} fetch warn:`, e.message);
    }
  }

  // Merge scanned totals with real-time stats
  for (const [chKey, count] of scannedChannelTotals.entries()) {
    channelUserStats.set(chKey, Math.max(channelUserStats.get(chKey) || 0, count));
  }
  for (const [uId, count] of scannedUserTotals.entries()) {
    const userKey = `${guild.id}:${uId}`;
    userTotalStats.set(userKey, Math.max(userTotalStats.get(userKey) || 0, count));
  }

  // Immediately persist to disk
  try {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj = {
      channelUserStats: Object.fromEntries(channelUserStats),
      userTotalStats: Object.fromEntries(userTotalStats),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[MESSAGE TRACKER] Failed to persist stats:', err.message);
  }

  return {
    channelsScanned,
    totalMessagesFound,
  };
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
