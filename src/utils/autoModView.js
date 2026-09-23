import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getAutoModSettings, getChannelLinkRule } from './autoModEngine.js';

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

  const rulesCount = Object.keys(settings.channel_link_rules || {}).length;
  const defaultPolicyLabel = settings.default_link_policy === 'allow_all' ? '🟢 Allow All' : '🔴 Block All';

  const embed = new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle(`🛡️ Cohesion Shield • AutoMod & Anti-Spam Manager`)
    .setDescription(
      `Control real-time community protection against spam floods, phishing links, and forbidden words.\n\n` +
      `**Active Protection Toggles:**\n` +
      `• ${settings.anti_link ? '🟢 **ENABLED**' : '🔴 **DISABLED**'} — **🔗 Anti-Link Protection** (Server-wide link control)\n` +
      `• ${settings.anti_invite ? '🟢 **ENABLED**' : '🔴 **DISABLED**'} — **🚪 Anti-Invite Blocker** (Blocks other Discord server invites)\n` +
      `• ${settings.anti_spam ? '🟢 **ENABLED**' : '🔴 **DISABLED**'} — **⚡ Rapid Message Flood** (Blocks message bursting & duplicate spam)\n\n` +
      `**Custom Link Channels:**\n` +
      `👉 **${rulesCount}** channel rule(s) configured • Unconfigured Channels: **${defaultPolicyLabel}**\n\n` +
      `**Punishment Policy:**\n` +
      `👉 **${modeLabels[settings.punishment_mode] || settings.punishment_mode}**\n\n` +
      `**Active Banned Keywords (${settings.banned_words?.length || 0}):**\n` +
      `${wordsPreview}\n\n` +
      `*Use the buttons below to toggle filters, customize channel link rules, or update policies.*`
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
      .setCustomId('automod_btn_channel_rules')
      .setLabel('Custom Channel Links')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Success),
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

/**
 * Builds the visual Channel Link Rules manager dashboard.
 */
export function buildChannelRulesDashboard(guild, guildId, selectedChannelId = null) {
  const settings = getAutoModSettings(guildId);
  const defaultPolicy = settings.default_link_policy || 'block_all';
  const channelRules = settings.channel_link_rules || {};

  // Build configured rules summary list
  const ruleEntries = Object.entries(channelRules);
  let summaryText = '';

  if (ruleEntries.length === 0) {
    summaryText = '*No channels have custom rules yet. All channels currently follow the Server Default Policy.*';
  } else {
    summaryText = ruleEntries
      .map(([cId, r]) => {
        if (r.mode === 'allow_all') {
          return `• <#${cId}>: 🟢 **Allow All Links**`;
        } else if (r.mode === 'block_all') {
          return `• <#${cId}>: 🔴 **Block All Links**`;
        } else {
          const doms = r.allowed_domains && r.allowed_domains.length > 0
            ? r.allowed_domains.map(d => `\`${d}\``).join(', ')
            : '*None*';
          return `• <#${cId}>: 🛡️ **Whitelist Only** (${doms})`;
        }
      })
      .join('\n');
  }

  // Selected channel details
  let selectedDetails = '';
  let selectedChannelObj = null;
  if (selectedChannelId) {
    selectedChannelObj = guild?.channels?.cache?.get(selectedChannelId);
    const existingRule = channelRules[selectedChannelId];
    if (existingRule) {
      if (existingRule.mode === 'allow_all') {
        selectedDetails = `\n\n📌 **Selected: <#${selectedChannelId}>**\nStatus: 🟢 **All Links Permitted** (No restrictions)`;
      } else if (existingRule.mode === 'block_all') {
        selectedDetails = `\n\n📌 **Selected: <#${selectedChannelId}>**\nStatus: 🔴 **All Links Blocked**`;
      } else {
        const domList = existingRule.allowed_domains?.map(d => `\`${d}\``).join(', ') || '*No domains added yet*';
        selectedDetails = `\n\n📌 **Selected: <#${selectedChannelId}>**\nStatus: 🛡️ **Whitelist Links Only**\nAllowed Links: ${domList}`;
      }
    } else {
      selectedDetails = `\n\n📌 **Selected: <#${selectedChannelId}>**\nStatus: ⚪ **Following Server Default** (${defaultPolicy === 'allow_all' ? '🟢 Allow All' : '🔴 Block All'})`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle('🔗 Cohesion Shield • Channel Link Rules & Whitelist')
    .setDescription(
      `Configure exact link permissions for every channel in your server.\n\n` +
      `**Server Default Policy (Unconfigured Channels):**\n` +
      `👉 ${defaultPolicy === 'allow_all' ? '🟢 **Allow All Links** (Links allowed everywhere unless blocked)' : '🔴 **Block All Links** (Links forbidden everywhere unless whitelisted)'}\n\n` +
      `**Active Channel Rules (${ruleEntries.length}):**\n` +
      `${summaryText}` +
      `${selectedDetails}\n\n` +
      `*Select a channel from the dropdown below to configure or change its rule:*`
    )
    .setFooter({ text: 'Cohesion Shield Security • Real-time enforcement' })
    .setTimestamp();

  // 1. Channel Select Menu Row
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('select_automod_rule_channel')
    .setPlaceholder('Select a channel to configure its link rules...')
    .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

  const components = [new ActionRowBuilder().addComponents(channelSelect)];

  // 2. Selected Channel Actions Row (if a channel is currently selected)
  if (selectedChannelId) {
    const channelButtons = [
      new ButtonBuilder()
        .setCustomId(`rule_set_links_${selectedChannelId}`)
        .setLabel('Set Allowed Links')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`rule_mode_all_${selectedChannelId}`)
        .setLabel('Allow All')
        .setEmoji('🟢')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rule_mode_block_${selectedChannelId}`)
        .setLabel('Block All')
        .setEmoji('🔴')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`rule_reset_${selectedChannelId}`)
        .setLabel('Reset to Default')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Secondary),
    ];
    components.push(new ActionRowBuilder().addComponents(channelButtons));
  }

  // 3. Navigation and Global Toggle Row
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('rule_toggle_default_policy')
      .setLabel(`Default Policy: ${defaultPolicy === 'allow_all' ? 'ALLOW ALL' : 'BLOCK ALL'}`)
      .setEmoji('🌐')
      .setStyle(defaultPolicy === 'allow_all' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('automod_back_to_main')
      .setLabel('Back to Shield')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );
  components.push(navRow);

  return { embeds: [embed], components, ephemeral: true };
}

/**
 * Builds the modal for inputting multiple allowed links/domains for a specific channel.
 */
export function buildChannelLinksModal(channelId, channelName, currentDomains = []) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_channel_links_${channelId}`)
    .setTitle(`Allowed Links: #${channelName.slice(0, 20)}`);

  const linksInput = new TextInputBuilder()
    .setCustomId('input_channel_allowed_domains')
    .setLabel('Allowed Links / Domains (Multiple)')
    .setValue(currentDomains.join(', '))
    .setPlaceholder('e.g. x.com, twitter.com\nyoutube.com\nrialo.io, github.com')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(linksInput));
  return modal;
}
