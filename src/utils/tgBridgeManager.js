import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';

// Cache for active bridges: guildId => BridgeData
// BridgeData: { guildId, guildName, chatId, chatTitle, syncMode: 'isolated' | 'merged', linkedAt: number }
const bridgeCache = new Map();

// Reverse lookup: chatId => guildId
const tgChatToGuild = new Map();

// Temporary pairing tokens: code => { code, guildId, guildName, chatId, chatTitle, platform: 'discord' | 'telegram', createdBy, expiresAt }
const pairingCodes = new Map();

// Clean up expired pairing codes every 2 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [code, data] of pairingCodes.entries()) {
    if (data.expiresAt < now) {
      pairingCodes.delete(code);
    }
  }
}, 2 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

/**
 * Generates a 6-character pairing code for handshake.
 * @param {string} guildId 
 * @param {string} guildName 
 * @param {string} createdBy 
 * @param {'discord' | 'telegram'} platform 
 */
export function generatePairCode(guildId, guildName, createdBy, platform = 'discord') {
  // Clear any existing active code for this guild/chat
  for (const [code, data] of pairingCodes.entries()) {
    if (platform === 'discord' && data.guildId === guildId) pairingCodes.delete(code);
    if (platform === 'telegram' && data.chatId === guildId) pairingCodes.delete(code);
  }

  const prefix = platform === 'discord' ? 'TG' : 'DC';
  const randomNum = Math.floor(10000 + Math.random() * 90000);
  const code = `${prefix}-${randomNum}`;

  const payload = {
    code,
    guildId: platform === 'discord' ? guildId : null,
    guildName: platform === 'discord' ? guildName : null,
    chatId: platform === 'telegram' ? guildId : null,
    chatTitle: platform === 'telegram' ? guildName : null,
    platform,
    createdBy,
    expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes TTL
  };

  pairingCodes.set(code.toUpperCase(), payload);
  return payload;
}

/**
 * Verifies a pairing code and establishes the bridge.
 * @param {string} inputCode 
 * @param {string} targetId (chatId if paired from TG, guildId if paired from DC)
 * @param {string} targetTitle (chatTitle if paired from TG, guildName if paired from DC)
 * @param {string} pairedBy 
 */
export async function verifyAndPair(inputCode, targetId, targetTitle, pairedBy) {
  const cleanCode = (inputCode || '').trim().toUpperCase();
  const data = pairingCodes.get(cleanCode);

  if (!data) {
    return {
      success: false,
      message: '❌ Invalid or expired pairing code. Please generate a new code from the admin dashboard.',
    };
  }

  if (Date.now() > data.expiresAt) {
    pairingCodes.delete(cleanCode);
    return {
      success: false,
      message: '⏰ This pairing code has expired (15-minute limit). Please generate a fresh code.',
    };
  }

  let guildId, guildName, chatId, chatTitle;

  if (data.platform === 'discord') {
    // Code was generated on Discord, being redeemed in Telegram
    guildId = data.guildId;
    guildName = data.guildName;
    chatId = String(targetId);
    chatTitle = targetTitle || 'Telegram Group';
  } else {
    // Code was generated on Telegram, being redeemed in Discord
    guildId = targetId;
    guildName = targetTitle || 'Discord Server';
    chatId = String(data.chatId);
    chatTitle = data.chatTitle || 'Telegram Group';
  }

  const bridgeData = {
    guildId,
    guildName,
    chatId,
    chatTitle,
    syncMode: 'isolated', // Default to isolated
    linkedAt: Date.now(),
    linkedBy: pairedBy,
  };

  // Update in-memory caches
  bridgeCache.set(guildId, bridgeData);
  tgChatToGuild.set(chatId, guildId);
  pairingCodes.delete(cleanCode);

  // Persist to Supabase if available
  try {
    await supabase.from('community_bridges').upsert({
      guild_id: guildId,
      guild_name: guildName,
      telegram_chat_id: chatId,
      telegram_chat_title: chatTitle,
      sync_mode: 'isolated',
      linked_at: new Date().toISOString(),
      linked_by: String(pairedBy),
    });
  } catch (_) {}

  return {
    success: true,
    bridge: bridgeData,
  };
}

/**
 * Retrieves the bridge settings for a Discord guild.
 * @param {string} guildId 
 */
export function getBridgeSettings(guildId) {
  return bridgeCache.get(guildId) || null;
}

/**
 * Retrieves the bridge settings by Telegram chat ID.
 * @param {string | number} chatId 
 */
export function getBridgeByTelegramChat(chatId) {
  const guildId = tgChatToGuild.get(String(chatId));
  if (!guildId) return null;
  return bridgeCache.get(guildId) || null;
}

/**
 * Updates the synchronization mode for a linked bridge.
 * @param {string} guildId 
 * @param {'isolated' | 'merged'} mode 
 */
export async function setBridgeSyncMode(guildId, mode) {
  const bridge = bridgeCache.get(guildId);
  if (!bridge) return false;

  bridge.syncMode = mode;
  bridgeCache.set(guildId, bridge);

  try {
    await supabase
      .from('community_bridges')
      .update({ sync_mode: mode })
      .eq('guild_id', guildId);
  } catch (_) {}

  return true;
}

/**
 * Unlinks and removes a bridge.
 * @param {string} guildId 
 */
export async function unlinkBridge(guildId) {
  const bridge = bridgeCache.get(guildId);
  if (!bridge) return false;

  tgChatToGuild.delete(bridge.chatId);
  bridgeCache.delete(guildId);

  try {
    await supabase.from('community_bridges').delete().eq('guild_id', guildId);
  } catch (_) {}

  return true;
}

/**
 * Builds the main Discord Telegram Settings Dashboard payload.
 * @param {string} guildId 
 */
export function buildDiscordTgSettingsPayload(guildId) {
  const bridge = getBridgeSettings(guildId);
  const isConnected = Boolean(bridge && bridge.chatId);

  const embed = new EmbedBuilder()
    .setColor(isConnected ? 0x06d6a0 : 0x118ab2)
    .setTitle('✈️ Telegram Community Integration')
    .setTimestamp();

  const row = new ActionRowBuilder();

  if (!isConnected) {
    embed
      .setDescription(
        `### Status: 🔴 **Not Connected**\n\n` +
        `Link your Telegram group to Cohesion to enable cross-platform engagement, community growth, and sync controls.\n\n` +
        `**Available Options:**\n` +
        `• **🔗 Link Telegram Group:** Generates a handshake code to pair your Telegram group.\n` +
        `• **⚙️ Mode:** Configure between **🔒 Isolated** and **🔗 Merged** operation.\n` +
        `• **🛠️ Manage:** Manage Telegram announcements and monitor community stats.\n\n` +
        `*Click **Link Telegram Group** below to get started!*`
      )
      .setFooter({ text: 'Cohesion Dual-Platform Bridge • Step 1: Connect your group' });

    row.addComponents(
      new ButtonBuilder()
        .setCustomId('tg_link_group')
        .setLabel('🔗 Link Telegram Group')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('tg_mode_settings')
        .setLabel('⚙️ Mode (Not Set)')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tg_manage_group')
        .setLabel('🛠️ Manage Telegram')
        .setStyle(ButtonStyle.Danger) // Red indicates unlinked
    );
  } else {
    const modeLabel = bridge.syncMode === 'merged' ? '🔗 Merged (Shared Data)' : '🔒 Isolated (Separate Data)';
    const linkedTimestamp = Math.floor(bridge.linkedAt / 1000);

    embed
      .setDescription(
        `### Status: 🟢 **Connected to Telegram**\n\n` +
        `• **Connected Group:** **${bridge.chatTitle}** (\`${bridge.chatId}\`)\n` +
        `• **Active Sync Mode:** **${modeLabel}**\n` +
        `• **Connected Since:** <t:${linkedTimestamp}:R> (<t:${linkedTimestamp}:f>)\n\n` +
        `*Your Discord server and Telegram group are actively linked! You can toggle the operating mode or manage controls below:*`
      )
      .setFooter({ text: 'Cohesion Dual-Platform Bridge • 🟢 Online & Linked' });

    row.addComponents(
      new ButtonBuilder()
        .setCustomId('tg_link_info')
        .setLabel(`Connected: ${bridge.chatTitle.slice(0, 16)}`)
        .setEmoji('🟢')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('tg_mode_settings')
        .setLabel(`⚙️ Mode: ${bridge.syncMode.toUpperCase()}`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('tg_manage_group')
        .setLabel('🛠️ Manage Telegram')
        .setStyle(ButtonStyle.Success), // Green indicates connected
      new ButtonBuilder()
        .setCustomId('tg_unlink_group')
        .setLabel('Disconnect')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );
  }

  return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * Builds the Mode Selection payload for Discord.
 * @param {string} guildId 
 */
export function buildDiscordTgModeSelector(guildId) {
  const bridge = getBridgeSettings(guildId);

  // If not connected, return a friendly guide warning
  if (!bridge || !bridge.chatId) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xffb703)
      .setTitle('⚠️ Telegram Group Not Linked Yet!')
      .setDescription(
        `Before you can configure the **Sync Mode**, you need to link your Telegram group first.\n\n` +
        `**How to connect:**\n` +
        `1. Click the **🔗 Link Telegram Group** button on the settings panel.\n` +
        `2. Get your 6-character pairing code (e.g. \`TG-84920\`).\n` +
        `3. In your Telegram group, send \`/pair TG-84920\`.\n\n` +
        `Once connected, you will be able to freely switch between **🔒 Isolated** and **🔗 Merged** modes!`
      )
      .setFooter({ text: 'Step 1 required: Connect group first' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tg_link_group')
        .setLabel('🔗 Link Telegram Group Now')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('admin_telegram_settings')
        .setLabel('🔙 Back to Telegram Settings')
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [errorEmbed], components: [row], ephemeral: true };
  }

  // If connected, show the 2 mode options
  const isIsolated = bridge.syncMode === 'isolated';
  const isMerged = bridge.syncMode === 'merged';

  const embed = new EmbedBuilder()
    .setColor(0x7209b7)
    .setTitle('⚙️ Choose Platform Synchronization Mode')
    .setDescription(
      `Select how member data, points, and features should interact between **Discord** and **Telegram**:\n\n` +
      `### 1. 🔒 Isolated Mode ${isIsolated ? '*(Active)*' : ''}\n` +
      `• **Everything is completely separate.**\n` +
      `• Telegram members earn points, climb leaderboards, and enter raffles inside Telegram only.\n` +
      `• Discord members earn points and climb leaderboards inside Discord only.\n` +
      `• Zero cross-platform data mixing or dependencies.\n\n` +
      `### 2. 🔗 Merged Mode ${isMerged ? '*(Active)*' : ''}\n` +
      `• **Unified Community Ecosystem.**\n` +
      `• Members who link their Telegram & Discord accounts share a single unified balance.\n` +
      `• Points earned in Telegram reflect instantly on Discord and vice versa.\n` +
      `• Combined cross-platform leaderboard option.\n\n` +
      `*Click one of the buttons below to switch mode instantly:*`
    )
    .setFooter({ text: `Current Mode: ${bridge.syncMode.toUpperCase()} • Instant Switch` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tg_set_mode_isolated')
      .setLabel('🔒 Isolated (Keep Separate)')
      .setStyle(isIsolated ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('tg_set_mode_merged')
      .setLabel('🔗 Merged (Cross-Platform Sync)')
      .setStyle(isMerged ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('admin_telegram_settings')
      .setLabel('🔙 Back')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * Builds the Telegram Management dashboard inside Discord.
 * @param {string} guildId 
 */
export function buildDiscordTgManagePayload(guildId) {
  const bridge = getBridgeSettings(guildId);

  // If not connected, return friendly guide warning
  if (!bridge || !bridge.chatId) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xe63946)
      .setTitle('⚠️ No Telegram Group Linked!')
      .setDescription(
        `You haven't linked a Telegram group to this Discord server yet.\n\n` +
        `Once linked, this **Management Center** will allow you to:\n` +
        `• 📢 **Broadcast Announcements** to your Telegram community directly from Discord.\n` +
        `• 📊 **Monitor Telegram Group Health** and member counts.\n` +
        `• ⚙️ **Synchronize Modules** between both platforms.\n\n` +
        `👉 Please click **Link Telegram Group** first to activate these controls!`
      )
      .setFooter({ text: 'Link required before accessing management tools' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tg_link_group')
        .setLabel('🔗 Link Telegram Group Now')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('admin_telegram_settings')
        .setLabel('🔙 Back to Telegram Settings')
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [errorEmbed], components: [row], ephemeral: true };
  }

  // If connected, show full manage suite
  const embed = new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle(`🛠️ Manage Telegram Community: ${bridge.chatTitle}`)
    .setDescription(
      `Control and communicate with your Telegram community directly from Discord:\n\n` +
      `• **Group Name:** **${bridge.chatTitle}**\n` +
      `• **Chat ID:** \`${bridge.chatId}\`\n` +
      `• **Operating Mode:** **${bridge.syncMode === 'merged' ? '🔗 Merged' : '🔒 Isolated'}**\n` +
      `• **Linked Since:** <t:${Math.floor(bridge.linkedAt / 1000)}:R>\n\n` +
      `*Choose an administrative action below:*`
    )
    .setFooter({ text: 'Cohesion Discord ➔ Telegram Control Bridge' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tg_broadcast_modal')
      .setLabel('Broadcast to Telegram')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('tg_mode_settings')
      .setLabel('Change Sync Mode')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('admin_telegram_settings')
      .setLabel('Back to Settings')
      .setEmoji('🔙')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * Builds the pairing modal or instruction card for Discord.
 * @param {string} guildId 
 * @param {string} guildName 
 * @param {string} userId 
 */
export function buildDiscordPairingCard(guildId, guildName, userId) {
  const pairData = generatePairCode(guildId, guildName, userId, 'discord');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔗 Link Your Telegram Group')
    .setDescription(
      `Your one-time pairing code is:\n\n` +
      `# \`${pairData.code}\`\n\n` +
      `*(This pairing code will expire in **15 minutes**)*\n\n` +
      `**Follow these 3 quick steps:**\n` +
      `1️⃣ Add your Telegram Bot to your Telegram Group.\n` +
      `2️⃣ Promote the bot to an **Administrator** in the group.\n` +
      `3️⃣ In the Telegram group, send this command:\n` +
      `> \`/pair ${pairData.code}\`\n\n` +
      `*As soon as the command is sent, your Discord server and Telegram group will be permanently connected!*`
    )
    .setFooter({ text: 'Cohesion Instant Handshake Protocol • Code: ' + pairData.code });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_telegram_settings')
      .setLabel('Check Connection Status')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * Builds the broadcast modal to post an announcement into the linked Telegram group.
 */
export function buildTelegramBroadcastModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal_tg_broadcast')
    .setTitle('📢 Broadcast to Telegram Group');

  const titleInput = new TextInputBuilder()
    .setCustomId('input_tg_broadcast_title')
    .setLabel('Announcement Headline')
    .setPlaceholder('e.g. 🎉 New Quest Dropped / Server Update')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(80)
    .setRequired(true);

  const messageInput = new TextInputBuilder()
    .setCustomId('input_tg_broadcast_msg')
    .setLabel('Message Content')
    .setPlaceholder('Type the announcement to broadcast into your Telegram community...')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1500)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(messageInput)
  );

  return modal;
}
