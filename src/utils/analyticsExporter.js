import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

/**
 * Builds the visual Member Analytics & CSV Data Export Dashboard.
 * "Date Range Filter" is no longer an isolated button; it is natively embedded
 * into Full Server Export, Channel Audit, and Single Member Dossier.
 */
export function buildExportDashboard(guildId, guildName) {
  const embed = new EmbedBuilder()
    .setColor(0x3a0ca3)
    .setTitle(`📥 Member Analytics & CSV Export • ${guildName || 'Server'}`)
    .setDescription(
      `Choose how you would like to audit and export community activity and member records:\n\n` +
      `🌐 **1. Full Server Export**\n` +
      `Instant spreadsheet of all members with messages, points, XP, level, wallets, and Twitter. Includes optional date range filter (leave blank for All-Time).\n\n` +
      `📢 **2. Channel-Specific Message Audit**\n` +
      `Select any text channel and set an optional date range to count human messages and export a channel-exclusive talker leaderboard.\n\n` +
      `👤 **3. Single Member Dossier**\n` +
      `Lookup any member by User ID or Username with an optional date range to inspect their complete activity, quest history, and download a dedicated 1-member CSV.`
    )
    .setFooter({ text: 'Cohesion Data Intelligence • Real-time CSV Generation' })
    .setTimestamp();

  const actionRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_export_all_prompt')
      .setLabel('Full Server Export')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_export_channel_prompt')
      .setLabel('Channel Audit')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_export_single_user_prompt')
      .setLabel('Single Member Dossier')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [actionRow1], ephemeral: true };
}

/**
 * Builds the Modal for Full Server Export with optional Date Range filtering.
 */
export function buildFullServerExportModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal_export_full_server')
    .setTitle('🌐 Full Server Member Export');

  const startDateInput = new TextInputBuilder()
    .setCustomId('input_export_start_date')
    .setLabel('Start Date (YYYY-MM-DD, Optional)')
    .setPlaceholder('e.g. 2026-09-01 (leave blank for all-time)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10)
    .setRequired(false);

  const endDateInput = new TextInputBuilder()
    .setCustomId('input_export_end_date')
    .setLabel('End Date (YYYY-MM-DD, Optional)')
    .setPlaceholder('e.g. 2026-09-21 (leave blank for all-time)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(startDateInput),
    new ActionRowBuilder().addComponents(endDateInput)
  );

  return modal;
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
    .setTitle('📢 Step 1: Select Channel to Audit')
    .setDescription(
      `Select any text or announcement channel from the menu below.\n\n` +
      `After selecting, you will be able to set an optional **Date Range** and **Message Depth** to filter human messages.`
    );

  return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * Builds the Modal for Channel Message Audit with Date Range.
 */
export function buildChannelAuditModal(channelId, channelName) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_export_channel_${channelId}`)
    .setTitle(`📢 Audit #${(channelName || 'channel').slice(0, 30)}`);

  const startDateInput = new TextInputBuilder()
    .setCustomId('input_channel_start_date')
    .setLabel('Start Date (YYYY-MM-DD, Optional)')
    .setPlaceholder('e.g. 2026-09-01 (leave blank for all-time)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10)
    .setRequired(false);

  const endDateInput = new TextInputBuilder()
    .setCustomId('input_channel_end_date')
    .setLabel('End Date (YYYY-MM-DD, Optional)')
    .setPlaceholder('e.g. 2026-09-21 (leave blank for all-time)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10)
    .setRequired(false);

  const limitInput = new TextInputBuilder()
    .setCustomId('input_channel_depth')
    .setLabel('Message Scan Depth (e.g. 200, 500, 1000)')
    .setValue('500')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(4)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(startDateInput),
    new ActionRowBuilder().addComponents(endDateInput),
    new ActionRowBuilder().addComponents(limitInput)
  );

  return modal;
}

/**
 * Builds the Modal for Single Member Dossier (avoids broken 25-item select menus).
 */
export function buildSingleUserDossierModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal_export_single_user')
    .setTitle('👤 Single Member Dossier & Audit');

  const userInput = new TextInputBuilder()
    .setCustomId('input_dossier_user')
    .setLabel('Member ID, Username, or @Mention')
    .setPlaceholder('e.g. 1009827896153608212 or @Nyxoy or Nyxoy')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const startDateInput = new TextInputBuilder()
    .setCustomId('input_dossier_start_date')
    .setLabel('Start Date (YYYY-MM-DD, Optional)')
    .setPlaceholder('e.g. 2026-09-01 (leave blank for all-time)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10)
    .setRequired(false);

  const endDateInput = new TextInputBuilder()
    .setCustomId('input_dossier_end_date')
    .setLabel('End Date (YYYY-MM-DD, Optional)')
    .setPlaceholder('e.g. 2026-09-21 (leave blank for all-time)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(userInput),
    new ActionRowBuilder().addComponents(startDateInput),
    new ActionRowBuilder().addComponents(endDateInput)
  );

  return modal;
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
    'joined_at',
    'created_at',
  ];

  const rows = [headers.join(',')];

  for (const u of users) {
    const row = [
      `"${u.discord_id || ''}"`,
      `"${(u.username || 'Member').replace(/"/g, '""')}"`,
      u.messages_sent ?? 0,
      u.level ?? 1,
      u.xp ?? 0,
      u.total_points ?? 0,
      `"${u.wallet_address || u.evm_address || ''}"`,
      `"${u.twitter_handle || ''}"`,
      `"${u.joined_at || ''}"`,
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
export function generateChannelCsvAttachment(channelName, channelStatsMap, guild, dateRangeLabel = '') {
  const headers = ['rank', 'discord_id', 'username', 'channel_name', 'messages_count', 'timeframe'];
  const rows = [headers.join(',')];

  const sorted = Array.from(channelStatsMap.entries()).sort((a, b) => b[1] - a[1]);

  sorted.forEach(([userId, count], index) => {
    const member = guild?.members?.cache?.get(userId);
    const tag = member?.user?.tag || member?.user?.username || member?.displayName || 'Unknown';
    const row = [
      index + 1,
      `"${userId}"`,
      `"${tag.replace(/"/g, '""')}"`,
      `"#${channelName}"`,
      count,
      `"${dateRangeLabel || 'All-Time'}"`,
    ];
    rows.push(row.join(','));
  });

  const csvString = rows.join('\n');
  const safeName = channelName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return new AttachmentBuilder(Buffer.from(csvString, 'utf-8'), {
    name: `channel_${safeName}_messages_${new Date().toISOString().slice(0, 10)}.csv`,
  });
}
