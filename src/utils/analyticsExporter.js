import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  AttachmentBuilder,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { getUserMessageCount, getUserChannelBreakdown, auditChannelMessages, getChannelUserStats } from './messageTracker.js';

/**
 * Builds the visual Member Analytics & CSV Data Export Dashboard.
 */
export function buildExportDashboard(guildId, guildName) {
  const embed = new EmbedBuilder()
    .setColor(0x3a0ca3)
    .setTitle(`📥 Member Analytics & CSV Export • ${guildName || 'Server'}`)
    .setDescription(
      `Choose how you would like to audit and export community activity and member records:\n\n` +
      `🌐 **1. Full Server Export**\n` +
      `Instant all-time spreadsheet of all tracked members with messages, points, XP, level, wallets, and Twitter.\n\n` +
      `📅 **2. Date Range Filter**\n` +
      `Filter active members or joins within a specific timeframe (e.g. \`2026-09-01\` to \`2026-09-20\`).\n\n` +
      `📢 **3. Channel-Specific Message Audit**\n` +
      `Select any specific text channel to count messages and export a channel-exclusive talker leaderboard.\n\n` +
      `👤 **4. Single Member Dossier**\n` +
      `Inspect an individual member's full profile, quest history, purchases, and download a dedicated 1-member CSV.`
    )
    .setFooter({ text: 'Cohesion Data Intelligence • Real-time CSV Generation' })
    .setTimestamp();

  const actionRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_export_all')
      .setLabel('Full Server Export')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_export_daterange')
      .setLabel('Date Range Filter')
      .setEmoji('📅')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_export_channel_prompt')
      .setLabel('Channel Audit')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_export_single_user_prompt')
      .setLabel('Single Member Dossier')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [actionRow1], ephemeral: true };
}

/**
 * Builds the Channel Selector Menu for channel-specific message auditing.
 */
export function buildChannelSelector() {
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('select_export_channel')
    .setPlaceholder('Choose a channel to audit message counts...')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  const row = new ActionRowBuilder().addComponents(channelSelect);

  const embed = new EmbedBuilder()
    .setColor(0x4361ee)
    .setTitle('📢 Channel-Specific Message Audit')
    .setDescription(
      `Select any text or announcement channel from the menu below.\n\n` +
      `Cohesion will audit message counts per user for that channel and generate a channel-specific CSV leaderboard.`
    );

  return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * Builds the User Selector Menu for single-member dossiers.
 */
export function buildUserSelector() {
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('select_export_user')
    .setPlaceholder('Select a member to inspect and export...');

  const row = new ActionRowBuilder().addComponents(userSelect);

  const embed = new EmbedBuilder()
    .setColor(0x7209b7)
    .setTitle('👤 Single Member Deep Dossier')
    .setDescription(
      `Select a server member from the menu below.\n\n` +
      `Cohesion will compile their complete analytics card: total messages, channel breakdown, wallet, socials, quest count, and download a personal CSV.`
    );

  return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * Converts an array of user objects into a CSV AttachmentBuilder.
 */
export function generateUsersCsvAttachment(users, filename = 'cohesion_members_export.csv') {
  const headers = [
    'discord_id',
    'username',
    'messages_sent',
    'level',
    'xp',
    'total_points',
    'wallet_address',
    'twitter_handle',
    'created_at',
  ];

  const rows = [headers.join(',')];

  for (const u of users) {
    const row = [
      `"${u.discord_id || ''}"`,
      `"${(u.username || '').replace(/"/g, '""')}"`,
      u.messages_sent ?? 0,
      u.level ?? 1,
      u.xp ?? 0,
      u.total_points ?? 0,
      `"${u.wallet_address || ''}"`,
      `"${u.twitter_handle || ''}"`,
      `"${u.created_at || ''}"`,
    ];
    rows.push(row.join(','));
  }

  const csvString = rows.join('\n');
  return new AttachmentBuilder(Buffer.from(csvString, 'utf-8'), { name: filename });
}

/**
 * Converts channel message counts into a CSV AttachmentBuilder.
 */
export function generateChannelCsvAttachment(channelName, channelStatsMap, guild) {
  const headers = ['rank', 'discord_id', 'username', 'channel_name', 'messages_count'];
  const rows = [headers.join(',')];

  const sorted = Array.from(channelStatsMap.entries()).sort((a, b) => b[1] - a[1]);

  sorted.forEach(([userId, count], index) => {
    const member = guild?.members?.cache?.get(userId);
    const tag = member?.user?.tag || member?.displayName || 'Unknown';
    const row = [
      index + 1,
      `"${userId}"`,
      `"${tag.replace(/"/g, '""')}"`,
      `"#${channelName}"`,
      count,
    ];
    rows.push(row.join(','));
  });

  const csvString = rows.join('\n');
  const safeName = channelName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return new AttachmentBuilder(Buffer.from(csvString, 'utf-8'), {
    name: `channel_${safeName}_messages_${new Date().toISOString().slice(0, 10)}.csv`,
  });
}
