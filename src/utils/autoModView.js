import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getAutoModSettings } from './autoModEngine.js';

/**
 * Builds the visual Discord Embed and control buttons for AutoMod & Shield.
 */
export function buildAutoModDashboard(guildId, guildName) {
  const settings = getAutoModSettings(guildId);

  const modeLabels = {
    warn_only: '⚠️ Warn Only (Delete & Warn in chat)',
    warn_timeout: '⏱️ Warn + Timeout (10m Timeout on repeated spam)',
    warn_timeout_ban: '🔨 Full Escalation (Warn ➔ 10m Timeout ➔ Auto-Ban)',
  };

  const wordsPreview =
    settings.banned_words && settings.banned_words.length > 0
      ? settings.banned_words.map(w => `\`${w}\``).join(', ')
      : '*No custom banned words set yet.*';

  const embed = new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle(`🛡️ Cohesion Shield • AutoMod & Anti-Spam Manager`)
    .setDescription(
      `Control real-time community protection against spam floods, phishing links, and forbidden words.\n\n` +
      `**Active Protection Toggles:**\n` +
      `• ${settings.anti_link ? '🟢 **ENABLED**' : '🔴 **DISABLED**'} — **🔗 Anti-Link Protection** (Blocks external web links)\n` +
      `• ${settings.anti_invite ? '🟢 **ENABLED**' : '🔴 **DISABLED**'} — **🚪 Anti-Invite Blocker** (Blocks other Discord server invites)\n` +
      `• ${settings.anti_spam ? '🟢 **ENABLED**' : '🔴 **DISABLED**'} — **⚡ Rapid Message Flood** (Blocks message bursting & duplicate spam)\n\n` +
      `**Punishment Policy:**\n` +
      `👉 **${modeLabels[settings.punishment_mode] || settings.punishment_mode}**\n\n` +
      `**Active Banned Keywords (${settings.banned_words?.length || 0}):**\n` +
      `${wordsPreview}\n\n` +
      `*Use the buttons below to toggle filters, update banned words, or change punishment policies.*`
    )
    .setFooter({ text: 'Cohesion Shield Security • Auto-logged to #cohesion-logs' })
    .setTimestamp();

  const toggleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('automod_toggle_link')
      .setLabel(`Anti-Link: ${settings.anti_link ? 'ON' : 'OFF'}`)
      .setEmoji('🔗')
      .setStyle(settings.anti_link ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('automod_toggle_invite')
      .setLabel(`Anti-Invite: ${settings.anti_invite ? 'ON' : 'OFF'}`)
      .setEmoji('🚪')
      .setStyle(settings.anti_invite ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('automod_toggle_spam')
      .setLabel(`Anti-Spam: ${settings.anti_spam ? 'ON' : 'OFF'}`)
      .setEmoji('⚡')
      .setStyle(settings.anti_spam ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('automod_btn_punishment')
      .setLabel('Punishment Mode')
      .setEmoji('⚖️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('automod_btn_words')
      .setLabel('Banned Words')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('automod_btn_reset_strikes')
      .setLabel('Reset Strikes')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [toggleRow, actionRow], ephemeral: true };
}

/**
 * Builds the Punishment Mode selection menu.
 */
export function buildPunishmentSelector(currentMode) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('select_automod_punishment')
    .setPlaceholder('Choose an AutoMod punishment policy...')
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('⚠️ Warn Only')
        .setDescription('Deletes message & sends self-deleting warning. No timeouts or bans.')
        .setValue('warn_only')
        .setDefault(currentMode === 'warn_only'),
      new StringSelectMenuOptionBuilder()
        .setLabel('⏱️ Warn + Timeout')
        .setDescription('Strike 1 = Warn. Strike 2+ = 10-Minute Timeout / Mute.')
        .setValue('warn_timeout')
        .setDefault(currentMode === 'warn_timeout'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🔨 Full Escalation (Recommended)')
        .setDescription('Strike 1 = Warn. Strike 2 = 10m Timeout. Strike 3 = Auto-Ban.')
        .setValue('warn_timeout_ban')
        .setDefault(currentMode === 'warn_timeout_ban'),
    ]);

  const embed = new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle('⚖️ Select AutoMod Punishment Policy')
    .setDescription(
      `Choose how Cohesion Shield responds when a member violates chat rules:\n\n` +
      `• **⚠️ Warn Only:** Safe mode. Deletes messages and posts a friendly reminder.\n` +
      `• **⏱️ Warn + Timeout:** Moderate security. Mutes repeat spammers for 10 minutes.\n` +
      `• **🔨 Full Escalation:** Maximum security. Warns first, times out on second offense, and automatically bans malicious raiders on 3rd offense.`
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true };
}

/**
 * Builds the Banned Words configuration modal.
 */
export function buildBannedWordsModal(currentWords = []) {
  const modal = new ModalBuilder()
    .setCustomId('modal_automod_words')
    .setTitle('📝 Manage Banned Words Filter');

  const wordsInput = new TextInputBuilder()
    .setCustomId('input_banned_words_list')
    .setLabel('Banned Words / Phrases (Comma-separated)')
    .setValue(currentWords.join(', '))
    .setPlaceholder('e.g. scam, free-crypto, airdrop-claim, t.me/, hack')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(false);

  modal.addComponents(new ActionRowBuilder().addComponents(wordsInput));
  return modal;
}
