import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { logActivity } from './activityLogger.js';

// Cache of guild AutoMod settings
const autoModSettingsCache = new Map();

// Strike tracking: `${guildId}:${userId}` => { count: number, lastViolation: number }
const userStrikes = new Map();
const STRIKE_EXPIRY_MS = 60 * 60 * 1000; // Strikes expire after 1 hour

// Message timestamps for flood control: `${guildId}:${userId}` => Array<number>
const userMessageTimes = new Map();
const lastMessageContent = new Map();

export const DEFAULT_AUTOMOD_CONFIG = {
  anti_link: true,
  anti_spam: true,
  anti_invite: true,
  punishment_mode: 'warn_timeout_ban', // 'warn_only' | 'warn_timeout' | 'warn_timeout_ban'
  timeout_duration_minutes: 10,
  banned_words: ['scam', 'free-nitro', 'airdrop-claim', 't.me/', 'whatsapp.com', 'discord-nitro'],
  max_strikes_before_timeout: 2,
  max_strikes_before_ban: 3,
};

/**
 * Gets AutoMod settings for a guild (with fallback to defaults).
 */
export function getAutoModSettings(guildId) {
  if (!guildId) return { ...DEFAULT_AUTOMOD_CONFIG };
  const existing = autoModSettingsCache.get(guildId);
  if (existing) return existing;

  const initial = { ...DEFAULT_AUTOMOD_CONFIG, banned_words: [...DEFAULT_AUTOMOD_CONFIG.banned_words] };
  autoModSettingsCache.set(guildId, initial);
  return initial;
}

/**
 * Updates AutoMod settings for a guild.
 */
export function updateAutoModSettings(guildId, updates) {
  const current = getAutoModSettings(guildId);
  const updated = { ...current, ...updates };
  autoModSettingsCache.set(guildId, updated);
  return updated;
}

/**
 * Adds words to the guild banned words list.
 */
export function addBannedWords(guildId, words) {
  const settings = getAutoModSettings(guildId);
  const cleanWords = words
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0 && !settings.banned_words.includes(w));

  settings.banned_words.push(...cleanWords);
  autoModSettingsCache.set(guildId, settings);
  return settings.banned_words;
}

/**
 * Removes a word from the guild banned words list.
 */
export function removeBannedWord(guildId, word) {
  const settings = getAutoModSettings(guildId);
  const clean = word.trim().toLowerCase();
  settings.banned_words = settings.banned_words.filter(w => w !== clean);
  autoModSettingsCache.set(guildId, settings);
  return settings.banned_words;
}

/**
 * Clears all member strikes for a guild.
 */
export function resetGuildStrikes(guildId) {
  let cleared = 0;
  for (const [key] of userStrikes.entries()) {
    if (key.startsWith(`${guildId}:`)) {
      userStrikes.delete(key);
      cleared++;
    }
  }
  return cleared;
}

/**
 * Gets current strike count for a user in a guild.
 */
export function getUserStrikes(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const record = userStrikes.get(key);
  if (!record) return 0;

  // Check if expired
  if (Date.now() - record.lastViolation > STRIKE_EXPIRY_MS) {
    userStrikes.delete(key);
    return 0;
  }
  return record.count;
}

/**
 * Increments user strike count.
 */
function recordUserStrike(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const current = getUserStrikes(guildId, userId);
  const updated = current + 1;
  userStrikes.set(key, { count: updated, lastViolation: Date.now() });
  return updated;
}

/**
 * Inspects an incoming message for spam, links, invites, and banned words.
 * Enforces automatic deletion, strikes, warnings, timeouts, and bans.
 *
 * @param {import('discord.js').Message} message
 * @returns {Promise<{ handled: boolean, reason?: string, action?: string }>}
 */
export async function inspectMessage(message) {
  // Ignore bots, system messages, or DMs
  if (!message.guild || message.author.bot || !message.content) {
    return { handled: false };
  }

  const guildId = message.guild.id;
  const userId = message.author.id;
  const settings = getAutoModSettings(guildId);

  // Immunity Guard: Administrators and ManageMessages holders bypass AutoMod
  if (
    message.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    message.member?.permissions?.has(PermissionFlagsBits.ManageMessages)
  ) {
    return { handled: false };
  }

  const content = message.content;
  const lowerContent = content.toLowerCase();
  let violation = null;

  // 1. Check Banned Words Filter
  if (settings.banned_words && settings.banned_words.length > 0) {
    for (const word of settings.banned_words) {
      if (lowerContent.includes(word)) {
        violation = {
          type: 'banned_word',
          label: 'Forbidden Keyword / Phrase',
          detail: `Matched word: \`${word}\``,
        };
        break;
      }
    }
  }

  // 2. Check Discord Invites
  if (!violation && settings.anti_invite) {
    const inviteRegex = /(discord(?:\.gg|(?:app)?\.com\/invite)\/[a-zA-Z0-9]+)/i;
    if (inviteRegex.test(content)) {
      violation = {
        type: 'discord_invite',
        label: 'Unauthorized Discord Invite Link',
        detail: 'External server invites are prohibited.',
      };
    }
  }

  // 3. Check External Links
  if (!violation && settings.anti_link) {
    const urlRegex = /(https?:\/\/[^\s]+)/i;
    if (urlRegex.test(content)) {
      violation = {
        type: 'unauthorized_link',
        label: 'Unauthorized External Link / URL',
        detail: 'Posting external links without authorization is prohibited.',
      };
    }
  }

  // 4. Check Anti-Spam Message Flood
  if (!violation && settings.anti_spam) {
    const now = Date.now();
    const times = userMessageTimes.get(`${guildId}:${userId}`) || [];
    const recentTimes = times.filter(t => now - t < 3500); // within 3.5 seconds
    recentTimes.push(now);
    userMessageTimes.set(`${guildId}:${userId}`, recentTimes);

    const lastText = lastMessageContent.get(`${guildId}:${userId}`);
    lastMessageContent.set(`${guildId}:${userId}`, content);

    // Flood condition: > 4 messages in 3.5 seconds OR duplicate text repeated rapidly
    if (recentTimes.length >= 5) {
      violation = {
        type: 'spam_flood',
        label: 'Rapid Message Flood Spam',
        detail: `Sent ${recentTimes.length} messages in under 4 seconds.`,
      };
    } else if (lastText && lastText === content && recentTimes.length >= 3) {
      violation = {
        type: 'spam_flood',
        label: 'Repetitive Duplicate Text Spam',
        detail: 'Identical message repeated multiple times.',
      };
    }
  }

  // If clean, do nothing
  if (!violation) {
    return { handled: false };
  }

  // ----------------------------------------------------
  // VIOLATION DETECTED: AUTO-DELETE & ENFORCE PUNISHMENT
  // ----------------------------------------------------

  // 1. Instantly delete violating message
  await message.delete().catch(() => null);

  // 2. Record Strike
  const strikeCount = recordUserStrike(guildId, userId);

  // 3. Determine Punishment Action based on punishment_mode
  let actionTaken = 'warn';
  const mode = settings.punishment_mode || 'warn_timeout_ban';

  if (mode === 'warn_only') {
    actionTaken = 'warn';
  } else if (mode === 'warn_timeout') {
    if (strikeCount >= settings.max_strikes_before_timeout) {
      actionTaken = 'timeout';
    } else {
      actionTaken = 'warn';
    }
  } else if (mode === 'warn_timeout_ban') {
    if (strikeCount >= settings.max_strikes_before_ban) {
      actionTaken = 'ban';
    } else if (strikeCount >= settings.max_strikes_before_timeout) {
      actionTaken = 'timeout';
    } else {
      actionTaken = 'warn';
    }
  }

  // 4. Apply Action
  const member = message.member || (await message.guild.members.fetch(userId).catch(() => null));

  if (actionTaken === 'ban') {
    if (member && member.bannable) {
      await member.ban({
        reason: `Cohesion Shield AutoMod: ${violation.label} (Accumulated ${strikeCount} strikes)`,
      }).catch(err => console.warn('[AUTOMOD BAN WARN]:', err.message));

      await message.channel.send({
        content: `🔨 <@${userId}> was automatically **banned** for excessive violations (${violation.label}).`,
      }).catch(() => null);
    } else {
      actionTaken = 'timeout'; // fallback if bot cannot ban (e.g. hierarchy)
    }
  }

  if (actionTaken === 'timeout') {
    if (member && member.moderatable) {
      const timeoutMs = (settings.timeout_duration_minutes || 10) * 60 * 1000;
      await member.timeout(timeoutMs, `Cohesion Shield AutoMod: ${violation.label}`).catch(err => console.warn('[AUTOMOD TIMEOUT WARN]:', err.message));

      const alertMsg = await message.channel.send({
        content: `⏱️ <@${userId}> has been **timed out for ${settings.timeout_duration_minutes} minutes** for repeated violations (${violation.label} • Strike ${strikeCount}).`,
      }).catch(() => null);

      if (alertMsg) setTimeout(() => alertMsg.delete().catch(() => null), 8000);
    } else {
      actionTaken = 'warn'; // fallback if bot cannot timeout
    }
  }

  if (actionTaken === 'warn') {
    const alertMsg = await message.channel.send({
      content: `⚠️ <@${userId}>, **Warning (Strike ${strikeCount})**: ${violation.label} is prohibited in this server!`,
    }).catch(() => null);

    if (alertMsg) setTimeout(() => alertMsg.delete().catch(() => null), 6000);
  }

  // 5. Send Security Audit Log Embed to #cohesion-logs
  try {
    const actionBadge =
      actionTaken === 'ban' ? '🚨 AUTO-BANNED' : actionTaken === 'timeout' ? '⏱️ TIMED OUT' : '⚠️ WARNED & DELETED';
    const actionColor = actionTaken === 'ban' ? 0xd90429 : actionTaken === 'timeout' ? 0xf77f00 : 0xffb703;

    await logActivity(message.guild, {
      title: `🛡️ Cohesion Shield: ${actionBadge}`,
      description:
        `A message was intercepted and deleted by AutoMod.\n\n` +
        `👤 **Offending User:** <@${userId}> (\`${message.author.tag}\`)\n` +
        `📍 **Channel:** <#${message.channel.id}>\n` +
        `🚨 **Violation:** **${violation.label}**\n` +
        `📝 **Reason / Detail:** ${violation.detail}\n` +
        `⚖️ **Action Taken:** **${actionTaken.toUpperCase()}**\n` +
        `⚡ **Active Strikes:** **${strikeCount}**\n` +
        `💬 **Message Preview:** \`${content.slice(0, 150).replace(/`/g, "'")}\``,
      color: actionColor,
      footer: `Cohesion AutoMod Shield • Strike Policy: ${mode.replace(/_/g, ' ').toUpperCase()}`,
    });
  } catch (logErr) {
    console.warn('[AUTOMOD LOG WARN]:', logErr.message);
  }

  return { handled: true, reason: violation.type, action: actionTaken, strikeCount };
}
