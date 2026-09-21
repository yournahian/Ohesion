/**
 * Guild Operating Modes & Dual Currency (Points vs XP) Settings Manager.
 * Supports:
 * 1. Presets:
 *    - 'full_economy': Points (CP) + XP + Raffles + Auctions + Marketplace + Quests + Referrals + Attendance + Trivia + Battle
 *    - 'xp_only': Server XP as currency + XP Leveling + Raffles (XP) + Auctions (XP) + Marketplace (XP) + Attendance + Trivia (No separate points)
 *    - 'social_roles_only': Quests + Referrals + Direct Role Rewards (No Points, No Currency)
 *    - 'custom': Custom active modules array chosen by admin
 * 2. Currency:
 *    - 'points' (default Cohesion Points - CP)
 *    - 'xp' (Server Experience - XP)
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';

const cache = new Map();

export const DEFAULT_MODULES = [
  'points',
  'xp',
  'raffles',
  'auctions',
  'marketplace',
  'quests',
  'referrals',
  'attendance',
  'trivia',
  'battle',
  'tickets',
];

export const PRESET_CONFIGS = {
  full_economy: {
    name: '🟢 Full Economy',
    description: 'All features active: Cohesion Points (CP), Leveling XP, Raffles, Auctions, Marketplace, Quests, Referrals.',
    currency: 'points',
    modules: [...DEFAULT_MODULES],
  },
  xp_only: {
    name: '⚪ Level & XP Only (XP Currency)',
    description: 'No virtual points! Server XP is the spendable currency for Raffles, Auctions, and Marketplace.',
    currency: 'xp',
    modules: ['xp', 'raffles', 'auctions', 'marketplace', 'attendance', 'trivia'],
  },
  social_roles_only: {
    name: '🟣 Social & Roles Only',
    description: 'Zero virtual currency/spending. Focuses on Quests, Raids, Support Tickets, and direct Discord Role rewards.',
    currency: 'none',
    modules: ['quests', 'referrals', 'attendance', 'tickets'],
  },
  custom: {
    name: '🎛️ Custom Modular Mode',
    description: 'Server admin has customized exactly which modules are enabled or disabled.',
    currency: 'points',
    modules: [...DEFAULT_MODULES],
  },
};

/**
 * Gets guild settings (from cache or defaults).
 * @param {string} guildId 
 * @returns {Object}
 */
export function getGuildSettings(guildId) {
  if (!guildId) return PRESET_CONFIGS.full_economy;
  const existing = cache.get(guildId);
  if (existing) return existing;

  const defaultSetting = {
    server_mode: 'full_economy',
    currency_type: 'points',
    enabled_modules: [...DEFAULT_MODULES],
    level_up_channel_id: null,
  };
  cache.set(guildId, defaultSetting);
  return defaultSetting;
}

/**
 * Checks if a specific feature module is enabled for a guild.
 * @param {string} guildId 
 * @param {string} moduleKey 
 * @returns {boolean}
 */
export function isModuleEnabled(guildId, moduleKey) {
  const settings = getGuildSettings(guildId);
  return settings.enabled_modules.includes(moduleKey);
}

/**
 * Gets the primary spendable currency for a guild ('points' or 'xp').
 * @param {string} guildId 
 * @returns {'points' | 'xp' | 'none'}
 */
export function getCurrencyType(guildId) {
  const settings = getGuildSettings(guildId);
  return settings.currency_type || 'points';
}

/**
 * Sets a preset mode for a guild.
 * @param {string} guildId 
 * @param {'full_economy' | 'xp_only' | 'social_roles_only' | 'custom'} presetKey 
 */
export function setGuildPreset(guildId, presetKey) {
  const preset = PRESET_CONFIGS[presetKey] || PRESET_CONFIGS.full_economy;
  const updated = {
    server_mode: presetKey,
    currency_type: preset.currency,
    enabled_modules: [...preset.modules],
  };
  cache.set(guildId, updated);
  return updated;
}

/**
 * Sets the primary spendable currency for a guild ('points' or 'xp').
 * @param {string} guildId 
 * @param {'points' | 'xp'} currency 
 */
export function setGuildCurrency(guildId, currency) {
  const current = getGuildSettings(guildId);
  current.currency_type = currency;
  cache.set(guildId, current);
  return current;
}

/**
 * Sets custom active modules for a guild.
 * @param {string} guildId 
 * @param {Array<string>} modules 
 */
export function setGuildCustomModules(guildId, modules) {
  const current = getGuildSettings(guildId);
  current.server_mode = 'custom';
  current.enabled_modules = [...modules];
  // Auto-adjust currency if points is disabled
  if (!modules.includes('points') && current.currency_type === 'points') {
    current.currency_type = modules.includes('xp') ? 'xp' : 'none';
  }
  cache.set(guildId, current);
  return current;
}

/**
 * Builds the interactive Discord Embed and Control Menu for Server Operating Mode & Modules.
 */
export function buildServerModePayload(guildId, guildName) {
  const settings = getGuildSettings(guildId);
  const presetKey = settings.server_mode || 'full_economy';
  const currType = settings.currency_type || 'points';

  const presetLabels = {
    full_economy: '🟢 Full Economy (Points + XP)',
    xp_only: '⚪ Level & XP Only (XP Currency)',
    social_roles_only: '🟣 Social & Roles Only (No Points)',
    custom: '🎛️ Custom Modular Mode',
  };

  const moduleList = [
    { key: 'points', label: '🪙 Points Economy (CP)' },
    { key: 'xp', label: '✨ Leveling & XP Progression' },
    { key: 'raffles', label: '🎟️ Raffles & Giveaways' },
    { key: 'auctions', label: '🔨 Live Auctions' },
    { key: 'marketplace', label: '🛒 Marketplace & Roles' },
    { key: 'quests', label: '🎯 Quests & Social Feeds' },
    { key: 'referrals', label: '🤝 Referral Codes' },
    { key: 'attendance', label: '🎙️ Attendance & VC XP' },
    { key: 'trivia', label: '🧠 Trivia & Quizzes' },
    { key: 'battle', label: '⚔️ Battle Engine' },
    { key: 'tickets', label: '🎫 Support Tickets' },
  ];

  const statusText = moduleList
    .map(m => `${isModuleEnabled(guildId, m.key) ? '✅' : '❌'} **${m.label}**`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x7209b7)
    .setTitle(`⚙️ Server Mode & Module Manager • ${guildName || 'Server'}`)
    .setDescription(
      `Configure which modules run on this server and choose the spendable currency for Auctions, Raffles, and Marketplace.\n\n` +
      `**Current Operating Mode:**\n` +
      `👉 **${presetLabels[presetKey] || presetKey}**\n\n` +
      `**Active Spendable Currency:**\n` +
      `👉 **${currType === 'xp' ? '✨ Experience Points (XP)' : currType === 'points' ? '🪙 Cohesion Points (CP)' : '🚫 None (Direct Roles)'}**\n` +
      `*(Raffles, Live Auctions, and Marketplace purchase transactions use this currency)*\n\n` +
      `**Active Modules Status:**\n` +
      `${statusText}\n\n` +
      `*Use the select menu below to switch presets or the buttons to adjust currency/modules.*`
    )
    .setFooter({ text: 'Cohesion Modular Architecture • Instant Realtime Sync' })
    .setTimestamp();

  const presetSelect = new StringSelectMenuBuilder()
    .setCustomId('select_admin_preset')
    .setPlaceholder('Change Server Preset...')
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('🟢 Full Economy (Points + XP)')
        .setDescription('Default. Both Points & XP enabled. Best for engagement.')
        .setValue('full_economy')
        .setDefault(presetKey === 'full_economy'),
      new StringSelectMenuOptionBuilder()
        .setLabel('⚪ Level & XP Only (XP Currency)')
        .setDescription('Points disabled. XP is used for Raffles/Auctions/Marketplace.')
        .setValue('xp_only')
        .setDefault(presetKey === 'xp_only'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🟣 Social & Roles Only')
        .setDescription('No points or gambling. Social verification and role rewards.')
        .setValue('social_roles_only')
        .setDefault(presetKey === 'social_roles_only'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🎛️ Custom Modular Mode')
        .setDescription('Pick and choose exactly which modules are enabled or disabled.')
        .setValue('custom')
        .setDefault(presetKey === 'custom'),
    ]);

  const selectRow = new ActionRowBuilder().addComponents(presetSelect);

  const nextCur = currType === 'xp' ? 'points' : 'xp';
  const nextCurLabel = nextCur === 'xp' ? 'XP' : 'Points (CP)';

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_toggle_currency')
      .setLabel(`Switch Currency to ${nextCurLabel}`)
      .setEmoji('💱')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_config_custom_modules')
      .setLabel('🎛️ Select Active Modules')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_ticket_alert_config')
      .setLabel('🎫 Ticket Auto-Tag')
      .setEmoji('🔔')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [selectRow, btnRow] };
}

/**
 * Builds the interactive multi-select menu for picking custom active modules.
 */
export function buildCustomModulesSelector(guildId) {
  const currentModules = getGuildSettings(guildId).enabled_modules || DEFAULT_MODULES;

  const moduleOptions = [
    { label: 'Points Economy (CP)', value: 'points', description: 'Enable CP points earnable via commands & quests' },
    { label: 'Leveling & XP', value: 'xp', description: 'Chat XP, rank progression, and tier roles' },
    { label: 'Raffles & Giveaways', value: 'raffles', description: 'Interactive ticket pools and giveaways' },
    { label: 'Live Auctions', value: 'auctions', description: 'Real-time bidding with automatic escrow' },
    { label: 'Marketplace & Roles', value: 'marketplace', description: 'Item shop and auto role assignments' },
    { label: 'Quests & Social Feeds', value: 'quests', description: 'Twitter, CMC, YouTube verification quests' },
    { label: 'Referral Codes', value: 'referrals', description: 'Member invite codes and reward bonuses' },
    { label: 'Attendance & VC XP', value: 'attendance', description: 'Voice channel snapshots and transcription' },
    { label: 'Trivia & Quizzes', value: 'trivia', description: 'Solo quizzes and live Kahoot-style trivia' },
    { label: 'Battle Engine', value: 'battle', description: 'Interactive text/turn-based battle arena' },
    { label: 'Support Tickets', value: 'tickets', description: 'Private 1-on-1 member support channels with transcripts' },
  ];

  const select = new StringSelectMenuBuilder()
    .setCustomId('select_custom_modules')
    .setPlaceholder('Select active modules (Multi-select enabled)...')
    .setMinValues(0)
    .setMaxValues(moduleOptions.length)
    .addOptions(
      moduleOptions.map(opt =>
        new StringSelectMenuOptionBuilder()
          .setLabel(opt.label)
          .setValue(opt.value)
          .setDescription(opt.description)
          .setDefault(currentModules.includes(opt.value))
      )
    );

  const embed = new EmbedBuilder()
    .setColor(0x7209b7)
    .setTitle('🎛️ Customize Active Server Modules')
    .setDescription(
      `Select which modules should be active in this server.\n\n` +
      `Check or uncheck features to create your custom setup, then click outside or submit to apply instantly.\n\n` +
      `*(Note: Setting custom modules will automatically activate the **Custom Mode** preset)*`
    )
    .setFooter({ text: 'Choose any combination • Changes apply instantly' });

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true };
}

/**
 * Sets the designated channel for Level-Up announcements.
 * @param {string} guildId 
 * @param {string | null} channelId 'disabled', 'same', or specific channelId
 */
export function setLevelUpChannel(guildId, channelId) {
  const current = getGuildSettings(guildId);
  current.level_up_channel_id = channelId;
  cache.set(guildId, current);
  return current;
}

/**
 * Builds the interactive payload to configure Level-Up announcement routing.
 * @param {string} guildId 
 * @param {import('discord.js').Guild} guild 
 */
export function buildLevelChannelPayload(guildId, guild) {
  const settings = getGuildSettings(guildId);
  const currentChannelId = settings.level_up_channel_id;

  let currentTargetText = '🔄 **Same Channel** (Where member sent message)';
  if (currentChannelId === 'disabled') {
    currentTargetText = '🚫 **Disabled** (No Level-Up announcements sent)';
  } else if (currentChannelId && currentChannelId !== 'same') {
    currentTargetText = `📢 **Specific Channel:** <#${currentChannelId}>`;
  } else {
    // Check auto-detected channel
    const autoCh = guild?.channels?.cache?.find(
      (c) => c.isTextBased() && /level[-_]?up|levels|bot[-_]?log/i.test(c.name)
    );
    if (autoCh) {
      currentTargetText = `🤖 **Auto-Detected Channel:** <#${autoCh.id}> (\`#${autoCh.name}\`)`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📢 Level-Up Announcement Channel Settings')
    .setDescription(
      `Configure where the **🎉 Level Up!** congratulations cards are posted when members reach a new level.\n\n` +
      `**Current Target:**\n${currentTargetText}\n\n` +
      `**Options:**\n` +
      `1️⃣ **Select Channel Below:** Choose a dedicated channel (e.g. \`#level-up\` or \`#bot-commands\`).\n` +
      `2️⃣ **Same Channel:** Send embed directly in the chat channel where member was talking.\n` +
      `3️⃣ **Disable Announcements:** Turn off Level-Up announcements completely.`
    )
    .setFooter({ text: 'Cohesion Gamification Settings • Instant Sync' })
    .setTimestamp();

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('select_level_up_channel')
    .setPlaceholder('Choose a dedicated channel for Level-Up cards...')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  const row1 = new ActionRowBuilder().addComponents(channelSelect);

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_level_channel_same')
      .setLabel('Send in Same Channel')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_level_channel_disable')
      .setLabel('Disable Announcements')
      .setEmoji('🚫')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('admin_back_main')
      .setLabel('Back to Control Center')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row1, row2], ephemeral: true };
}

/**
 * Sets the auto-tag roles for newly created support tickets.
 * @param {string} guildId 
 * @param {Array<string> | string} roleIds 
 */
export function setTicketAlertRoles(guildId, roleIds) {
  const current = getGuildSettings(guildId);
  current.ticket_alert_role_ids = Array.isArray(roleIds) ? roleIds : [roleIds];
  current.ticket_alert_role_id = current.ticket_alert_role_ids[0] || null;
  cache.set(guildId, current);
  return current;
}
export const setTicketAlertRole = setTicketAlertRoles;

/**
 * Builds the visual selector for Support Ticket Auto-Tag Roles.
 * @param {string} guildId 
 * @param {import('discord.js').Guild} guild 
 */
export function buildTicketSettingsSelector(guildId, guild) {
  const settings = getGuildSettings(guildId);
  const currentRoleIds = settings.ticket_alert_role_ids || (settings.ticket_alert_role_id ? [settings.ticket_alert_role_id] : []);

  let currentAlertText = '🚫 **Disabled** (No roles or staff tagged automatically)';
  const validRoles = currentRoleIds.filter(id => id && id !== 'disabled' && id !== 'none');
  if (validRoles.length > 0) {
    currentAlertText = `🔔 **Active Auto-Tag Role(s) (${validRoles.length}):**\n` + validRoles.map(id => `• <@&${id}> (\`${id}\`)`).join('\n');
  }

  const embed = new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle('🎫 Support Ticket Multi-Role Auto-Tag Settings')
    .setDescription(
      `Configure which roles are automatically mentioned/tagged when a member opens a new support ticket.\n\n` +
      `**Current Status:**\n${currentAlertText}\n\n` +
      `**How it works:**\n` +
      `1️⃣ **Select Role(s) Below:** Pick 1 or multiple staff roles (e.g. \`@Admin\`, \`@Support\`, \`@Moderator\`). You can select up to 10 roles simultaneously!\n` +
      `2️⃣ **Disable Auto-Tag:** Turn off automatic pings completely if you prefer quiet tickets.`
    )
    .setFooter({ text: 'Cohesion Support Ticket Settings • Instant Sync' })
    .setTimestamp();

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('select_ticket_alert_role')
    .setPlaceholder('Choose one or more Staff / Support Roles to auto-tag...')
    .setMinValues(1)
    .setMaxValues(10);

  const row1 = new ActionRowBuilder().addComponents(roleSelect);

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_ticket_alert_disable')
      .setLabel('Disable Auto-Tag')
      .setEmoji('🚫')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('admin_back_main')
      .setLabel('Back to Control Center')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1, row2], ephemeral: true };
}

