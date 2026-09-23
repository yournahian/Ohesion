import fs from 'fs';
import path from 'path';
import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { logActivity } from './activityLogger.js';

const AUTOMOD_FILE = path.resolve('data/automod_settings.json');

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
  default_link_policy: 'block_all', // 'block_all' | 'allow_all'
  channel_link_rules: {}, // { [channelId]: { mode: 'whitelist' | 'allow_all' | 'block_all', allowed_domains: string[] } }
  max_strikes_before_timeout: 2,
  max_strikes_before_ban: 3,
};

// Load persistent AutoMod settings from disk
try {
  if (fs.existsSync(AUTOMOD_FILE)) {
    const raw = fs.readFileSync(AUTOMOD_FILE, 'utf-8');
    const data = JSON.parse(raw);
    for (const [gId, s] of Object.entries(data)) {
      autoModSettingsCache.set(gId, { ...DEFAULT_AUTOMOD_CONFIG, ...s });
    }
    console.log(`[AUTOMOD ENGINE] Loaded persistent AutoMod settings for ${autoModSettingsCache.size} guilds.`);
  }
} catch (err) {
  console.warn('[AUTOMOD ENGINE] Failed to load saved settings file:', err.message);
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const dir = path.dirname(AUTOMOD_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj = Object.fromEntries(autoModSettingsCache);
      fs.writeFileSync(AUTOMOD_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[AUTOMOD ENGINE] Failed to persist settings:', err.message);
    }
  }, 3000);
}

/**
 * Gets AutoMod settings for a guild (with fallback to defaults).
 */
export function getAutoModSettings(guildId) {
  if (!guildId) return { ...DEFAULT_AUTOMOD_CONFIG };
  const existing = autoModSettingsCache.get(guildId);
  if (existing) {
    if (!existing.channel_link_rules) existing.channel_link_rules = {};
    if (!existing.default_link_policy) existing.default_link_policy = 'block_all';
    return existing;
  }

  const initial = {
    ...DEFAULT_AUTOMOD_CONFIG,
    banned_words: [...DEFAULT_AUTOMOD_CONFIG.banned_words],
    channel_link_rules: {},
  };
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
  scheduleSave();
  return updated;
}

/**
 * Sets a custom link rule for a specific channel.
 */
export function setChannelLinkRule(guildId, channelId, { mode = 'whitelist', allowed_domains = [] }) {
  const settings = getAutoModSettings(guildId);
  if (!settings.channel_link_rules) settings.channel_link_rules = {};

  const cleanDomains = Array.isArray(allowed_domains)
    ? allowed_domains.map(d => d.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/+$/, '')).filter(Boolean)
    : [];

  settings.channel_link_rules[channelId] = {
    mode, // 'whitelist' | 'allow_all' | 'block_all'
    allowed_domains: cleanDomains,
  };

  autoModSettingsCache.set(guildId, settings);
  scheduleSave();
  return settings.channel_link_rules[channelId];
}

/**
 * Removes a custom link rule for a specific channel (inherits default policy).
 */
export function removeChannelLinkRule(guildId, channelId) {
  const settings = getAutoModSettings(guildId);
  if (settings.channel_link_rules && settings.channel_link_rules[channelId]) {
    delete settings.channel_link_rules[channelId];
    autoModSettingsCache.set(guildId, settings);
    scheduleSave();
    return true;
  }
  return false;
}

/**
 * Gets a custom link rule for a channel.
 */
export function getChannelLinkRule(guildId, channelId) {
  const settings = getAutoModSettings(guildId);
  return settings.channel_link_rules?.[channelId] || null;
}

/**
 * Updates the server-wide default link policy for unconfigured channels.
 */
export function setDefaultLinkPolicy(guildId, policy) {
  const settings = getAutoModSettings(guildId);
  settings.default_link_policy = policy === 'allow_all' ? 'allow_all' : 'block_all';
  autoModSettingsCache.set(guildId, settings);
  scheduleSave();
  return settings.default_link_policy;
}

/**
 * Helper to check if a URL matches an allowed domain or custom URL prefix.
 */
function isUrlAllowed(rawUrl, allowedDomains) {
  if (!allowedDomains || allowedDomains.length === 0) return false;

  let hostname = '';
  try {
    const parsed = new URL(rawUrl);
    hostname = parsed.hostname.toLowerCase();
  } catch (_) {
    const match = rawUrl.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
    if (match && match[1]) hostname = match[1].toLowerCase();
  }

  const cleanHost = hostname.replace(/^www\./, '');
  const lowerUrl = rawUrl.toLowerCase();

  for (const domain of allowedDomains) {
    const cleanDomain = domain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/+$/, '');
    if (!cleanDomain) continue;

    // Exact or subdomain match on hostname
    if (cleanHost === cleanDomain || cleanHost.endsWith(`.${cleanDomain}`)) {
      return true;
    }
    // Handle youtu.be / youtube.com aliasing
    if (cleanDomain === 'youtube.com' && (cleanHost === 'youtu.be' || cleanHost.endsWith('.youtu.be'))) {
      return true;
    }
    if (cleanDomain === 'twitter.com' && (cleanHost === 'x.com' || cleanHost.endsWith('.x.com'))) {
      return true;
    }
    if (cleanDomain === 'x.com' && (cleanHost === 'twitter.com' || cleanHost.endsWith('.twitter.com'))) {
      return true;
    }
    // Prefix / substring match for specific path patterns (e.g. "rialo.io/app")
    if (lowerUrl.includes(cleanDomain)) {
      return true;
    }
  }

  return false;
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
  scheduleSave();
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
  scheduleSave();
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

  // 3. Check External Links (with Per-Channel Custom Rules & Whitelist)
  if (!violation && settings.anti_link) {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const foundUrls = content.match(urlRegex);

    if (foundUrls && foundUrls.length > 0) {
      const channelId = message.channel.id;
      const channelRules = settings.channel_link_rules || {};
      const customRule = channelRules[channelId];

      if (customRule) {
        // Channel has specific custom rule
        if (customRule.mode === 'allow_all') {
          // Permitted: Any link allowed in this channel
        } else if (customRule.mode === 'block_all') {
          // Blocked: All links strictly forbidden in this channel
          violation = {
            type: 'unauthorized_link',
            label: 'Unauthorized External Link / URL',
            detail: `External links are strictly blocked in <#${channelId}>.`,
          };
        } else if (customRule.mode === 'whitelist') {
          const allowedDomains = customRule.allowed_domains || [];
          const unapprovedUrls = foundUrls.filter(u => !isUrlAllowed(u, allowedDomains));

          if (unapprovedUrls.length > 0) {
            const domainPreview = allowedDomains.map(d => `\`${d}\``).join(', ');
            violation = {
              type: 'unauthorized_link',
              label: 'Unapproved Link in Whitelisted Channel',
              detail: `Only approved links (${domainPreview || 'none'}) are allowed in <#${channelId}>.`,
            };
          }
        }
      } else {
        // Fallback to Server Default Link Policy
        const defaultPolicy = settings.default_link_policy || 'block_all';
        if (defaultPolicy === 'block_all') {
          violation = {
            type: 'unauthorized_link',
            label: 'Unauthorized External Link / URL',
            detail: 'Posting external links without authorization is prohibited.',
          };
        }
        // If defaultPolicy === 'allow_all', links pass through
      }
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

  // 3. Determine Punishment Action based on Policy & Strikes
  let actionTaken = 'Warned & Message Deleted';
  let penaltyEmbedColor = 0xffa500; // Orange warning

  const policy = settings.punishment_mode || 'warn_timeout_ban';

  if (policy === 'warn_timeout_ban') {
    if (strikeCount >= settings.max_strikes_before_ban) {
      // Auto-Ban
      const banned = await message.member?.ban({ reason: `[AutoMod Shield] 3 Strikes reached: ${violation.label}` }).catch(() => null);
      actionTaken = banned ? '🔨 Auto-Banned from Server (3 Strikes)' : 'Warned (Ban permission failed)';
      penaltyEmbedColor = 0xd90429;
    } else if (strikeCount >= settings.max_strikes_before_timeout) {
      // Timeout (10 minutes)
      const timeoutMs = (settings.timeout_duration_minutes || 10) * 60 * 1000;
      const timedOut = await message.member?.timeout(timeoutMs, `[AutoMod Shield] Strike ${strikeCount}: ${violation.label}`).catch(() => null);
      actionTaken = timedOut ? `⏱️ Timed Out for ${settings.timeout_duration_minutes}m (Strike ${strikeCount})` : 'Warned (Timeout permission failed)';
      penaltyEmbedColor = 0xef233c;
    }
  } else if (policy === 'warn_timeout') {
    if (strikeCount >= settings.max_strikes_before_timeout) {
      const timeoutMs = (settings.timeout_duration_minutes || 10) * 60 * 1000;
      const timedOut = await message.member?.timeout(timeoutMs, `[AutoMod Shield] Strike ${strikeCount}: ${violation.label}`).catch(() => null);
      actionTaken = timedOut ? `⏱️ Timed Out for ${settings.timeout_duration_minutes}m (Strike ${strikeCount})` : 'Warned (Timeout permission failed)';
      penaltyEmbedColor = 0xef233c;
    }
  }

  // 4. Send self-deleting ephemeral-style warning in the channel
  try {
    const warningEmbed = new EmbedBuilder()
      .setColor(penaltyEmbedColor)
      .setTitle(`🛡️ Cohesion Shield • ${violation.label}`)
      .setDescription(
        `Hey <@${userId}>, your message in <#${message.channel.id}> was deleted.\n\n` +
        `**Reason:** ${violation.detail}\n` +
        `**Action:** ${actionTaken}\n` +
        `**Active Strikes:** \`${strikeCount} / ${settings.max_strikes_before_ban}\` *(Expires in 1h)*`
      )
      .setFooter({ text: 'This warning will auto-delete in 8 seconds.' });

    const warnMsg = await message.channel.send({ embeds: [warningEmbed] }).catch(() => null);
    if (warnMsg) {
      setTimeout(() => warnMsg.delete().catch(() => null), 8000);
    }
  } catch (_) {}

  // 5. Send permanent security audit record to #cohesion-logs
  logActivity(message.guild, {
    actionType: 'automod_violation',
    actorId: userId,
    targetId: message.channel.id,
    details: {
      type: violation.type,
      label: violation.label,
      strikes: strikeCount,
      action: actionTaken,
      messageSnippet: content.slice(0, 150),
    },
  }).catch(() => null);

  return {
    handled: true,
    reason: violation.label,
    action: actionTaken,
  };
}
