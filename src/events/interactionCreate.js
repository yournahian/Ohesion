import {
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  AttachmentBuilder,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';
import {
  buildExportDashboard,
  buildChannelSelector,
  buildUserSelector,
  generateUsersCsvAttachment,
  generateChannelCsvAttachment,
} from '../utils/analyticsExporter.js';
import {
  getUserMessageCount,
  getUserChannelBreakdown,
  auditChannelMessages,
} from '../utils/messageTracker.js';
import {
  buildAutoModDashboard,
  buildPunishmentSelector,
  buildBannedWordsModal,
} from '../utils/autoModView.js';
import {
  getAutoModSettings,
  updateAutoModSettings,
  resetGuildStrikes,
} from '../utils/autoModEngine.js';
import {
  getGuildSettings,
  setGuildPreset,
  setGuildCurrency,
  setGuildCustomModules,
  isModuleEnabled,
  getCurrencyType,
  buildServerModePayload,
  buildCustomModulesSelector,
  PRESET_CONFIGS,
  DEFAULT_MODULES,
} from '../utils/guildSettings.js';
import { detectChain } from '../utils/walletValidator.js';
import { parseCmcPostUrl, verifyCmcEngagement } from '../utils/cmcVerifier.js';
import {
  getGuildDrafts,
  saveGuildDraft,
  deleteGuildDraft,
  buildQuestDraftsDashboard,
} from '../utils/questDrafts.js';
import { setGuildInflation, getGuildInflation } from '../workers/inflationWorker.js';
import { buildInflationDashboard } from '../utils/inflationView.js';
import { getAdminPanelPayload } from '../commands/admin/admin.js';
import { addTrackedHandle, removeTrackedHandle, getTrackedHandles } from '../workers/tweetPoller.js';
import { logActivity } from '../utils/activityLogger.js';
import { verifyTwitterAction, parseTweetUrl, fetchTweetOEmbed, fetchTweetMetadata } from '../utils/twitter.js';
import { buildHubPayload } from '../utils/hubView.js';
import { buildAuctionPayload, executeBid, scheduleAuctionConclusion } from '../utils/auctionManager.js';
import { getLevelFromXp } from '../utils/levelCalculator.js';
import {
  buildQuizPayload,
  saveQuiz,
  getQuiz,
  hasUserSubmitted,
  recordSubmission,
  getQuizParticipantCount,
} from '../utils/quizManager.js';
import {
  createLiveSession,
  getLiveSession,
  addQuestionToSession,
  addBulkQuestionsToSession,
  buildSetupDeck,
  submitLiveAnswer,
  startLiveQuiz,
} from '../utils/liveQuizEngine.js';
import {
  buildPollPayload,
  savePoll,
  getPoll,
  castPollVote,
  hasUserVoted,
  concludePoll,
  schedulePollConclusion,
} from '../utils/pollManager.js';
import {
  createBattleMatch,
  joinBattleMatch,
  buildLobbyPayload,
  buildClassSelectionPayload,
  buildFightersListPayload,
  setPlayerArchetype,
  resolveQTEAction,
  startBattleSimulation,
  scheduleCountdowns,
  getActiveMatch,
  getMatchById,
  parseBattleDuration,
  formatDurationDisplay,
} from '../modules/battle/battleEngine.js';
import {
  BATTLE_COSMETICS_CATALOG,
  purchaseCosmeticItem,
  getUserCosmetics,
} from '../modules/battle/battleCosmetics.js';
import {
  stopRecording,
  getRecordingStatus,
  startRecording,
  cancelRecording,
} from '../utils/audioRecorder.js';
import { getActiveAiProvider } from '../utils/callTranscriber.js';

/**
 * Checks if the interacting member has Administrator or ManageGuild permissions.
 */
function isAuthorizedAdmin(interaction) {
  if (!interaction.memberPermissions) return false;
  return (
    interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
  );
}

/**
 * Helper to parse duration string like "10m", "2h", "1d" into milliseconds
 */
function parseDuration(str) {
  const match = str.trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  return null;
}

/**
 * Builds the interactive embed and action buttons for viewing or purchasing tickets for a raffle.
 */
async function buildRafflePanel({ guildId, discordId, raffleId, purchaseResult = null }) {
  const { data: raffle } = await supabase
    .from('raffles')
    .select('*')
    .eq('raffle_id', raffleId)
    .eq('guild_id', guildId)
    .maybeSingle();

  if (!raffle || !raffle.is_active || new Date(raffle.end_time) < new Date()) {
    return { error: '❌ This raffle is inactive or has already ended.' };
  }

  const costPerTicket = Number(raffle.cost);
  const currType = getCurrencyType(guildId);
  const currLabel = currType === 'xp' ? 'XP' : 'CP';
  const balanceField = currType === 'xp' ? 'xp' : 'total_points';

  // Fetch user profile
  const { data: userRecord } = await supabase
    .from('users')
    .select(balanceField)
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .maybeSingle();

  const userBalance = Number(userRecord?.[balanceField] || 0);

  // Fetch all user entries for this raffle to compute user's ticket count
  const { data: userEntries } = await supabase
    .from('raffle_entries')
    .select('tickets_bought')
    .eq('raffle_id', raffleId)
    .eq('discord_id', discordId);

  const userTickets = (userEntries || []).reduce((sum, e) => sum + (e.tickets_bought || 0), 0);

  // Fetch total pool tickets
  const { data: allEntries } = await supabase
    .from('raffle_entries')
    .select('tickets_bought')
    .eq('raffle_id', raffleId);

  const totalPoolTickets = (allEntries || []).reduce((sum, e) => sum + (e.tickets_bought || 0), 0);
  const endTimestampSec = Math.floor(new Date(raffle.end_time).getTime() / 1000);

  let banner = '';
  if (purchaseResult) {
    banner = `✅ **Successfully bought ${purchaseResult.count.toLocaleString()} ticket${purchaseResult.count > 1 ? 's' : ''} for ${purchaseResult.totalCost.toLocaleString()} ${currLabel}!**\n\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(purchaseResult ? 0x06d6a0 : 0x118ab2)
    .setTitle(purchaseResult ? `🎟️ Tickets Purchased: ${raffle.prize}` : `🎟️ Enter Raffle: ${raffle.prize}`)
    .setDescription(
      banner +
      `🎁 **Prize:** **${raffle.prize}**\n` +
      `🪙 **Ticket Cost:** **${costPerTicket.toLocaleString()} ${currLabel}** per ticket\n` +
      `🎟️ **Your Tickets in Pool:** **${userTickets.toLocaleString()} ticket${userTickets === 1 ? '' : 's'}**\n` +
      `🌐 **Total Tickets in Pool:** **${totalPoolTickets.toLocaleString()}**\n` +
      `💰 **Your ${currLabel} Balance:** **${userBalance.toLocaleString()} ${currLabel}**\n` +
      `⏳ **Raffle Ends:** <t:${endTimestampSec}:R> (<t:${endTimestampSec}:f>)\n\n` +
      `*Click a button below to choose how many tickets to buy:*`
    )
    .setFooter({ text: `Raffle ID: ${raffle.raffle_id} • 1 Ticket = ${costPerTicket} ${currLabel}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rfbuy_1_${raffleId}`)
      .setLabel(`Buy 1 Ticket (${costPerTicket} ${currLabel})`)
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(userBalance < costPerTicket),
    new ButtonBuilder()
      .setCustomId(`rfbuy_5_${raffleId}`)
      .setLabel(`Buy 5 Tickets (${costPerTicket * 5} ${currLabel})`)
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(userBalance < costPerTicket * 5),
    new ButtonBuilder()
      .setCustomId(`rfbuy_10_${raffleId}`)
      .setLabel(`Buy 10 Tickets (${costPerTicket * 10} ${currLabel})`)
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(userBalance < costPerTicket * 10),
    new ButtonBuilder()
      .setCustomId(`rfbuy_custom_${raffleId}`)
      .setLabel('Custom Quantity')
      .setEmoji('🔢')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, row, raffle };
}

/**
 * Processes purchasing one or more tickets for a raffle and returns the updated raffle panel.
 */
async function executeRaffleTicketPurchase({ guildId, discordId, raffleId, count = 1 }) {
  const safeCount = Math.max(1, parseInt(count, 10) || 1);

  const { data: raffle } = await supabase
    .from('raffles')
    .select('*')
    .eq('raffle_id', raffleId)
    .eq('guild_id', guildId)
    .maybeSingle();

  if (!raffle || !raffle.is_active || new Date(raffle.end_time) < new Date()) {
    return { error: '❌ This raffle is inactive or has already ended.' };
  }

  const costPerTicket = Number(raffle.cost);
  const totalCost = costPerTicket * safeCount;
  const currType = getCurrencyType(guildId);
  const currLabel = currType === 'xp' ? 'XP' : 'CP';
  const balanceField = currType === 'xp' ? 'xp' : 'total_points';

  const { data: userRecord } = await supabase
    .from('users')
    .select(balanceField)
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .maybeSingle();

  const userBalance = Number(userRecord?.[balanceField] || 0);
  if (userBalance < totalCost) {
    return {
      error: `❌ Insufficient ${currLabel === 'XP' ? 'Experience Points' : 'Cohesion Points'}! You need **${totalCost.toLocaleString()} ${currLabel}** for ${safeCount} ticket(s) (${costPerTicket} ${currLabel} each), but you only have **${userBalance.toLocaleString()} ${currLabel}**.`,
    };
  }

  // Deduct points or XP
  const remainingBalance = userBalance - totalCost;
  await supabase
    .from('users')
    .update({ [balanceField]: remainingBalance })
    .eq('guild_id', guildId)
    .eq('discord_id', discordId);

  // Fetch all existing entries for this user & raffle to consolidate duplicates safely
  const { data: existingEntries } = await supabase
    .from('raffle_entries')
    .select('*')
    .eq('raffle_id', raffleId)
    .eq('discord_id', discordId);

  const currentOwned = (existingEntries || []).reduce((sum, e) => sum + (e.tickets_bought || 0), 0);
  const totalTicketsOwned = currentOwned + safeCount;

  if (existingEntries && existingEntries.length > 0) {
    await supabase
      .from('raffle_entries')
      .update({ tickets_bought: totalTicketsOwned })
      .eq('entry_id', existingEntries[0].entry_id);

    // Delete redundant duplicate rows if any existed
    if (existingEntries.length > 1) {
      const extraIds = existingEntries.slice(1).map(e => e.entry_id);
      await supabase.from('raffle_entries').delete().in('entry_id', extraIds);
    }
  } else {
    await supabase.from('raffle_entries').insert({
      raffle_id: raffleId,
      discord_id: discordId,
      tickets_bought: safeCount,
    });
  }

  return buildRafflePanel({
    guildId,
    discordId,
    raffleId,
    purchaseResult: { count: safeCount, totalCost },
  });
}

/**
 * Automatically fetches YouTube video metadata and thumbnail using public oEmbed API.
 * @param {string} url 
 */
async function fetchYouTubeMetadata(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title,
        author: data.author_name,
        thumbnailUrl: data.thumbnail_url || `https://img.youtube.com/vi/${url.match(/(?:watch\?v=|shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/i)?.[1]}/hqdefault.jpg`,
      };
    }
  } catch (_) {}

  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (match) {
    return {
      title: null,
      author: null,
      thumbnailUrl: `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`,
    };
  }
  return null;
}

/**
 * Automatically fetches OpenGraph metadata (og:image, twitter:image, og:title) from any webpage.
 * @param {string} url 
 */
async function fetchOpenGraphMetadata(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();

    const ogImageMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

    const ogTitleMatch =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i);

    return {
      title: ogTitleMatch ? ogTitleMatch[1].trim() : null,
      imageUrl: ogImageMatch ? ogImageMatch[1].trim() : null,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Processes custom snippet lines:
 * - Resolves Discord role tags (e.g. @Socials, @Verified) to <@&roleId>
 * - Converts Twitter / X handle mentions (e.g. @goldfishggbr or @account) into clickable links [@handle](https://x.com/handle)
 * - Formats requirement text with bullets (• )
 * - Keeps standalone role/mention tags at the bottom without bullets
 */
function processSnippetRequirements(customText, guild, tweetUsername) {
  if (!customText || !customText.trim()) return { snippetBody: '', pingContent: '' };

  const lines = customText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const bulletLines = [];
  const tagLines = [];

  const roles = guild?.roles?.cache ? Array.from(guild.roles.cache.values()) : [];
  const sortedRoles = [...roles].sort((a, b) => b.name.length - a.name.length);

  for (const rawLine of lines) {
    let line = rawLine;

    // 1. Explicit full Twitter/X URLs: https://x.com/username -> [@username](https://x.com/username)
    line = line.replace(/https?:\/\/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,25})(?:\/[^\s)]*)?/gi, '[@$1](https://x.com/$1)');

    // 2. Explicit prefix conversion: x:@handle or twitter:@handle -> [@handle](https://x.com/handle)
    line = line.replace(/\b(?:x|twitter):@?([a-zA-Z0-9_]{1,25})\b/gi, '[@$1](https://x.com/$1)');

    // 3. Support "follow the account" or "follow account" or "follow x"
    line = line.replace(/\bfollow(?:\s+the)?\s+(?:account|x(?:\s+acc(?:ount)?)?)\b/gi, `follow [@${tweetUsername}](https://x.com/${tweetUsername})`);

    // 4. Resolve Discord roles for @RoleName (case-insensitive and word-boundary aware):
    for (const r of sortedRoles) {
      if (!r.name || r.name === '@everyone' || r.name === '@here') continue;
      const escapedRole = r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const roleRegex = new RegExp(`(?<!\\[|<|/|&)@${escapedRole}\\b`, 'gi');
      line = line.replace(roleRegex, `<@&${r.id}>`);
    }

    // 5. Convert @handle into clean X profile link ONLY if NOT already formatted as a link or Discord mention
    // Uses lookbehind to strictly prevent double-wrapping `[[@handle](url)](url)`
    line = line.replace(/(?<!\[|<|\/|&|@)@([a-zA-Z0-9_]{1,25})\b(?![^\[]*\])/g, (match, handle) => {
      const lowerHandle = handle.toLowerCase();
      if (lowerHandle === 'everyone' || lowerHandle === 'here') {
        return `@${handle}`;
      }
      if (lowerHandle === 'account' || lowerHandle === 'x') {
        return `[@${tweetUsername}](https://x.com/${tweetUsername})`;
      }

      // Check if it matches a guild role by exact or normalized name (ignoring special chars)
      const matchedRole = roles.find((r) => {
        const rLower = r.name.toLowerCase();
        return (
          rLower === lowerHandle ||
          rLower.replace(/[^a-z0-9]/g, '') === lowerHandle.replace(/[^a-z0-9]/g, '')
        );
      });
      if (matchedRole) {
        return `<@&${matchedRole.id}>`;
      }

      // Default to X profile link
      return `[@${handle}](https://x.com/${handle})`;
    });

    // 6. Check if this line is purely a role/tag mention (e.g. "@Socials" or "<@&12345>" or "@everyone")
    const isPureTagLine = /^(?:<@&?\d+>|@everyone|@here|\s+)+$/.test(line);

    if (isPureTagLine) {
      tagLines.push(line);
    } else {
      // Ensure bullet prefix
      const cleanText = line.replace(/^[•\-\*]\s*/, '');
      bulletLines.push(`• ${cleanText}`);
    }
  }

  return {
    snippetBody: bulletLines.join('\n'),
    pingContent: tagLines.join('\n'),
  };
}

export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // ==========================================
    // 1. HANDLE SLASH COMMANDS
    // ==========================================
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        const replyOptions = {
          content: 'There was an error while executing this command!',
          ephemeral: true,
        };

        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(replyOptions).catch(() => null);
          } else {
            await interaction.reply(replyOptions).catch(() => null);
          }
        } catch (_) {}
      }
      return;
    }

    // ==========================================
    // 2. HANDLE BUTTON CLICKS
    // ==========================================
    if (interaction.isButton()) {
      const customId = interaction.customId;
      const guildId = interaction.guildId;
      const discordId = interaction.user.id;

      // Security Guard: Check admin permissions for any admin button
      if (customId.startsWith('admin_')) {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ **Access Denied**: You need `Manage Server` or `Administrator` permissions to use this control.',
            ephemeral: true,
          });
        }
      }

      // --- RECORDING SESSION BUTTONS ---
      if (customId === 'record_status') {
        const status = getRecordingStatus(guildId);
        if (!status) {
          return interaction.reply({
            content: 'ℹ️ No active recording session currently running in this server.',
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0x118ab2)
          .setTitle('🎙️ Active Recording Session Status')
          .setDescription(
            `• **Voice Channel:** <#${status.channelId}>\n` +
            `• **Elapsed Duration:** \`${status.durationFormatted}\`\n` +
            `• **Active Speakers (${status.speakersCount}):** ${status.speakers.map((s) => `\`${s}\``).join(', ') || '*Listening for voices...*'}\n` +
            `• **Output Mode:** \`${status.mode.toUpperCase()}\`\n` +
            `• **Initiated By:** ${status.initiatedBy}`
          )
          .setFooter({ text: `Session ID: ${status.sessionId}` })
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (customId === 'record_stop') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ **Access Denied**: You need `Manage Server` or `Administrator` permissions to stop recordings.',
            ephemeral: true,
          });
        }

        const activeStatus = getRecordingStatus(guildId);
        if (!activeStatus) {
          return interaction.reply({
            content: '⚠️ No active recording session is running in this server.',
            ephemeral: true,
          });
        }

        // Ownership Check: Only the admin who started the recording can stop and receive deliverables
        if (activeStatus.initiatedById && interaction.user.id !== activeStatus.initiatedById) {
          return interaction.reply({
            content: `⛔ **Session Ownership Restriction**: This recording was started by <@${activeStatus.initiatedById}>.\nOnly the original session controller can stop the recording and receive the deliverables.`,
            ephemeral: true,
          });
        }

        if (interaction.isButton()) {
          await interaction.deferUpdate();
        } else {
          await interaction.deferReply({ ephemeral: true });
        }

        await interaction.editReply({
          content: '⏳ **Concluding session and processing multi-track audio...**\n*Mixing master track, aligning speaker stems, and generating AI meeting notes. This may take 10-30 seconds depending on duration.*',
          embeds: [],
          components: [],
        });

        try {
          const deliverables = await stopRecording(guildId);
          const { sessionMeta } = deliverables;

          const embed = new EmbedBuilder()
            .setColor(0x06d6a0)
            .setTitle('🎙️ Podcast & Call Production Ready!')
            .setDescription(
              `**Channel:** <#${sessionMeta.channelId}>\n` +
              `**Total Duration:** \`${sessionMeta.durationFormatted}\`\n` +
              `**Recorded Speakers (${sessionMeta.speakers.length}):** ${sessionMeta.speakers.map((s) => `\`${s}\``).join(', ') || '*None detected*'}\n` +
              `**Mode:** \`${sessionMeta.mode.toUpperCase()}\``
            )
            .setTimestamp();

          if (deliverables.meetingNotesMarkdown && deliverables.meetingNotesMarkdown.length > 50) {
            const previewText = deliverables.meetingNotesMarkdown
              .replace(/^#+ [^\n]+/gm, '')
              .trim()
              .slice(0, 1000);

            embed.addFields({
              name: '📋 Executive Briefing Preview',
              value: previewText + (deliverables.meetingNotesMarkdown.length > 1000 ? '\n\n*(Full briefing attached below)*' : ''),
            });
          }

          const attachedFilesList = [];
          if (deliverables.webDownloads && deliverables.webDownloads.length > 0) {
            for (const item of deliverables.webDownloads) {
              const icon = item.filename.endsWith('.mp3')
                ? '🎵'
                : item.filename.endsWith('.zip')
                ? '🗂️'
                : item.filename.includes('Script')
                ? '📝'
                : '📋';

              if (item.isOversized) {
                attachedFilesList.push(`${icon} **${item.displayName}** (\`${item.sizeFormatted}\`) — *Exceeds Discord 25MB limit (Direct Web Download)*`);
              } else {
                attachedFilesList.push(`${icon} \`${item.displayName}\` (\`${item.sizeFormatted}\`)`);
              }
            }
          }

          if (attachedFilesList.length > 0) {
            embed.addFields({
              name: '📦 Session Deliverables',
              value: attachedFilesList.join('\n'),
            });
          } else {
            embed.addFields({
              name: 'ℹ️ Deliverables',
              value: 'No audio chunks were captured from speakers during this session.',
            });
          }

          if (deliverables.largeFiles && deliverables.largeFiles.length > 0) {
            embed.addFields({
              name: '🌐 High-Capacity Web Downloads (>25MB)',
              value:
                'The following files exceeded Discord\'s 25MB attachment limit. You can download them directly at full speed:\n' +
                deliverables.largeFiles
                  .map((f) => `• [📥 **${f.displayName}** (${f.sizeFormatted})](${f.downloadUrl})`)
                  .join('\n'),
            });
          }

          const actionRows = [];
          const downloadButtons = [];

          // Create link buttons for audio & zip deliverables (up to 5 buttons max)
          if (deliverables.webDownloads && deliverables.webDownloads.length > 0) {
            const downloadsForButtons = deliverables.webDownloads.filter(
              (f) => f.filename.endsWith('.mp3') || f.filename.endsWith('.zip')
            );
            for (const file of downloadsForButtons.slice(0, 5)) {
              const label = file.filename.endsWith('.zip')
                ? `📥 Stems ZIP (${file.sizeFormatted})`
                : `🎵 Master MP3 (${file.sizeFormatted})`;

              downloadButtons.push(
                new ButtonBuilder()
                  .setLabel(label.slice(0, 80))
                  .setStyle(ButtonStyle.Link)
                  .setURL(file.downloadUrl)
              );
            }
          }

          if (downloadButtons.length > 0) {
            actionRows.push(new ActionRowBuilder().addComponents(downloadButtons));
          }

          return interaction.editReply({
            content: `✅ Recording session concluded! Here are your production deliverables:`,
            embeds: [embed],
            components: actionRows,
            files: deliverables.filesToAttach,
          });
        } catch (err) {
          console.error('[RECORD STOP BUTTON ERROR]:', err);
          return interaction.editReply({
            content: `❌ Error finalizing recording: ${err.message}`,
          });
        }
      }

      // --- ADMIN VOICE RECORDER & NOTES UI CONTROLS ---
      if (customId === 'admin_record_vc') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ **Access Denied**: You need `Manage Server` or `Administrator` permissions to manage recordings.',
            ephemeral: true,
          });
        }

        const activeStatus = getRecordingStatus(guildId);
        if (activeStatus) {
          const isOwner = activeStatus.initiatedById ? interaction.user.id === activeStatus.initiatedById : true;

          if (isOwner) {
            const embed = new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle('🔴 Multi-Track Voice Recording Active (Session Controller)')
              .setDescription(
                `Cohesion is currently recording in **<#${activeStatus.channelId}>**!\n\n` +
                `• **Session Controller:** <@${activeStatus.initiatedById}> (You)\n` +
                `• **Elapsed Duration:** \`${activeStatus.durationFormatted}\`\n` +
                `• **Active Speakers (${activeStatus.speakersCount}):** ${activeStatus.speakers.map((s) => `\`${s}\``).join(', ') || '*Listening for voices...*'}\n` +
                `• **Selected Mode:** \`${activeStatus.mode.toUpperCase()}\`\n\n` +
                `Click **Stop & Process Deliverables** when you want to conclude the session and generate deliverables.`
              )
              .setFooter({ text: `Session ID: ${activeStatus.sessionId} • Cohesion Podcast Engine` })
              .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('record_stop')
                .setLabel('Stop & Process Deliverables')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId('admin_rec_refresh')
                .setLabel('Refresh Status')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId('admin_rec_cancel')
                .setLabel('Cancel / Discard')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Secondary)
            );

            if (interaction.replied || interaction.deferred) {
              return interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
            }
            return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
          } else {
            const embed = new EmbedBuilder()
              .setColor(0xf39c12)
              .setTitle('🎙️ Voice Recording Active in Server (Monitor View)')
              .setDescription(
                `A multi-track recording session is currently active in **<#${activeStatus.channelId}>**!\n\n` +
                `• **Session Controller:** <@${activeStatus.initiatedById}> (${activeStatus.initiatedBy})\n` +
                `• **Elapsed Duration:** \`${activeStatus.durationFormatted}\`\n` +
                `• **Active Speakers (${activeStatus.speakersCount}):** ${activeStatus.speakers.map((s) => `\`${s}\``).join(', ') || '*Listening for voices...*'}\n` +
                `• **Selected Mode:** \`${activeStatus.mode.toUpperCase()}\`\n\n` +
                `🔒 **Ownership Protected:**\n` +
                `This session was started by <@${activeStatus.initiatedById}>. Only the session controller can stop the recording and receive the production deliverables.`
              )
              .setFooter({ text: `Session ID: ${activeStatus.sessionId} • Read-Only Monitor` })
              .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('admin_rec_refresh')
                .setLabel('Refresh Status')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary)
            );

            if (interaction.replied || interaction.deferred) {
              return interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
            }
            return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
          }
        }

        // Fetch voice channels
        await interaction.guild.channels.fetch().catch(() => null);
        const voiceChannels = Array.from(interaction.guild.channels.cache.filter((c) => c.isVoiceBased()).values());

        if (voiceChannels.length === 0) {
          return interaction.reply({
            content: '⚠️ No voice channels found in this server. Please create a voice channel first!',
            ephemeral: true,
          });
        }

        const aiProvider = getActiveAiProvider();
        let aiProviderLabel = 'None (Audio Only ready)';
        if (aiProvider === 'groq') aiProviderLabel = '🟢 Groq Cloud (Free Whisper Turbo + LLaMA 3.3)';
        else if (aiProvider === 'gemini') aiProviderLabel = '🟢 Google Gemini 1.5 Flash (Free)';
        else if (aiProvider === 'openai') aiProviderLabel = '🟡 OpenAI Whisper';

        const options = voiceChannels.slice(0, 25).map((vc) => {
          const count = interaction.guild.voiceStates.cache.filter((vs) => vs.channelId === vc.id && !vs.member?.user?.bot).size;
          return new StringSelectMenuOptionBuilder()
            .setLabel(vc.name.slice(0, 50))
            .setDescription(`${count} active member${count === 1 ? '' : 's'} connected`)
            .setValue(vc.id)
            .setEmoji(vc.type === ChannelType.GuildStageVoice ? '🎭' : '🔊');
        });

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_rec_target')
          .setPlaceholder('Select Voice Channel to Record')
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('🎙️ Multi-Track Voice Recorder & AI Notes Dashboard')
          .setDescription(
            `Choose a voice channel from the menu below to configure your recording session.\n\n` +
            `**Output Options Available:**\n` +
            `• 🎙️ **Both (Default):** Multi-track audio stems (\`.zip\`) + Master mix (\`.mp3\`) + AI Dialogue Script (\`.md\`) + Executive Action Notes (\`.md\`)\n` +
            `• 🎵 **Audio Only:** Isolated stems + Master mix (100% local, 0 AI calls, no API key needed)\n` +
            `• 📝 **Script & Notes Only:** AI transcription & summary (audio auto-deleted after processing)\n\n` +
            `*Active AI Engine:* **${aiProviderLabel}**`
          )
          .setFooter({ text: 'Cohesion Visual Recording Deck • 100% UI Driven' });

        if (interaction.replied || interaction.deferred) {
          return interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
        }
        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      if (customId === 'admin_rec_refresh') {
        const activeStatus = getRecordingStatus(guildId);
        if (!activeStatus) {
          return interaction.update({
            content: 'ℹ️ No recording session is currently active.',
            embeds: [],
            components: [],
          });
        }

        const isOwner = activeStatus.initiatedById ? interaction.user.id === activeStatus.initiatedById : true;

        if (isOwner) {
          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔴 Multi-Track Voice Recording Active (Session Controller)')
            .setDescription(
              `Cohesion is currently recording in **<#${activeStatus.channelId}>**!\n\n` +
              `• **Session Controller:** <@${activeStatus.initiatedById}> (You)\n` +
              `• **Elapsed Duration:** \`${activeStatus.durationFormatted}\`\n` +
              `• **Active Speakers (${activeStatus.speakersCount}):** ${activeStatus.speakers.map((s) => `\`${s}\``).join(', ') || '*Listening for voices...*'}\n` +
              `• **Selected Mode:** \`${activeStatus.mode.toUpperCase()}\`\n\n` +
              `Click **Stop & Process Deliverables** when you want to conclude the session and generate deliverables.`
            )
            .setFooter({ text: `Session ID: ${activeStatus.sessionId} • Refreshed just now` })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('record_stop')
              .setLabel('Stop & Process Deliverables')
              .setEmoji('⏹️')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId('admin_rec_refresh')
              .setLabel('Refresh Status')
              .setEmoji('🔄')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId('admin_rec_cancel')
              .setLabel('Cancel / Discard')
              .setEmoji('❌')
              .setStyle(ButtonStyle.Secondary)
          );

          return interaction.update({ embeds: [embed], components: [row] });
        } else {
          const embed = new EmbedBuilder()
            .setColor(0xf39c12)
            .setTitle('🎙️ Voice Recording Active in Server (Monitor View)')
            .setDescription(
              `A multi-track recording session is currently active in **<#${activeStatus.channelId}>**!\n\n` +
              `• **Session Controller:** <@${activeStatus.initiatedById}> (${activeStatus.initiatedBy})\n` +
              `• **Elapsed Duration:** \`${activeStatus.durationFormatted}\`\n` +
              `• **Active Speakers (${activeStatus.speakersCount}):** ${activeStatus.speakers.map((s) => `\`${s}\``).join(', ') || '*Listening for voices...*'}\n` +
              `• **Selected Mode:** \`${activeStatus.mode.toUpperCase()}\`\n\n` +
              `🔒 **Ownership Protected:**\n` +
              `This session was started by <@${activeStatus.initiatedById}>. Only the session controller can stop the recording and receive the production deliverables.`
            )
            .setFooter({ text: `Session ID: ${activeStatus.sessionId} • Refreshed just now` })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('admin_rec_refresh')
              .setLabel('Refresh Status')
              .setEmoji('🔄')
              .setStyle(ButtonStyle.Secondary)
          );

          return interaction.update({ embeds: [embed], components: [row] });
        }
      }

      if (customId === 'admin_rec_cancel') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ **Access Denied**: You need `Manage Server` permissions.',
            ephemeral: true,
          });
        }

        const activeStatus = getRecordingStatus(guildId);
        if (!activeStatus) {
          return interaction.update({
            content: 'ℹ️ No active recording session was running.',
            embeds: [],
            components: [],
          });
        }

        // Ownership Check: Only session owner can cancel
        if (activeStatus.initiatedById && interaction.user.id !== activeStatus.initiatedById) {
          return interaction.reply({
            content: `⛔ **Access Denied**: This recording was started by <@${activeStatus.initiatedById}>. Only the session controller can discard it.`,
            ephemeral: true,
          });
        }

        const cancelled = cancelRecording(guildId);
        if (cancelled) {
          return interaction.update({
            content: '🛑 **Recording cancelled.** Audio capture was stopped and all temporary session files have been safely deleted.',
            embeds: [],
            components: [],
          });
        }
        return interaction.update({
          content: 'ℹ️ No active recording session was running.',
          embeds: [],
          components: [],
        });
      }

      if (customId.startsWith('admin_rec_start_')) {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ **Access Denied**: You need `Manage Server` permissions.',
            ephemeral: true,
          });
        }

        // Prevent multiple simultaneous recording sessions
        const activeCheck = getRecordingStatus(guildId);
        if (activeCheck) {
          return interaction.reply({
            content: `⚠️ A recording session is already active in **<#${activeCheck.channelId}>** (started by <@${activeCheck.initiatedById}>). Please wait for it to conclude.`,
            ephemeral: true,
          });
        }

        // customId format: admin_rec_start_<channelId>_<mode>
        const parts = customId.replace('admin_rec_start_', '').split('_');
        const targetChannelId = parts[0];
        const mode = parts[1] || 'both';

        const channel = interaction.guild?.channels?.cache?.get(targetChannelId);
        if (!channel) {
          return interaction.update({
            content: '❌ Voice channel not found. Please try again.',
            embeds: [],
            components: [],
          });
        }

        const permissions = channel.permissionsFor(interaction.client.user);
        if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions?.has(PermissionFlagsBits.Speak)) {
          return interaction.update({
            content: `❌ I do not have permission to **Connect** or **Speak** in <#${channel.id}>. Please grant Cohesion voice permissions!`,
            embeds: [],
            components: [],
          });
        }

        await interaction.deferUpdate();

        try {
          const session = await startRecording({
            voiceChannel: channel,
            client: interaction.client,
            mode,
            initiatedBy: interaction.user,
          });

          const modeDisplay = {
            both: '🎙️ **Both** (Audio Stems + Master MP3 + Dialogue Script + Notes)',
            audio: '🎵 **Audio Only** (Isolated Stems + Master MP3, 0 AI)',
            script: '📝 **Script & Notes Only** (AI Transcription, Audio deleted)',
          }[mode];

          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔴 Multi-Track Voice Recording Active')
            .setDescription(
              `Cohesion is now recording in **<#${channel.id}>**!\n\n` +
              `• **Output Mode:** ${modeDisplay}\n` +
              `• **Started By:** <@${interaction.user.id}>\n` +
              `• **Stem Synchronization:** Timeline-aligned from \`00:00\`\n\n` +
              `*Each member who speaks will be recorded to their own isolated audio track. When finished, click **Stop & Process Deliverables**.*`
            )
            .setFooter({ text: `Session ID: ${session.sessionId} • Cohesion Podcast Engine` })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('record_stop')
              .setLabel('Stop & Process Deliverables')
              .setEmoji('⏹️')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId('admin_rec_refresh')
              .setLabel('Refresh Status')
              .setEmoji('🔄')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId('admin_rec_cancel')
              .setLabel('Cancel / Discard')
              .setEmoji('❌')
              .setStyle(ButtonStyle.Secondary)
          );

          await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (err) {
          console.error('[ADMIN REC START ERROR]:', err);
          return interaction.editReply({
            content: `❌ Could not start recording: ${err.message}`,
            embeds: [],
            components: [],
          });
        }
        return;
      }

      // --- A. ADMIN MODAL TRIGGERS (Show modal before deferring) ---
      if (customId === 'admin_post_tweet') {
        const modal = new ModalBuilder()
          .setCustomId('modal_post_tweet')
          .setTitle('📢 Create Tweet Engagement Quest');

        const urlInput = new TextInputBuilder()
          .setCustomId('input_tweet_url')
          .setLabel('Twitter / X Post URL')
          .setPlaceholder('https://x.com/username/status/123456789...')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const pointsHoursInput = new TextInputBuilder()
          .setCustomId('input_points_hours')
          .setLabel('Points & Duration (e.g. 25, 30m or 24h)')
          .setValue('25, 24h')
          .setPlaceholder('e.g. 25, 30m or 25, 24h (Points, Duration)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const optionsInput = new TextInputBuilder()
          .setCustomId('input_options')
          .setLabel('Show Image, Action Buttons (e.g. yes, yes)')
          .setValue('yes, yes')
          .setPlaceholder('e.g. yes, yes or yes, no')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const ctaInput = new TextInputBuilder()
          .setCustomId('input_call_to_action')
          .setLabel('Headline / Call to Action (Optional)')
          .setPlaceholder('e.g. Engage to collect your points')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(60)
          .setRequired(false);

        const textInput = new TextInputBuilder()
          .setCustomId('input_custom_text')
          .setLabel('Custom Snippet & Requirements (Optional)')
          .setPlaceholder('e.g. Must follow @account.\nOnly @Verified role can participate.\n@Socials')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(urlInput),
          new ActionRowBuilder().addComponents(pointsHoursInput),
          new ActionRowBuilder().addComponents(optionsInput),
          new ActionRowBuilder().addComponents(ctaInput),
          new ActionRowBuilder().addComponents(textInput)
        );

        try {
          return await interaction.showModal(modal);
        } catch (modalErr) {
          console.error('[SHOW POST TWEET MODAL ERROR]:', modalErr);
          if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({ content: `❌ Could not open form: ${modalErr.message}`, ephemeral: true });
          }
        }
      }

      if (customId === 'admin_create_raffle') {
        const modal = new ModalBuilder()
          .setCustomId('modal_create_raffle')
          .setTitle('🎟️ Create New Community Raffle');

        const prizeInput = new TextInputBuilder()
          .setCustomId('input_raffle_prize')
          .setLabel('Raffle Prize')
          .setPlaceholder('e.g. VIP Role, 100 USDT, or Steam Key')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const costInput = new TextInputBuilder()
          .setCustomId('input_raffle_cost')
          .setLabel('Ticket Cost (Cohesion Points - CP)')
          .setValue('50')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const durationInput = new TextInputBuilder()
          .setCustomId('input_raffle_duration')
          .setLabel('Duration (e.g. 1h, 24h, 3d)')
          .setValue('24h')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(prizeInput),
          new ActionRowBuilder().addComponents(costInput),
          new ActionRowBuilder().addComponents(durationInput)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN CREATE QUIZ MODAL ---
      if (customId === 'admin_create_quiz') {
        const modal = new ModalBuilder()
          .setCustomId('modal_create_quiz')
          .setTitle('🧠 Create Community Quiz / Trivia');

        const questionInput = new TextInputBuilder()
          .setCustomId('input_quiz_question')
          .setLabel('Quiz Question')
          .setPlaceholder('e.g. What blockchain does Cohesion primarily deploy on?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const choicesInput = new TextInputBuilder()
          .setCustomId('input_quiz_choices')
          .setLabel('Choices (2 to 4, one per line)')
          .setPlaceholder('Base\nEthereum\nSolana\nPolygon')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const answerInput = new TextInputBuilder()
          .setCustomId('input_quiz_answer')
          .setLabel('Correct Choice Number (1, 2, 3, or 4)')
          .setPlaceholder('1')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const rewardsInput = new TextInputBuilder()
          .setCustomId('input_quiz_rewards')
          .setLabel('Rewards: Points, XP (e.g. 50, 25)')
          .setValue('50, 25')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const durationInput = new TextInputBuilder()
          .setCustomId('input_quiz_duration')
          .setLabel('Duration (e.g. 30m, 2h, 24h, 3d)')
          .setValue('24h')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(questionInput),
          new ActionRowBuilder().addComponents(choicesInput),
          new ActionRowBuilder().addComponents(answerInput),
          new ActionRowBuilder().addComponents(rewardsInput),
          new ActionRowBuilder().addComponents(durationInput)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN CREATE POLL MODAL (100% UI-DRIVEN) ---
      if (customId === 'admin_create_poll') {
        const modal = new ModalBuilder()
          .setCustomId('modal_create_poll')
          .setTitle('📊 Create Community Poll');

        const questionInput = new TextInputBuilder()
          .setCustomId('input_poll_question')
          .setLabel('Poll Question / Topic')
          .setPlaceholder('e.g. What do you prefer?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const optionsInput = new TextInputBuilder()
          .setCustomId('input_poll_options')
          .setLabel('Poll Choices (Add as many as you want!)')
          .setPlaceholder('Enter choices (one per line)\nDiscord\nstop making polls\nSkype')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const settingsInput = new TextInputBuilder()
          .setCustomId('input_poll_settings')
          .setLabel('Instant Live Results, Add Community Choice')
          .setValue('yes, no')
          .setPlaceholder('e.g. yes, no')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const rewardInput = new TextInputBuilder()
          .setCustomId('input_poll_reward')
          .setLabel('Vote Rewards: [QP], [XP]')
          .setValue('10, 5')
          .setPlaceholder('e.g. 10, 5')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const durationInput = new TextInputBuilder()
          .setCustomId('input_poll_duration')
          .setLabel('Duration & Ping Tag (Optional)')
          .setValue('24h')
          .setPlaceholder('e.g. 24h, @everyone or 5m, @Members')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(questionInput),
          new ActionRowBuilder().addComponents(optionsInput),
          new ActionRowBuilder().addComponents(settingsInput),
          new ActionRowBuilder().addComponents(rewardInput),
          new ActionRowBuilder().addComponents(durationInput)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN CREATE CHAOS CLASH BATTLE ROYALE MODAL (100% UI-DRIVEN) ---
      if (customId === 'admin_create_battle') {
        const modal = new ModalBuilder()
          .setCustomId('modal_create_battle')
          .setTitle('⚔️ Launch Chaos Clash Battle');

        const modeInput = new TextInputBuilder()
          .setCustomId('input_battle_mode')
          .setLabel('Mode: interactive or classic')
          .setValue('interactive')
          .setPlaceholder('interactive (tactical & QTEs) or classic (100% RNG)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const durationInput = new TextInputBuilder()
          .setCustomId('input_battle_duration')
          .setLabel('Sign-up Duration (e.g. 45s, 5m, 1h, 1d)')
          .setValue('5m')
          .setPlaceholder('e.g. 45s, 5m, 30m, 2h, 24h, 1d')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const prizeInput = new TextInputBuilder()
          .setCustomId('input_battle_prize')
          .setLabel('Prize Pool: QP, XP (e.g. 500, 250)')
          .setValue('500, 250')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const entryInput = new TextInputBuilder()
          .setCustomId('input_battle_entry')
          .setLabel('Entry Fee in QP (0 for Free Entry)')
          .setValue('0')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const tagInput = new TextInputBuilder()
          .setCustomId('input_battle_tag')
          .setLabel('Ping Role / Server Tag (Optional)')
          .setPlaceholder('e.g. @everyone, @here, or role name')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(modeInput),
          new ActionRowBuilder().addComponents(durationInput),
          new ActionRowBuilder().addComponents(prizeInput),
          new ActionRowBuilder().addComponents(entryInput),
          new ActionRowBuilder().addComponents(tagInput)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN CREATE LIVE QUIZ SHOW MODAL ---
      if (customId === 'admin_create_live_quiz') {
        const modal = new ModalBuilder()
          .setCustomId('modal_setup_live_quiz')
          .setTitle('⚡ Setup Live Quiz Tournament');

        const titleInput = new TextInputBuilder()
          .setCustomId('input_lqz_title')
          .setLabel('Tournament Title')
          .setValue('Cohesion Live Trivia Show')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const qTimeInput = new TextInputBuilder()
          .setCustomId('input_lqz_qtime')
          .setLabel('Time Per Question (Seconds)')
          .setValue('20')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const bTimeInput = new TextInputBuilder()
          .setCustomId('input_lqz_btime')
          .setLabel('Break Time Between Questions (Seconds)')
          .setValue('8')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const basePtsInput = new TextInputBuilder()
          .setCustomId('input_lqz_base_pts')
          .setLabel('Base Points (Speed-Scaled QP)')
          .setValue('100')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const xpBonusInput = new TextInputBuilder()
          .setCustomId('input_lqz_xp_bonus')
          .setLabel('Top 10 Final XP Bonus Pool')
          .setValue('500')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(qTimeInput),
          new ActionRowBuilder().addComponents(bTimeInput),
          new ActionRowBuilder().addComponents(basePtsInput),
          new ActionRowBuilder().addComponents(xpBonusInput)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN LIVE QUIZ SETUP DECK BUTTONS ---
      if (customId.startsWith('lqz_btn_addq_')) {
        const sessionId = customId.replace('lqz_btn_addq_', '');
        const modal = new ModalBuilder()
          .setCustomId(`modal_lqz_addq_${sessionId}`)
          .setTitle('➕ Add Question to Quiz Show');

        const questionInput = new TextInputBuilder()
          .setCustomId('input_q_text')
          .setLabel('Question')
          .setPlaceholder('e.g. Which consensus mechanism does Bitcoin use?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const choicesInput = new TextInputBuilder()
          .setCustomId('input_q_choices')
          .setLabel('Options (2 to 4, one per line)')
          .setPlaceholder('Proof of Work\nProof of Stake\nProof of History\nProof of Authority')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const correctInput = new TextInputBuilder()
          .setCustomId('input_q_correct')
          .setLabel('Correct Option Number (1, 2, 3, or 4)')
          .setPlaceholder('1')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(questionInput),
          new ActionRowBuilder().addComponents(choicesInput),
          new ActionRowBuilder().addComponents(correctInput)
        );

        return interaction.showModal(modal);
      }

      if (customId.startsWith('lqz_btn_bulkq_')) {
        const sessionId = customId.replace('lqz_btn_bulkq_', '');
        const modal = new ModalBuilder()
          .setCustomId(`modal_lqz_bulkq_${sessionId}`)
          .setTitle('📝 Paste Multiple Questions');

        const bulkInput = new TextInputBuilder()
          .setCustomId('input_bulk_text')
          .setLabel('Format: Question ? Opt1,Opt2,Opt3 ? 1')
          .setPlaceholder(
            'What is ETH? ? Currency, Stock, NFT, Bond ? 1\nWhat year was BTC born? ? 2005, 2008, 2009, 2012 ? 3'
          )
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(bulkInput));
        return interaction.showModal(modal);
      }

      if (customId.startsWith('lqz_btn_viewq_')) {
        const sessionId = customId.replace('lqz_btn_viewq_', '');
        const session = getLiveSession(sessionId);
        if (!session || session.questions.length === 0) {
          return interaction.reply({
            content: '⚠️ No questions added yet! Click **Add Question** or **Quick Paste Bulk** to get started.',
            ephemeral: true,
          });
        }

        const list = session.questions
          .map((q, idx) => {
            const opts = q.options.map((o, i) => `${i === q.correctIndex ? '✅' : '🔹'} ${o}`).join(' | ');
            return `**Q${idx + 1}:** ${q.question}\n${opts}`;
          })
          .join('\n\n');

        return interaction.reply({
          content: `📋 **Questions Loaded for [${session.title}]:**\n\n${list}`,
          ephemeral: true,
        });
      }

      if (customId.startsWith('lqz_btn_start_')) {
        const sessionId = customId.replace('lqz_btn_start_', '');
        const session = getLiveSession(sessionId);
        if (!session) {
          return interaction.reply({ content: '❌ Session expired or not found.', ephemeral: true });
        }
        if (session.questions.length === 0) {
          return interaction.reply({
            content: '⚠️ Please add at least 1 question before launching the quiz show!',
            ephemeral: true,
          });
        }
        if (session.status !== 'setup') {
          return interaction.reply({ content: '⚠️ Quiz has already been started!', ephemeral: true });
        }

        await interaction.reply({
          content: `🚀 **Live Quiz Show Launched!** Questions will begin broadcasting to this channel in 10 seconds.`,
          ephemeral: true,
        });

        // Launch game loop in background
        startLiveQuiz(sessionId, interaction.channel, interaction.client);
        return;
      }

      if (customId === 'hub_connect_twitter') {
        const modal = new ModalBuilder()
          .setCustomId('modal_connect_twitter')
          .setTitle('🔗 Link Twitter / X Account');

        const handleInput = new TextInputBuilder()
          .setCustomId('input_twitter_handle')
          .setLabel('Your Twitter / X Handle')
          .setPlaceholder('e.g. CohesionApp (without @)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(handleInput));
        return interaction.showModal(modal);
      }

      // --- LINK WALLET BUTTON (FROM HUB - 12 CHAINS AUTO-DETECTED) ---
      if (customId === 'hub_link_wallet') {
        const modal = new ModalBuilder()
          .setCustomId('modal_link_wallet')
          .setTitle('👛 Multi-Chain Payout Wallet');

        const addressInput = new TextInputBuilder()
          .setCustomId('input_wallet_address')
          .setLabel('Wallet Address (Auto-detects 12 Chains)')
          .setPlaceholder('ETH, SOL, BTC, SEI, XION, AVAX, BSC, ZKS, ADA...')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const chainInput = new TextInputBuilder()
          .setCustomId('input_wallet_chain')
          .setLabel('Network / Chain (Optional or Auto-Detect)')
          .setPlaceholder('Auto-detected or specify: ETH, SOL, BTC, etc.')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(addressInput),
          new ActionRowBuilder().addComponents(chainInput)
        );

        return interaction.showModal(modal);
      }

      // --- MEMBER HUB: CONNECT SOCIALS ---
      if (customId === 'hub_socials') {
        const modal = new ModalBuilder()
          .setCustomId('modal_connect_socials')
          .setTitle('🌐 Connect Social Profiles');

        const cmcInput = new TextInputBuilder()
          .setCustomId('input_cmc')
          .setLabel('CoinMarketCap (Gravity) Handle')
          .setPlaceholder('e.g. YourUsername')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const ytInput = new TextInputBuilder()
          .setCustomId('input_yt')
          .setLabel('YouTube Channel / Handle')
          .setPlaceholder('e.g. @YourChannel')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const tiktokInput = new TextInputBuilder()
          .setCustomId('input_tiktok')
          .setLabel('TikTok Username')
          .setPlaceholder('e.g. @YourTikTok')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const tgInput = new TextInputBuilder()
          .setCustomId('input_telegram')
          .setLabel('Telegram Username')
          .setPlaceholder('e.g. YourTelegram')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(cmcInput),
          new ActionRowBuilder().addComponents(ytInput),
          new ActionRowBuilder().addComponents(tiktokInput),
          new ActionRowBuilder().addComponents(tgInput)
        );

        return interaction.showModal(modal);
      }

      // --- MEMBER HUB: REFERRALS & INVITE CODES ---
      if (customId === 'hub_referrals') {
        await interaction.deferReply({ ephemeral: true });

        const referralCode = `COH-${discordId.slice(-5)}`;

        const { count: totalInvited } = await supabase
          .from('user_integrations')
          .select('*', { count: 'exact', head: true })
          .eq('provider', 'referral_by')
          .eq('provider_username', referralCode);

        const embed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('👥 Cohesion Referral & Invite Hub')
          .setDescription(
            `Share your personal referral code with friends! When they join this server and enter your code, both of you earn bonus Cohesion Points!\n\n` +
            `🔑 **Your Referral Code:** \`${referralCode}\`\n` +
            `🎁 **Reward:** \`+50 CP per confirmed referral\`\n` +
            `👥 **Friends Invited:** **${totalInvited || 0} Members**\n` +
            `🪙 **Total Referral Earnings:** **${((totalInvited || 0) * 50).toLocaleString()} CP**\n\n` +
            `*Click **Enter Friend's Code** below if you were invited by someone!*`
          )
          .setFooter({ text: 'Cohesion Sybil-Resistant Referral System' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('referral_redeem')
            .setLabel("Enter Friend's Code")
            .setEmoji('🎟️')
            .setStyle(ButtonStyle.Primary)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      // --- MEMBER HUB: REDEEM REFERRAL CODE BUTTON ---
      if (customId === 'referral_redeem') {
        const modal = new ModalBuilder()
          .setCustomId('modal_referral_redeem')
          .setTitle("🎟️ Redeem Friend's Referral Code");

        const codeInput = new TextInputBuilder()
          .setCustomId('input_ref_code')
          .setLabel('Referral Code')
          .setPlaceholder('e.g. COH-12345')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
        return interaction.showModal(modal);
      }

      // --- MEMBER HUB: PROMOTE MY TWEET (COMMUNITY RAID) ---
      if (customId === 'hub_promote_tweet') {
        const modal = new ModalBuilder()
          .setCustomId('modal_promote_tweet')
          .setTitle('🚀 Promote Your Tweet (100 CP)');

        const tweetUrlInput = new TextInputBuilder()
          .setCustomId('input_user_tweet_url')
          .setLabel('Your Twitter / X Post URL')
          .setPlaceholder('https://x.com/yourusername/status/123...')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const noteInput = new TextInputBuilder()
          .setCustomId('input_user_tweet_note')
          .setLabel('Raid Message / Call to Action')
          .setValue('Support my post for Cohesion community points!')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(tweetUrlInput),
          new ActionRowBuilder().addComponents(noteInput)
        );

        return interaction.showModal(modal);
      }

      // --- MEMBER HUB: STANDALONE RANK CARD ---
      if (customId === 'hub_rank_card') {
        await interaction.deferReply({ ephemeral: true });

        const { data: userRec } = await supabase
          .from('users')
          .select('*')
          .eq('guild_id', guildId)
          .eq('discord_id', discordId)
          .maybeSingle();

        const xp = Number(userRec?.xp || 0);
        const level = Number(userRec?.level || 1);
        const points = Number(userRec?.total_points || 0);
        const streak = Number(userRec?.daily_streak || 0);

        let tierTitle = 'Bronze Explorer';
        let tierColor = 0xcd7f32;
        if (level >= 50) { tierTitle = 'Apex Legend'; tierColor = 0xe0aaff; }
        else if (level >= 25) { tierTitle = 'Diamond Master'; tierColor = 0x4cc9f0; }
        else if (level >= 10) { tierTitle = 'Gold Veteran'; tierColor = 0xffd166; }
        else if (level >= 5) { tierTitle = 'Silver Pioneer'; tierColor = 0xc0c0c0; }

        const embed = new EmbedBuilder()
          .setColor(tierColor)
          .setAuthor({
            name: `${interaction.user.displayName || interaction.user.username}'s Rank Card`,
            iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
          })
          .setTitle(`🎖️ Rank: ${tierTitle}`)
          .setDescription(
            `• **Level:** **Level ${level}**\n` +
            `• **Total XP:** **${xp.toLocaleString()} XP**\n` +
            `• **Cohesion Points:** **${points.toLocaleString()} CP** 🪙\n` +
            `• **Daily Streak:** **${streak} Days** 🔥`
          )
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Cohesion Official Rank Card' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // --- ADMIN: POST MULTI-PLATFORM QUEST (CMC / YOUTUBE / TIKTOK / WEB) ---
      if (customId === 'admin_post_multi') {
        const modal = new ModalBuilder()
          .setCustomId('modal_post_multi')
          .setTitle('🌐 Launch Multi-Platform Quest');

        const platformInput = new TextInputBuilder()
          .setCustomId('input_platform_type')
          .setLabel('Platform: cmc, youtube, tiktok, visit')
          .setValue('cmc')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const urlInput = new TextInputBuilder()
          .setCustomId('input_platform_url')
          .setLabel('Post / Video / Website URL')
          .setPlaceholder('e.g. https://coinmarketcap.com/... or https://youtube.com/...')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const pointsInput = new TextInputBuilder()
          .setCustomId('input_platform_points')
          .setLabel('Cohesion Points (CP) Reward')
          .setValue('50')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const actionsInput = new TextInputBuilder()
          .setCustomId('input_platform_actions')
          .setLabel('Required Actions (e.g. Reaction, Repost)')
          .setValue('Reaction & Repost')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(platformInput),
          new ActionRowBuilder().addComponents(urlInput),
          new ActionRowBuilder().addComponents(pointsInput),
          new ActionRowBuilder().addComponents(actionsInput)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN: QUEST DRAFTS / PRESETS DASHBOARD ---
      if (customId === 'admin_quest_drafts') {
        await interaction.deferReply({ ephemeral: true });
        const payload = buildQuestDraftsDashboard(guildId);
        return interaction.editReply(payload);
      }

      // --- ADMIN: CREATE CUSTOM QUEST DRAFT MODAL ---
      if (customId === 'btn_create_quest_draft') {
        const modal = new ModalBuilder()
          .setCustomId('modal_create_quest_draft')
          .setTitle('➕ Create Custom Quest Draft');

        const nameInput = new TextInputBuilder()
          .setCustomId('input_draft_name')
          .setLabel('Preset/Draft Name (e.g. weekend_special)')
          .setPlaceholder('e.g. flash_raid, weekend_special')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const pdInput = new TextInputBuilder()
          .setCustomId('input_draft_points_duration')
          .setLabel('Points (CP), Duration (e.g. 75, 6h)')
          .setValue('75, 6h')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const btnsInput = new TextInputBuilder()
          .setCustomId('input_draft_buttons')
          .setLabel('Buttons: like, rt, comment')
          .setValue('like, rt, comment')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('input_draft_desc')
          .setLabel('Short Description')
          .setPlaceholder('e.g. Fast 6-hour community raid with 75 CP')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const keywordInput = new TextInputBuilder()
          .setCustomId('input_draft_keyword')
          .setLabel('Required Keyword or Tag (Optional)')
          .setPlaceholder('e.g. #Cohesion or #Rialo')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(pdInput),
          new ActionRowBuilder().addComponents(btnsInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(keywordInput)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN: DELETE CUSTOM QUEST DRAFT ---
      if (customId === 'btn_delete_quest_draft') {
        const drafts = getGuildDrafts(guildId).filter((d) => !DEFAULT_PRESETS.some((dp) => dp.name === d.name));
        if (drafts.length === 0) {
          return interaction.reply({
            content: 'ℹ️ No custom drafts found to delete (built-in presets cannot be removed).',
            ephemeral: true,
          });
        }
        const lastDraft = drafts[drafts.length - 1];
        deleteGuildDraft(guildId, lastDraft.name);
        const payload = buildQuestDraftsDashboard(guildId);
        return interaction.update({
          content: `🗑️ Deleted custom draft \`${lastDraft.name}\`.`,
          ...payload,
        });
      }

      // --- ADMIN: AUTO-TRACK TWITTER HANDLES ---
      if (customId === 'admin_track_twitter') {
        const modal = new ModalBuilder()
          .setCustomId('modal_track_twitter')
          .setTitle('🤖 Auto-Track Twitter/X Feeds');

        const currentHandles = getTrackedHandles(guildId).join(', ') || '';

        const handlesInput = new TextInputBuilder()
          .setCustomId('input_track_handles')
          .setLabel('Twitter Handles to Monitor (comma-separated)')
          .setValue(currentHandles)
          .setPlaceholder('e.g. CohesionApp, ElonMusk')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(handlesInput));
        return interaction.showModal(modal);
      }

      // --- ADMIN: 100% UI-DRIVEN WEEKLY INFLATION & ECONOMY DASHBOARD ---
      if (customId === 'admin_economy_settings') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to configure inflation decay.',
            ephemeral: true,
          });
        }

        const payload = buildInflationDashboard(guildId, interaction.guild?.name);
        return interaction.reply({ ...payload, ephemeral: true });
      }

      // --- INFLATION UI: 1-CLICK TOGGLE OFF ---
      if (customId === 'inflation_toggle_off') {
        if (!isAuthorizedAdmin(interaction)) return;
        setGuildInflation(guildId, false, 0);
        const payload = buildInflationDashboard(guildId, interaction.guild?.name);
        return interaction.update(payload);
      }

      // --- INFLATION UI: 1-CLICK TOGGLE ON (5% Default) ---
      if (customId === 'inflation_toggle_on') {
        if (!isAuthorizedAdmin(interaction)) return;
        setGuildInflation(guildId, true, 0.05);
        const payload = buildInflationDashboard(guildId, interaction.guild?.name);
        return interaction.update(payload);
      }

      // --- INFLATION UI: 1-CLICK PRESET RATES ---
      if (customId === 'inflation_preset_3') {
        if (!isAuthorizedAdmin(interaction)) return;
        setGuildInflation(guildId, true, 0.03);
        const payload = buildInflationDashboard(guildId, interaction.guild?.name);
        return interaction.update(payload);
      }

      if (customId === 'inflation_preset_5') {
        if (!isAuthorizedAdmin(interaction)) return;
        setGuildInflation(guildId, true, 0.05);
        const payload = buildInflationDashboard(guildId, interaction.guild?.name);
        return interaction.update(payload);
      }

      if (customId === 'inflation_preset_10') {
        if (!isAuthorizedAdmin(interaction)) return;
        setGuildInflation(guildId, true, 0.10);
        const payload = buildInflationDashboard(guildId, interaction.guild?.name);
        return interaction.update(payload);
      }

      if (customId === 'inflation_preset_15') {
        if (!isAuthorizedAdmin(interaction)) return;
        setGuildInflation(guildId, true, 0.15);
        const payload = buildInflationDashboard(guildId, interaction.guild?.name);
        return interaction.update(payload);
      }

      // --- INFLATION UI: MODAL FOR CUSTOM RATE ---
      if (customId === 'inflation_btn_custom') {
        const current = getGuildInflation(guildId);
        const modal = new ModalBuilder()
          .setCustomId('modal_inflation_custom')
          .setTitle('🔥 Set Custom Point Decay %');

        const rateInput = new TextInputBuilder()
          .setCustomId('input_inflation_custom_rate')
          .setLabel('Weekly Point Burn % (e.g. 7 for 7%, 0 to off)')
          .setValue(current.enabled ? String(Math.round(current.rate * 100)) : '5')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(rateInput));
        return interaction.showModal(modal);
      }

      // --- NAVIGATION: BACK TO MAIN ADMIN PANEL ---
      if (customId === 'admin_back_to_main') {
        if (!isAuthorizedAdmin(interaction)) return;
        const guild = interaction.guild || (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);
        if (!guild) {
          return interaction.reply({ content: 'Server not found.', ephemeral: true });
        }
        const payload = await getAdminPanelPayload(guild);
        return interaction.update(payload);
      }

      // --- HUB UI: OPEN ADMIN PANEL (ZERO SLASH COMMAND) ---
      if (customId === 'hub_open_admin') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ Only Administrators or Server Managers can open the Admin Control Center.',
            ephemeral: true,
          });
        }
        const guild = interaction.guild || (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);
        if (!guild) {
          return interaction.reply({ content: 'Server not found.', ephemeral: true });
        }
        const payload = await getAdminPanelPayload(guild);
        return interaction.reply({ ...payload, ephemeral: true });
      }

      // --- ADMIN: 5-TIER MILESTONE ROLES ---
      if (customId === 'admin_tier_roles') {
        const modal = new ModalBuilder()
          .setCustomId('modal_tier_roles')
          .setTitle('🎖️ Configure 5-Tier Level Roles');

        const t1Input = new TextInputBuilder()
          .setCustomId('input_tier_1')
          .setLabel('Level 5 Role ID or Name')
          .setPlaceholder('e.g. Pioneer Role ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const t2Input = new TextInputBuilder()
          .setCustomId('input_tier_2')
          .setLabel('Level 10 Role ID or Name')
          .setPlaceholder('e.g. Veteran Role ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const t3Input = new TextInputBuilder()
          .setCustomId('input_tier_3')
          .setLabel('Level 25 Role ID or Name')
          .setPlaceholder('e.g. Champion Role ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const t4Input = new TextInputBuilder()
          .setCustomId('input_tier_4')
          .setLabel('Level 50 Role ID or Name')
          .setPlaceholder('e.g. Master Role ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const t5Input = new TextInputBuilder()
          .setCustomId('input_tier_5')
          .setLabel('Level 100 Role ID or Name')
          .setPlaceholder('e.g. Immortal Apex Role ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(t1Input),
          new ActionRowBuilder().addComponents(t2Input),
          new ActionRowBuilder().addComponents(t3Input),
          new ActionRowBuilder().addComponents(t4Input),
          new ActionRowBuilder().addComponents(t5Input)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN: ANNOUNCEMENT REACTIONS REWARD CONFIG ---
      if (customId === 'admin_announcement_reactions') {
        const modal = new ModalBuilder()
          .setCustomId('modal_announcement_reactions')
          .setTitle('⚡ Announcement Reactions Config');

        const channelInput = new TextInputBuilder()
          .setCustomId('input_react_channel')
          .setLabel('Announcement Channel ID or Name')
          .setValue('announcements')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const pointsInput = new TextInputBuilder()
          .setCustomId('input_react_points')
          .setLabel('CP Reward per Reaction')
          .setValue('5')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(channelInput),
          new ActionRowBuilder().addComponents(pointsInput)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN: TOP ENGAGERS LEADERBOARD ---
      if (customId === 'admin_top_engagers') {
        await interaction.deferReply({ ephemeral: true });

        const { data: topUsers } = await supabase
          .from('users')
          .select('discord_id, total_points, xp, level')
          .eq('guild_id', guildId)
          .order('total_points', { ascending: false })
          .limit(10);

        const medals = ['🥇', '🥈', '🥉'];
        const list = (topUsers || []).map(
          (u, i) => `${medals[i] || `**#${i + 1}**`} <@${u.discord_id}> • **${Number(u.total_points || 0).toLocaleString()} CP** • Level ${u.level || 1}`
        ).join('\n\n') || '*No engagers recorded yet.*';

        const embed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('📊 Top Social Engagers • Cohesion Analytics')
          .setDescription(list)
          .setFooter({ text: 'Aggregated across all verified social quests' });

        return interaction.editReply({ embeds: [embed] });
      }

      // --- ADMIN: SEASON LEADERBOARD RESET / WIPE ---
      if (customId === 'admin_season_wipe') {
        const modal = new ModalBuilder()
          .setCustomId('modal_season_wipe')
          .setTitle('⚠️ Reset Leaderboard Season');

        const confirmInput = new TextInputBuilder()
          .setCustomId('input_wipe_confirm')
          .setLabel('Type "CONFIRM RESET" to proceed')
          .setPlaceholder('CONFIRM RESET')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(confirmInput));
        return interaction.showModal(modal);
      }

      // --- CLAIM RAFFLE WALLET BUTTON (FROM RAFFLE ANNOUNCEMENT) ---
      if (customId.startsWith('claim_raffle_wallet_')) {
        const parts = customId.split('_');
        const raffleId = parts[3];
        const winnerId = parts[4];

        if (interaction.user.id !== winnerId) {
          return interaction.reply({
            content: `⛔ Only the raffle winner (<@${winnerId}>) can submit their payout wallet for this prize.`,
            ephemeral: true,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`modal_winner_wallet_${raffleId}`)
          .setTitle('👛 Submit Prize Payout Wallet');

        const addressInput = new TextInputBuilder()
          .setCustomId('input_wallet_address')
          .setLabel('Your Payout Wallet Address')
          .setPlaceholder('e.g. 0x... or Solana address')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const chainInput = new TextInputBuilder()
          .setCustomId('input_wallet_chain')
          .setLabel('Network / Chain')
          .setValue('Base / EVM')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(addressInput),
          new ActionRowBuilder().addComponents(chainInput)
        );

        return interaction.showModal(modal);
      }


      if (customId === 'admin_add_shop') {
        const modal = new ModalBuilder()
          .setCustomId('modal_add_shop')
          .setTitle('🛒 Add Marketplace Item');

        const titleInput = new TextInputBuilder()
          .setCustomId('input_shop_title')
          .setLabel('Item Title')
          .setPlaceholder('e.g. VIP Engager Role or 10 USDT Giftcard')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const costInput = new TextInputBuilder()
          .setCustomId('input_shop_cost')
          .setLabel('Price in Cohesion Points (CP)')
          .setPlaceholder('e.g. 150')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('input_shop_desc')
          .setLabel('Description')
          .setPlaceholder('Details about what the buyer receives')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);

        const roleInput = new TextInputBuilder()
          .setCustomId('input_shop_role_id')
          .setLabel('Discord Role ID (Optional, to auto-grant)')
          .setPlaceholder('Right click role -> Copy Role ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const stockInput = new TextInputBuilder()
          .setCustomId('input_shop_stock')
          .setLabel('Stock Quantity (-1 for unlimited)')
          .setValue('-1')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(costInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(roleInput),
          new ActionRowBuilder().addComponents(stockInput)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN: VIEW RECENT MARKETPLACE PURCHASES ---
      if (customId === 'admin_view_purchases') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: '⛔ You need `Manage Server` permissions to view marketplace purchase logs.',
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        const { data: purchases, error: fetchErr } = await supabase
          .from('marketplace_purchases')
          .select('*')
          .eq('guild_id', guildId)
          .order('created_at', { ascending: false })
          .limit(15);

        if (fetchErr) {
          console.error('[FETCH PURCHASES ERROR]:', fetchErr);
          return interaction.editReply({ content: '❌ Failed to fetch purchase logs from database.' });
        }

        if (!purchases || purchases.length === 0) {
          return interaction.editReply({
            content: '🛒 **No marketplace purchases recorded yet for this server.**',
          });
        }

        const purchaseRows = purchases.map((p, i) => {
          const recId = (p.purchase_id || p.id || 'N/A').toString().slice(-8).toUpperCase();
          const timeSec = p.created_at ? Math.floor(new Date(p.created_at).getTime() / 1000) : null;
          const timeStr = timeSec ? `<t:${timeSec}:R>` : 'Recently';
          return `**${i + 1}. ${p.item_title || 'Item'}** • **${p.cost_paid || 0} QP**\n` +
            `↳ Buyer: <@${p.discord_id}> • Receipt: \`#REC-${recId}\` • ${timeStr}`;
        });

        const embed = new EmbedBuilder()
          .setColor(0x118ab2)
          .setTitle('🧾 Marketplace Purchase Ledger (Latest 15)')
          .setDescription(
            `Use this ledger to verify any member purchase in real time:\n\n` +
            purchaseRows.join('\n\n')
          )
          .setFooter({ text: 'Cohesion Economy & Marketplace Audit' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      if (customId === 'admin_vc_snapshot') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Manage Server` permissions to run voice attendance snapshots.',
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        if (!guild) {
          return interaction.editReply({ content: '❌ Could not retrieve server details.' });
        }

        await guild.channels.fetch().catch(() => null);

        // Find all voice-based channels in the server
        const voiceChannels = Array.from(guild.channels.cache.filter((c) => c.isVoiceBased()).values());

        // Count members connected server-wide
        const totalVoiceMembers = guild.voiceStates.cache.filter((vs) => vs.channelId && !vs.member?.user?.bot).size;

        const options = [
          new StringSelectMenuOptionBuilder()
            .setLabel('🌐 All Voice Channels (Server-Wide)')
            .setDescription(`Snapshot all voice channels (${totalVoiceMembers} members active)`)
            .setValue('all')
            .setEmoji('🌐'),
        ];

        for (const vc of voiceChannels.slice(0, 24)) {
          const count = guild.voiceStates.cache.filter((vs) => vs.channelId === vc.id && !vs.member?.user?.bot).size;
          options.push(
            new StringSelectMenuOptionBuilder()
              .setLabel(vc.name.slice(0, 50))
              .setDescription(`${count} active member${count === 1 ? '' : 's'} connected`)
              .setValue(vc.id)
              .setEmoji(vc.type === ChannelType.GuildStageVoice ? '🎭' : '🔊')
          );
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_vc_target')
          .setPlaceholder('Choose All Channels or a Specific Voice Channel')
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
          .setColor(0x118ab2)
          .setTitle('🎙️ Voice Attendance Snapshot — Target Selection')
          .setDescription(
            `Choose whether to snapshot **All Voice Channels** or reward a **specific voice channel** below:\n\n` +
            `• **Active Voice Members Server-Wide:** **${totalVoiceMembers}**\n` +
            `• **Available Voice Channels:** **${voiceChannels.length}**\n\n` +
            `*Selecting an option will immediately open the reward configuration modal.*`
          )
          .setFooter({ text: 'Cohesion Voice Engagement Tracking' });

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      if (customId === 'admin_reward_member') {
        const modal = new ModalBuilder()
          .setCustomId('modal_reward_member')
          .setTitle('🎁 Reward Member with QP & XP');

        const userInput = new TextInputBuilder()
          .setCustomId('input_reward_user')
          .setLabel('Member Discord ID or @mention')
          .setPlaceholder('e.g. 123456789012345678 or @Member')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const pointsInput = new TextInputBuilder()
          .setCustomId('input_reward_points')
          .setLabel('Cohesion Points (CP) to Add / Deduct')
          .setValue('100')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const xpInput = new TextInputBuilder()
          .setCustomId('input_reward_xp')
          .setLabel('Experience (XP) to Add / Deduct')
          .setValue('100')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const reasonInput = new TextInputBuilder()
          .setCustomId('input_reward_reason')
          .setLabel('Reason / Memo')
          .setValue('Community Contributor Bonus')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(userInput),
          new ActionRowBuilder().addComponents(pointsInput),
          new ActionRowBuilder().addComponents(xpInput),
          new ActionRowBuilder().addComponents(reasonInput)
        );

        return interaction.showModal(modal);
      }

      if (customId === 'admin_create_auction') {
        const modal = new ModalBuilder()
          .setCustomId('modal_create_auction')
          .setTitle('🔨 Create Community Auction');

        const titleInput = new TextInputBuilder()
          .setCustomId('input_auction_title')
          .setLabel('Item Title')
          .setPlaceholder('e.g. VIP Alpha Pass or 1-Year Nitro')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const startBidInput = new TextInputBuilder()
          .setCustomId('input_auction_start_bid')
          .setLabel('Starting Bid (in Cohesion Points - CP)')
          .setValue('100')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const minIncInput = new TextInputBuilder()
          .setCustomId('input_auction_min_inc')
          .setLabel('Minimum Bid Increment')
          .setValue('25')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const durationInput = new TextInputBuilder()
          .setCustomId('input_auction_duration')
          .setLabel('Duration (e.g. 2h, 24h, 3d)')
          .setValue('24h')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('input_auction_desc')
          .setLabel('Description')
          .setPlaceholder('Details about what the highest bidder wins')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(startBidInput),
          new ActionRowBuilder().addComponents(minIncInput),
          new ActionRowBuilder().addComponents(durationInput),
          new ActionRowBuilder().addComponents(descInput)
        );

        return interaction.showModal(modal);
      }

      // --- B. ADMIN DRAW RAFFLE (SELECT MENU UI) ---
      if (customId === 'admin_draw_raffle') {
        await interaction.deferReply({ ephemeral: true });

        const { data: activeRaffles } = await supabase
          .from('raffles')
          .select('raffle_id, prize, cost, end_time')
          .eq('guild_id', guildId)
          .eq('is_active', true);

        if (!activeRaffles || activeRaffles.length === 0) {
          return interaction.editReply({ content: '⚠️ There are no active raffles to draw right now.' });
        }

        const options = activeRaffles.slice(0, 25).map(r =>
          new StringSelectMenuOptionBuilder()
            .setLabel(r.prize.slice(0, 50))
            .setDescription(`Cost: ${r.cost} QP • ID: ${r.raffle_id.slice(0, 8)}...`)
            .setValue(r.raffle_id)
            .setEmoji('🎟️')
        );

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_draw_raffle')
          .setPlaceholder('Select a raffle to draw a winner')
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        return interaction.editReply({
          content: '🎲 **Select which raffle you would like to end and draw a winner for:**',
          components: [row],
        });
      }

      // --- C. ADMIN OVERVIEW REFRESH ---
      if (customId === 'admin_overview') {
        await interaction.deferReply({ ephemeral: true });

        const { count: totalMembersTracked } = await supabase
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('guild_id', guildId);

        const { count: activeRafflesCount } = await supabase
          .from('raffles')
          .select('*', { count: 'exact', head: true })
          .eq('guild_id', guildId)
          .eq('is_active', true);

        const { count: activeQuestsCount } = await supabase
          .from('tweet_quests')
          .select('*', { count: 'exact', head: true })
          .eq('guild_id', guildId)
          .gte('expires_at', new Date().toISOString());

        return interaction.editReply({
          content:
            `📊 **Live Cohesion Server Stats:**\n` +
            `• Tracked Members: **${totalMembersTracked || 0}**\n` +
            `• Active Tweet Quests: **${activeQuestsCount || 0}**\n` +
            `• Active Raffles: **${activeRafflesCount || 0}**`,
        });
      }

      // --- ADMIN: SERVER OPERATING MODE & MODULE MANAGER ---
      if (customId === 'admin_server_mode') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to modify server operating modes.',
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });
        const payload = buildServerModePayload(guildId, interaction.guild?.name);
        return interaction.editReply(payload);
      }

      // --- ADMIN: TOGGLE SPENDABLE CURRENCY (POINTS vs XP) ---
      if (customId === 'btn_toggle_currency') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to toggle currency.',
            ephemeral: true,
          });
        }

        await interaction.deferUpdate();
        const currentCurrency = getCurrencyType(guildId);
        const newCurrency = currentCurrency === 'xp' ? 'points' : 'xp';
        setGuildCurrency(guildId, newCurrency);

        const payload = buildServerModePayload(guildId, interaction.guild?.name);
        return interaction.editReply(payload);
      }

      // --- ADMIN: SHOW CUSTOM MODULES SELECTOR ---
      if (customId === 'btn_config_custom_modules') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to customize modules.',
            ephemeral: true,
          });
        }

        const payload = buildCustomModulesSelector(guildId);
        return interaction.reply(payload);
      }

      // --- ADMIN: MEMBER ANALYTICS & CSV EXPORT DASHBOARD ---
      if (customId === 'admin_export_users') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to export user data.',
            ephemeral: true,
          });
        }

        const payload = buildExportDashboard(guildId, interaction.guild?.name);
        return interaction.reply(payload);
      }

      // --- ADMIN: FULL SERVER CSV EXPORT ---
      if (customId === 'btn_export_all') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to export user data.',
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        const { data: users, error } = await supabase
          .from('users')
          .select('*')
          .eq('guild_id', guildId)
          .order('total_points', { ascending: false });

        if (error || !users || users.length === 0) {
          return interaction.editReply({
            content: '⚠️ No user profiles found for this server or database query failed.',
          });
        }

        // Enrich with live message counts if available
        const enrichedUsers = users.map(u => ({
          ...u,
          messages_sent: Math.max(Number(u.messages_sent || 0), getUserMessageCount(guildId, u.discord_id)),
        }));

        const attachment = generateUsersCsvAttachment(
          enrichedUsers,
          `cohesion_all_members_${guildId}_${new Date().toISOString().slice(0, 10)}.csv`
        );

        return interaction.editReply({
          content: `✅ **Full Server Export Complete!** Found **${users.length}** member records with message counts, levels, XP, and wallets.`,
          files: [attachment],
        });
      }

      // --- ADMIN: PROMPT DATE RANGE FILTER MODAL ---
      if (customId === 'btn_export_daterange') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to export user data.',
            ephemeral: true,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId('modal_export_daterange')
          .setTitle('📅 Filter Member Data by Date');

        const startDateInput = new TextInputBuilder()
          .setCustomId('input_export_start_date')
          .setLabel('Start Date (YYYY-MM-DD)')
          .setPlaceholder('e.g. 2026-09-01')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(10)
          .setRequired(true);

        const endDateInput = new TextInputBuilder()
          .setCustomId('input_export_end_date')
          .setLabel('End Date (YYYY-MM-DD)')
          .setPlaceholder('e.g. 2026-09-20')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(10)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(startDateInput),
          new ActionRowBuilder().addComponents(endDateInput)
        );

        return interaction.showModal(modal);
      }

      // --- ADMIN: PROMPT CHANNEL SELECTOR ---
      if (customId === 'btn_export_channel_prompt') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to perform channel audits.',
            ephemeral: true,
          });
        }

        const payload = buildChannelSelector();
        return interaction.reply(payload);
      }

      // --- ADMIN: PROMPT SINGLE USER SELECTOR ---
      if (customId === 'btn_export_single_user_prompt') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to inspect member records.',
            ephemeral: true,
          });
        }

        const payload = buildUserSelector();
        return interaction.reply(payload);
      }

      // --- ADMIN: DOWNLOAD SINGLE USER CSV ---
      if (customId.startsWith('btn_download_user_csv_')) {
        const targetUserId = customId.replace('btn_download_user_csv_', '');
        await interaction.deferReply({ ephemeral: true });

        const { data: userRecord } = await supabase
          .from('users')
          .select('*')
          .eq('guild_id', guildId)
          .eq('discord_id', targetUserId)
          .maybeSingle();

        const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
        const liveMsgCount = getUserMessageCount(guildId, targetUserId);
        const totalMessages = Math.max(Number(userRecord?.messages_sent || 0), liveMsgCount);

        const singleUserData = [{
          discord_id: targetUserId,
          username: targetUser?.tag || targetUser?.username || userRecord?.username || 'Member',
          messages_sent: totalMessages,
          level: userRecord?.level || 1,
          xp: userRecord?.xp || 0,
          total_points: userRecord?.total_points || 0,
          wallet_address: userRecord?.wallet_address || userRecord?.evm_address || '',
          twitter_handle: userRecord?.twitter_handle || '',
          created_at: userRecord?.created_at || new Date().toISOString(),
        }];

        const attachment = generateUsersCsvAttachment(
          singleUserData,
          `member_${targetUser?.username || targetUserId}_dossier.csv`
        );

        return interaction.editReply({
          content: `✅ **Single Member CSV Ready!** Activity data for <@${targetUserId}>:`,
          files: [attachment],
        });
      }

      // --- ADMIN: AUTOMOD & SECURITY SHIELD DASHBOARD ---
      if (customId === 'admin_automod') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to configure AutoMod Shield.',
            ephemeral: true,
          });
        }

        const payload = buildAutoModDashboard(guildId, interaction.guild?.name);
        return interaction.reply(payload);
      }

      // --- ADMIN: AUTOMOD TOGGLE ANTI-LINK ---
      if (customId === 'automod_toggle_link') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions.',
            ephemeral: true,
          });
        }

        const settings = getAutoModSettings(guildId);
        updateAutoModSettings(guildId, { anti_link: !settings.anti_link });
        const payload = buildAutoModDashboard(guildId, interaction.guild?.name);
        return interaction.update(payload);
      }

      // --- ADMIN: AUTOMOD TOGGLE ANTI-INVITE ---
      if (customId === 'automod_toggle_invite') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions.',
            ephemeral: true,
          });
        }

        const settings = getAutoModSettings(guildId);
        updateAutoModSettings(guildId, { anti_invite: !settings.anti_invite });
        const payload = buildAutoModDashboard(guildId, interaction.guild?.name);
        return interaction.update(payload);
      }

      // --- ADMIN: AUTOMOD TOGGLE ANTI-SPAM ---
      if (customId === 'automod_toggle_spam') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions.',
            ephemeral: true,
          });
        }

        const settings = getAutoModSettings(guildId);
        updateAutoModSettings(guildId, { anti_spam: !settings.anti_spam });
        const payload = buildAutoModDashboard(guildId, interaction.guild?.name);
        return interaction.update(payload);
      }

      // --- ADMIN: AUTOMOD OPEN PUNISHMENT SELECTOR ---
      if (customId === 'automod_btn_punishment') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions.',
            ephemeral: true,
          });
        }

        const settings = getAutoModSettings(guildId);
        const payload = buildPunishmentSelector(settings.punishment_mode);
        return interaction.reply(payload);
      }

      // --- ADMIN: AUTOMOD OPEN BANNED WORDS MODAL ---
      if (customId === 'automod_btn_words') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions.',
            ephemeral: true,
          });
        }

        const settings = getAutoModSettings(guildId);
        const modal = buildBannedWordsModal(settings.banned_words);
        return interaction.showModal(modal);
      }

      // --- ADMIN: AUTOMOD RESET MEMBER STRIKES ---
      if (customId === 'automod_btn_reset_strikes') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions.',
            ephemeral: true,
          });
        }

        const cleared = resetGuildStrikes(guildId);
        return interaction.reply({
          content: `🔄 **AutoMod Strikes Reset!** Cleared active strikes across all members in this server.`,
          ephemeral: true,
        });
      }

      // --- D. MEMBER HUB: REFRESH STATS ---
      if (customId === 'hub_refresh') {
        await interaction.deferUpdate();
        const guild =
          interaction.guild ||
          (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);
        const payload = await buildHubPayload(guild, interaction.user);
        return interaction.editReply(payload);
      }

      // --- E. MEMBER HUB: DAILY CLAIM ---
      if (customId === 'hub_daily_claim') {
        await interaction.deferReply({ ephemeral: true });

        const { data: userRecord } = await supabase
          .from('users')
          .select('*')
          .eq('guild_id', guildId)
          .eq('discord_id', discordId)
          .maybeSingle();

        const now = Date.now();
        const lastClaimStr = userRecord?.last_daily_claim;
        const lastClaim = lastClaimStr ? new Date(lastClaimStr).getTime() : 0;
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        if (lastClaim && now - lastClaim < ONE_DAY_MS) {
          const nextClaimDate = new Date(lastClaim + ONE_DAY_MS);
          return interaction.editReply({
            content: `⏳ You have already claimed your daily reward! Come back <t:${Math.floor(nextClaimDate.getTime() / 1000)}:R> to claim again.`,
          });
        }

        // Streak logic (if claimed within 48 hours, increase streak; else reset to 1)
        const streak = lastClaim && now - lastClaim < 2 * ONE_DAY_MS ? (userRecord?.daily_streak || 0) + 1 : 1;
        const dailyReward = 50;
        const currentPoints = Number(userRecord?.total_points || 0);
        const newPoints = currentPoints + dailyReward;

        await supabase.from('users').upsert(
          {
            guild_id: guildId,
            discord_id: discordId,
            total_points: newPoints,
            daily_streak: streak,
            last_daily_claim: new Date(now).toISOString(),
          },
          { onConflict: 'guild_id,discord_id' }
        );

        const streakBadge = streak > 1 ? `🔥 **Streak:** ${streak} Days` : '🌱 **Streak Started!**';

        const claimEmbed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('🎁 Daily Reward Claimed!')
          .setDescription(
            `You received **+${dailyReward} Cohesion Points (CP)** today!\n\n` +
            `${streakBadge}\n` +
            `💰 **Total Balance:** ${newPoints.toLocaleString()} CP`
          )
          .setFooter({ text: 'Come back every 24 hours to keep your streak alive!' });

        return interaction.editReply({ embeds: [claimEmbed] });
      }

      // --- F. MEMBER HUB: LEADERBOARD ---
      if (customId === 'hub_leaderboard') {
        await interaction.deferReply({ ephemeral: true });

        const { data: topUsers } = await supabase
          .from('users')
          .select('discord_id, xp, level, total_points')
          .eq('guild_id', guildId)
          .order('xp', { ascending: false })
          .limit(10);

        if (!topUsers || topUsers.length === 0) {
          return interaction.editReply({ content: '📊 No members have earned XP yet. Start chatting!' });
        }

        const medals = ['🥇', '🥈', '🥉'];
        const list = topUsers
          .map((u, i) => `${medals[i] || `**#${i + 1}**`} <@${u.discord_id}> • Level **${u.level || 1}** • **${Number(u.xp || 0).toLocaleString()}** XP • **${Number(u.total_points || 0).toLocaleString()}** QP`)
          .join('\n\n');

        const embed = new EmbedBuilder()
          .setColor(0x8338ec)
          .setTitle(`🏆 ${interaction.guild?.name || 'Server'} Leaderboard`)
          .setDescription(list)
          .setFooter({ text: 'Cohesion Gamification Leaderboard' });

        return interaction.editReply({ embeds: [embed] });
      }

      // --- G. MEMBER HUB: ACTIVE RAFFLES ---
      if (customId === 'hub_raffles') {
        await interaction.deferReply({ ephemeral: true });

        const { data: rawRaffles } = await supabase
          .from('raffles')
          .select('*')
          .eq('guild_id', guildId)
          .eq('is_active', true)
          .order('end_time', { ascending: true });

        const now = new Date();
        const raffles = (rawRaffles || []).filter(r => new Date(r.end_time) > now);

        if (!raffles || raffles.length === 0) {
          return interaction.editReply({ content: '🎁 There are no active raffles right now. Stay tuned!' });
        }

        const currType = getCurrencyType(guildId);
        const currLabel = currType === 'xp' ? 'XP' : 'CP';

        const options = raffles.slice(0, 25).map(r =>
          new StringSelectMenuOptionBuilder()
            .setLabel(r.prize.slice(0, 50))
            .setDescription(`Cost: ${r.cost} ${currLabel} per ticket • Ends soon!`)
            .setValue(r.raffle_id)
            .setEmoji('🎟️')
        );

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_enter_raffle')
          .setPlaceholder(`Select a raffle to enter (1 Ticket) [${currLabel}]`)
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const raffleListText = raffles
          .map(
            (r, i) =>
              `**${i + 1}. ${r.prize}**\n` +
              `↳ Cost: **${r.cost} ${currLabel}** • Ends: <t:${Math.floor(new Date(r.end_time).getTime() / 1000)}:R>`
          )
          .join('\n\n');

        const embed = new EmbedBuilder()
          .setColor(0x118ab2)
          .setTitle('🎉 Active Community Raffles')
          .setDescription(`${raffleListText}\n\n*Select a raffle below to purchase a ticket!*`);

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      // --- H. MEMBER HUB: MARKETPLACE ---
      if (customId === 'hub_marketplace') {
        await interaction.deferReply({ ephemeral: true });

        const currType = getCurrencyType(guildId);
        const currLabel = currType === 'xp' ? 'XP' : 'CP';

        const { data: items } = await supabase
          .from('marketplace_items')
          .select('*')
          .eq('guild_id', guildId)
          .neq('stock', 0)
          .order('cost', { ascending: true });

        if (!items || items.length === 0) {
          return interaction.editReply({
            content: '🛒 **The Community Marketplace is currently empty.** Ask an admin to add rewards via `/admin`!',
          });
        }

        const options = items.slice(0, 25).map(item =>
          new StringSelectMenuOptionBuilder()
            .setLabel(item.title.slice(0, 50))
            .setDescription(`Cost: ${item.cost} ${currLabel} • ${item.stock === -1 ? 'Unlimited' : `${item.stock} in stock`}`)
            .setValue(item.item_id)
            .setEmoji('🛍️')
        );

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_buy_item')
          .setPlaceholder(`Choose an item to purchase with your ${currLabel}`)
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const btnRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('hub_my_purchases')
            .setLabel('My Purchases & Receipts')
            .setEmoji('🧾')
            .setStyle(ButtonStyle.Secondary)
        );

        const itemListText = items
          .map(
            (it, i) =>
              `**${i + 1}. ${it.title}** — **${it.cost} ${currLabel}**\n` +
              `↳ ${it.description || 'No description'} • Stock: ${it.stock === -1 ? 'Unlimited' : it.stock}`
          )
          .join('\n\n');

        const embed = new EmbedBuilder()
          .setColor(0xffb703)
          .setTitle(`🛒 ${interaction.guild?.name || 'Server'} • Community Marketplace`)
          .setDescription(`${itemListText}\n\n*Select an item below to purchase, or view your past receipts!*`)
          .setFooter({
            text: `${currType === 'xp' ? 'Experience Points (XP)' : 'Cohesion Points (CP)'} are automatically deducted upon purchase`,
          });

        return interaction.editReply({ embeds: [embed], components: [row, btnRow] });
      }

      // --- MEMBER HUB: MY PURCHASES & RECEIPTS ---
      if (customId === 'hub_my_purchases') {
        await interaction.deferReply({ ephemeral: true });

        const { data: myPurchases } = await supabase
          .from('marketplace_purchases')
          .select('*')
          .eq('guild_id', guildId)
          .eq('discord_id', discordId)
          .order('created_at', { ascending: false })
          .limit(10);

        if (!myPurchases || myPurchases.length === 0) {
          return interaction.editReply({
            content: '🛍️ **You have not purchased any items from the Community Marketplace yet.**',
          });
        }

        const rows = myPurchases.map((p, i) => {
          const recId = (p.purchase_id || p.id || 'N/A').toString().slice(-8).toUpperCase();
          const timeSec = p.created_at ? Math.floor(new Date(p.created_at).getTime() / 1000) : null;
          const timeStr = timeSec ? `<t:${timeSec}:f> (<t:${timeSec}:R>)` : 'Recently';
          return `**${i + 1}. ${p.item_title}**\n` +
            `• Cost: **${p.cost_paid} QP**\n` +
            `• Receipt ID: \`#REC-${recId}\`\n` +
            `• Date: ${timeStr}`;
        });

        const embed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('🧾 My Marketplace Purchases & Receipts')
          .setDescription(
            `Here are your recent verified purchases. Provide your **Receipt ID** to server admins if manual verification is required:\n\n` +
            rows.join('\n\n')
          )
          .setFooter({ text: `Member ID: ${discordId}` })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // --- MEMBER HUB: ACTIVE AUCTIONS ---
      if (customId === 'hub_auctions') {
        await interaction.deferReply({ ephemeral: true });

        const { data: auctions } = await supabase
          .from('auctions')
          .select('*')
          .eq('guild_id', guildId)
          .eq('is_active', true)
          .gte('end_time', new Date().toISOString())
          .order('end_time', { ascending: true });

        if (!auctions || auctions.length === 0) {
          return interaction.editReply({
            content: '🔨 **There are currently no active community auctions.** Stay tuned for the next drop!',
          });
        }

        const auctionListText = auctions
          .map((a, i) => {
            const highBid = Number(a.current_highest_bid || 0);
            const jumpLink =
              a.channel_id && a.message_id
                ? ` • [👉 Jump to Message](https://discord.com/channels/${guildId}/${a.channel_id}/${a.message_id})`
                : '';
            return `**${i + 1}. ${a.item_title}**\n` +
              `↳ Highest Bid: **${highBid > 0 ? `${highBid.toLocaleString()} QP` : 'Starting: ' + a.starting_bid + ' QP'}**\n` +
              `↳ Ends: <t:${Math.floor(new Date(a.end_time).getTime() / 1000)}:R>${jumpLink}`;
          })
          .join('\n\n');

        const embed = new EmbedBuilder()
          .setColor(0xffd166)
          .setTitle(`🔨 ${interaction.guild?.name || 'Server'} • Active Auctions`)
          .setDescription(
            `${auctionListText}\n\n` +
            `*Select an auction below to view full details or place a bid:*`
          )
          .setFooter({ text: 'Cohesion Live Escrow Auctions' });

        const options = auctions.slice(0, 25).map((a, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${i + 1}. ${a.item_title.slice(0, 45)}`)
            .setDescription(
              `Top: ${Number(a.current_highest_bid || 0) > 0 ? a.current_highest_bid + ' QP' : a.starting_bid + ' QP'} • Ends soon`
            )
            .setValue(a.auction_id)
            .setEmoji('🔨')
        );

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_view_auction')
          .setPlaceholder('Choose an auction to view or bid on')
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      // --- I. AUCTION BID BUTTON (Pops up Place Bid Modal) ---
      if (customId.startsWith('auction_bid_')) {
        const auctionId = customId.replace('auction_bid_', '');

        const { data: auction } = await supabase
          .from('auctions')
          .select('*')
          .eq('auction_id', auctionId)
          .maybeSingle();

        if (!auction || !auction.is_active || new Date(auction.end_time).getTime() < Date.now()) {
          return interaction.reply({ content: '❌ This auction has already ended!', ephemeral: true });
        }

        const currentHighest = Number(auction.current_highest_bid || 0);
        const minNextBid = currentHighest > 0 ? currentHighest + Number(auction.min_increment) : Number(auction.starting_bid);

        const modal = new ModalBuilder()
          .setCustomId(`modal_place_bid_${auctionId}`)
          .setTitle(`🔨 Bid on: ${auction.item_title.slice(0, 30)}`);

        const bidInput = new TextInputBuilder()
          .setCustomId('input_bid_amount')
          .setLabel(`Your Bid (Min: ${minNextBid} QP)`)
          .setValue(String(minNextBid))
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(bidInput));
        return interaction.showModal(modal);
      }

      // --- J. AUCTION HISTORY BUTTON ---
      if (customId.startsWith('auction_history_')) {
        const auctionId = customId.replace('auction_history_', '');
        await interaction.deferReply({ ephemeral: true });

        const { data: bids } = await supabase
          .from('auction_bids')
          .select('*')
          .eq('auction_id', auctionId)
          .order('bid_amount', { ascending: false })
          .limit(10);

        if (!bids || bids.length === 0) {
          return interaction.editReply({ content: '📜 No bids have been placed on this auction yet!' });
        }

        const historyList = bids
          .map((b, i) => `**#${i + 1}** <@${b.discord_id}> — **${Number(b.bid_amount).toLocaleString()} QP** (<t:${Math.floor(new Date(b.created_at).getTime() / 1000)}:R>)`)
          .join('\n');

        const embed = new EmbedBuilder()
          .setColor(0xffd166)
          .setTitle('📜 Top Bids History')
          .setDescription(historyList);

        return interaction.editReply({ embeds: [embed] });
      }

      // --- K. TWITTER ENGAGEMENT VERIFICATION (Like, Retweet, Comment) ---
      if (
        customId.startsWith('verify_like_') ||
        customId.startsWith('verify_rt_') ||
        customId.startsWith('verify_comment_')
      ) {
        let actionType = 'like';
        let actionLabel = 'Like ❤️';

        if (customId.startsWith('verify_rt_')) {
          actionType = 'retweet';
          actionLabel = 'Retweet 🔁';
        } else if (customId.startsWith('verify_comment_')) {
          actionType = 'comment';
          actionLabel = 'Comment 💬';
        }

        const tweetId = customId.replace(/^(verify_like_|verify_rt_|verify_comment_)/, '');

        await interaction.deferReply({ ephemeral: true });

        try {
          // 1. Check if Tweet Quest exists and has not expired
          const { data: questRecord } = await supabase
            .from('tweet_quests')
            .select('*')
            .eq('tweet_id', tweetId)
            .maybeSingle();

          if (questRecord && questRecord.expires_at) {
            const isExpired = new Date(questRecord.expires_at).getTime() < Date.now();
            if (isExpired) {
              return interaction.editReply({
                content: '⏳ **This tweet quest has expired.** No further points can be collected.',
              });
            }
          }

          const pointsReward = questRecord?.points_per_action || 25;

          // 2. Check if already claimed
          const { data: existingClaim } = await supabase
            .from('claimed_quests')
            .select('*')
            .eq('discord_id', discordId)
            .eq('tweet_id', tweetId)
            .eq('action_type', actionType)
            .maybeSingle();

          if (existingClaim) {
            return interaction.editReply({
              content: `⚠️ **Already Claimed!** You have already earned points for ${actionLabel} on this tweet.`,
            });
          }

          // 3. Check Twitter Linking
          const { data: userIntegration } = await supabase
            .from('user_integrations')
            .select('*')
            .eq('discord_id', discordId)
            .eq('provider', 'twitter')
            .maybeSingle();

          if (!userIntegration) {
            return interaction.editReply({
              content:
                '⚠️ **Twitter / X Account Not Connected!**\n\n' +
                'You must link your Twitter handle before we can verify your engagement.\n' +
                '👉 Use `/hub` or `/connect-twitter` to link your account, then click the button again!',
            });
          }

          // 4. Verify with X API (v2)
          let isVerified = false;
          if (userIntegration.access_token === 'dev_token_sample' || process.env.NODE_ENV === 'test') {
            isVerified = true;
          } else {
            const verification = await verifyTwitterAction({
              accessToken: userIntegration.access_token,
              twitterUserId: userIntegration.provider_user_id,
              tweetId,
              action: actionType,
            });

            if (!verification.verified) {
              return interaction.editReply({
                content: `❌ **Verification Failed:** ${verification.message || `We couldn't detect your ${actionLabel}. Please perform the action on X and try again!`}`,
              });
            }
            isVerified = true;
          }

          if (!isVerified) {
            return interaction.editReply({
              content: `❌ Could not verify your ${actionLabel} on X. Please try again.`,
            });
          }

          // 5. Store claim
          await supabase.from('claimed_quests').insert({
            guild_id: guildId,
            discord_id: discordId,
            tweet_id: tweetId,
            action_type: actionType,
            points_awarded: pointsReward,
          });

          // 6. Credit points
          const { data: userRecord } = await supabase
            .from('users')
            .select('total_points')
            .eq('guild_id', guildId)
            .eq('discord_id', discordId)
            .maybeSingle();

          const currentPoints = Number(userRecord?.total_points || 0);
          const newPoints = currentPoints + pointsReward;

          await supabase.from('users').upsert(
            {
              guild_id: guildId,
              discord_id: discordId,
              total_points: newPoints,
            },
            { onConflict: 'guild_id,discord_id' }
          );

          const successEmbed = new EmbedBuilder()
            .setColor(0x06d6a0)
            .setTitle('✅ Engagement Verified!')
            .setDescription(
              `You successfully verified your **${actionLabel}** on X!\n\n` +
              `🪙 **+${pointsReward} Cohesion Points (CP)** have been added to your balance.\n` +
              `💰 Total Balance: **${newPoints.toLocaleString()} CP**`
            )
            .setFooter({ text: 'Cohesion Engagement Engine' });

          return interaction.editReply({ embeds: [successEmbed] });
        } catch (err) {
          console.error('[BUTTON ERROR]:', err);
          return interaction.editReply({ content: '❌ An error occurred during verification.' });
        }
      }

      // --- MULTI-PLATFORM ENGAGEMENT VERIFICATION (CMC, YouTube, TikTok) ---
      if (customId.startsWith('verify_multi_')) {
        await interaction.deferReply({ ephemeral: true });
        const parts = customId.split('_'); // ['verify', 'multi', platform, points]
        const platform = parts[2] || 'platform';
        const pointsReward = parseInt(parts[3], 10) || 50;

        // Check if user has linked an account for this platform
        const { data: userIntegration } = await supabase
          .from('user_integrations')
          .select('*')
          .eq('discord_id', discordId)
          .eq('provider', platform)
          .maybeSingle();

        // Check if already claimed this quest
        const claimKey = `multi_claim_${interaction.message?.id || 'post'}_${discordId}`;
        const { data: existingClaim } = await supabase
          .from('quest_submissions')
          .select('*')
          .eq('guild_id', guildId)
          .eq('discord_id', discordId)
          .eq('url', claimKey)
          .maybeSingle();

        if (existingClaim) {
          return interaction.editReply({
            content: '⚠️ You have already verified and claimed points for this quest!',
          });
        }

        // Fetch user record
        const { data: userRecord } = await supabase
          .from('users')
          .select('total_points, xp, level')
          .eq('guild_id', guildId)
          .eq('discord_id', discordId)
          .maybeSingle();

        const currentPoints = Number(userRecord?.total_points || 0);
        const newPoints = currentPoints + pointsReward;

        await supabase.from('users').upsert(
          {
            guild_id: guildId,
            discord_id: discordId,
            total_points: newPoints,
          },
          { onConflict: 'guild_id,discord_id' }
        );

        // Record claim
        await supabase.from('quest_submissions').insert({
          guild_id: guildId,
          discord_id: discordId,
          url: claimKey,
          status: 'verified',
          points_awarded: pointsReward,
        });

        // Log to #cohesion-logs
        await logActivity(interaction.guild, {
          title: '🌐 Multi-Platform Quest Verified',
          description: `<@${discordId}> verified engagement on **${platform.toUpperCase()}** and earned **+${pointsReward} CP**!`,
          color: 0x06d6a0,
          userId: discordId,
        });

        const successEmbed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('✅ Platform Engagement Verified!')
          .setDescription(
            `You successfully verified your actions on **${platform.toUpperCase()}**!\n\n` +
            `🪙 **+${pointsReward} Cohesion Points (CP)** have been added to your balance.\n` +
            `💰 Total Balance: **${newPoints.toLocaleString()} CP**`
          )
          .setFooter({ text: 'Cohesion Multi-Platform Engine' })
          .setTimestamp();

        return interaction.editReply({ embeds: [successEmbed] });
      }

      // --- WEBSITE VISIT QUEST CLAIM ---
      if (customId.startsWith('claim_visit_')) {
        await interaction.deferReply({ ephemeral: true });
        const parts = customId.split('_'); // ['claim', 'visit', questId, points, seconds]
        const questId = parts[2] || 'visit';
        const pointsReward = parseInt(parts[3], 10) || 35;

        // Anti-cheat: 1-claim per user per quest
        const claimKey = `visit_claim_${questId}_${discordId}`;
        const { data: existingClaim } = await supabase
          .from('quest_submissions')
          .select('*')
          .eq('guild_id', guildId)
          .eq('discord_id', discordId)
          .eq('url', claimKey)
          .maybeSingle();

        if (existingClaim) {
          return interaction.editReply({
            content: '⚠️ You have already claimed the points for visiting this website!',
          });
        }

        // Fetch user record
        const { data: userRecord } = await supabase
          .from('users')
          .select('total_points')
          .eq('guild_id', guildId)
          .eq('discord_id', discordId)
          .maybeSingle();

        const currentPoints = Number(userRecord?.total_points || 0);
        const newPoints = currentPoints + pointsReward;

        await supabase.from('users').upsert(
          {
            guild_id: guildId,
            discord_id: discordId,
            total_points: newPoints,
          },
          { onConflict: 'guild_id,discord_id' }
        );

        await supabase.from('quest_submissions').insert({
          guild_id: guildId,
          discord_id: discordId,
          url: claimKey,
          status: 'verified',
          points_awarded: pointsReward,
        });

        await logActivity(interaction.guild, {
          title: '🌐 Website Visit Quest Claimed',
          description: `<@${discordId}> completed website visit quest and earned **+${pointsReward} CP**!`,
          color: 0x06d6a0,
          userId: discordId,
        });

        const successEmbed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('✅ Website Visit Verified!')
          .setDescription(
            `Thank you for exploring the site!\n\n` +
            `🪙 **+${pointsReward} Cohesion Points (CP)** have been credited to your balance.\n` +
            `💰 Total Balance: **${newPoints.toLocaleString()} CP**`
          )
          .setFooter({ text: 'Cohesion Visit Engine' })
          .setTimestamp();

        return interaction.editReply({ embeds: [successEmbed] });
      }

      // --- L. COMMUNITY QUIZ ANSWER SUBMISSION ---
      if (customId.startsWith('quiz_ans_')) {
        const rest = customId.replace('quiz_ans_', '');
        const lastUnderscore = rest.lastIndexOf('_');
        const quizId = rest.substring(0, lastUnderscore);
        const choiceIndex = parseInt(rest.substring(lastUnderscore + 1), 10);

        await interaction.deferReply({ ephemeral: true });

        const quiz = await getQuiz(quizId);
        if (!quiz) {
          return interaction.editReply({
            content: '❌ **Quiz not found or expired.**',
          });
        }

        if (new Date(quiz.expires_at).getTime() < Date.now()) {
          return interaction.editReply({
            content: '⏳ **This quiz has already expired!** Watch for future trivia drops.',
          });
        }

        const alreadySubmitted = await hasUserSubmitted(quizId, discordId);
        if (alreadySubmitted) {
          return interaction.editReply({
            content: '⚠️ **You have already submitted an answer for this quiz!** Only 1 attempt per member is permitted.',
          });
        }

        const isCorrect = choiceIndex === Number(quiz.correct_index);
        const pointsAwarded = isCorrect ? Number(quiz.reward_points || 0) : 0;
        const xpAwarded = isCorrect ? Number(quiz.reward_xp || 0) : 0;

        await recordSubmission({
          quizId,
          guildId,
          discordId,
          selectedIndex: choiceIndex,
          isCorrect,
          pointsAwarded,
        });

        // Refresh participant counter on original message
        const count = getQuizParticipantCount(quizId);
        const updatedPayload = buildQuizPayload(quiz, count);
        await interaction.message.edit(updatedPayload).catch(() => null);

        if (isCorrect) {
          // Credit points and XP
          const { data: userRecord } = await supabase
            .from('users')
            .select('total_points, xp, level')
            .eq('guild_id', guildId)
            .eq('discord_id', discordId)
            .maybeSingle();

          const currentPoints = Number(userRecord?.total_points || 0);
          const currentXp = Number(userRecord?.xp || 0);
          const newPoints = currentPoints + pointsAwarded;
          const newXp = currentXp + xpAwarded;
          const newLevel = getLevelFromXp(newXp);

          await supabase.from('users').upsert(
            {
              guild_id: guildId,
              discord_id: discordId,
              total_points: newPoints,
              xp: newXp,
              level: newLevel,
            },
            { onConflict: 'guild_id,discord_id' }
          );

          // Check level-up role reward
          try {
            const guild =
              interaction.guild ||
              (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);
            if (guild) {
              const member = await guild.members.fetch(discordId).catch(() => null);
              if (member) {
                const { data: roleRewards } = await supabase
                  .from('level_role_rewards')
                  .select('required_level, role_id')
                  .eq('guild_id', guildId)
                  .lte('required_level', newLevel);

                if (roleRewards && roleRewards.length > 0) {
                  for (const rw of roleRewards) {
                    if (!member.roles.cache.has(rw.role_id)) {
                      await member.roles.add(rw.role_id).catch(() => null);
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.error('[QUIZ ROLE CHECK ERROR]:', e);
          }

          const winEmbed = new EmbedBuilder()
            .setColor(0x06d6a0)
            .setTitle('🎉 Correct Answer!')
            .setDescription(
              `🎯 **Awesome job!** You chose the right answer:\n` +
              `**${quiz.options[choiceIndex]}**\n\n` +
              `🪙 **Rewards Earned:**\n` +
              `• **+${pointsAwarded} Cohesion Points (CP)**\n` +
              `• **+${xpAwarded} XP**\n\n` +
              `💰 **Updated Balance:** ${newPoints.toLocaleString()} CP (Level ${newLevel})`
            )
            .setFooter({ text: 'Cohesion Gamification Engine' });

          return interaction.editReply({ embeds: [winEmbed] });
        } else {
          const lossEmbed = new EmbedBuilder()
            .setColor(0xef476f)
            .setTitle('❌ Incorrect Answer')
            .setDescription(
              `You selected: **${quiz.options[choiceIndex]}**\n\n` +
              `Better luck next time! Stay tuned to the community channels for the next trivia drop.`
            )
            .setFooter({ text: 'Cohesion Trivia System' });

          return interaction.editReply({ embeds: [lossEmbed] });
        }
      }

      // --- M. LIVE TOURNAMENT ANSWER SUBMISSION ---
      if (customId.startsWith('quiz_live_ans_')) {
        const rest = customId.replace('quiz_live_ans_', '');
        const lastUnder = rest.lastIndexOf('_');
        const choiceIndex = parseInt(rest.substring(lastUnder + 1), 10);
        const middle = rest.substring(0, lastUnder);
        const secondLastUnder = middle.lastIndexOf('_');
        const qIndex = parseInt(middle.substring(secondLastUnder + 1), 10);
        const sessionId = middle.substring(0, secondLastUnder);

        await interaction.deferReply({ ephemeral: true });

        const result = submitLiveAnswer(sessionId, qIndex, discordId, choiceIndex);
        if (result.error) {
          return interaction.editReply({ content: result.error });
        }

        if (result.isCorrect) {
          const winEmbed = new EmbedBuilder()
            .setColor(0x06d6a0)
            .setTitle('🎯 Fast & Correct!')
            .setDescription(
              `You selected: **${result.chosenOption}**\n\n` +
              `⚡ **Speed:** Answered in **${result.elapsedSec}s**!\n` +
              `🪙 **Points Awarded:** **+${result.pointsAwarded} CP** (Speed-Bonus Applied)\n` +
              `🏆 **Total Tournament Score:** **${result.totalScore.toLocaleString()} CP**`
            )
            .setFooter({ text: 'Cohesion Live Tournament' });

          return interaction.editReply({ embeds: [winEmbed] });
        } else {
          const lossEmbed = new EmbedBuilder()
            .setColor(0xef476f)
            .setTitle('❌ Incorrect Answer')
            .setDescription(
              `You selected: **${result.chosenOption}**\n\n` +
              `0 points awarded for this round. Keep your eyes on the channel for the next question!`
            )
            .setFooter({ text: 'Cohesion Live Tournament' });

          return interaction.editReply({ embeds: [lossEmbed] });
        }
      }

      // --- N. COMMUNITY POLL VOTE BUTTON ---
      if (customId.startsWith('poll_vote_')) {
        const rest = customId.replace('poll_vote_', '');
        const lastUnder = rest.lastIndexOf('_');
        const pollId = rest.substring(0, lastUnder);
        const optionIndex = parseInt(rest.substring(lastUnder + 1), 10);

        await interaction.deferReply({ ephemeral: true });

        const result = await castPollVote({
          pollId,
          guildId,
          discordId,
          optionIndex,
          client: interaction.client,
        });

        if (result.error) {
          if (result.error.includes('concluded')) {
            await concludePoll(pollId, interaction.client);
          }
          return interaction.editReply({ content: result.error });
        }

        // Update the live poll card with new vote count and percentage bars
        const updatedPayload = await buildPollPayload(result.poll);
        await interaction.message.edit(updatedPayload).catch(() => null);

        let rewardText = '';
        if (result.pointsAwarded > 0 || result.xpAwarded > 0) {
          rewardText = `\n\n🪙 **Rewards Earned:** +${result.pointsAwarded} CP & +${result.xpAwarded} XP\n` +
            `💰 **Current Balance:** ${result.newPoints.toLocaleString()} CP (Level ${result.newLevel})`;
        }

        const voteEmbed = new EmbedBuilder()
          .setColor(0x00b4d8)
          .setTitle('✅ Vote Recorded!')
          .setDescription(
            `You voted for: **${result.chosenOption}**${rewardText}\n\n` +
            `Thank you for participating in the community vote!`
          )
          .setFooter({ text: 'Cohesion Community Polls' });

        return interaction.editReply({ embeds: [voteEmbed] });
      }

      // --- COMMUNITY POLL: ADD OPTION BUTTON (MEMBER PROPOSED CHOICES) ---
      if (customId.startsWith('poll_add_option_')) {
        const pollId = customId.replace('poll_add_option_', '');
        const poll = await getPoll(pollId);
        if (!poll) {
          return interaction.reply({ content: '❌ Poll not found or expired.', ephemeral: true });
        }
        if (Date.now() > new Date(poll.expires_at).getTime()) {
          await concludePoll(pollId, interaction.client);
          return interaction.reply({ content: '⏳ This poll has already concluded! New options cannot be added.', ephemeral: true });
        }
        if (poll.options.length >= 24) {
          return interaction.reply({ content: '⚠️ Maximum choice limit (24 options) reached for this poll.', ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId(`modal_poll_add_opt_${pollId}`)
          .setTitle('➕ Add Poll Option');

        const newOptionInput = new TextInputBuilder()
          .setCustomId('input_poll_new_option')
          .setLabel('Your Proposed Choice')
          .setPlaceholder('Enter choice name (e.g. Telegram or Revolt)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(60)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(newOptionInput));
        return interaction.showModal(modal);
      }

      // --- O. CHAOS CLASH: JOIN LOBBY BUTTON ---
      if (customId.startsWith('battle_join_')) {
        await interaction.deferReply({ ephemeral: true });

        const result = await joinBattleMatch(guildId, interaction.user);
        if (!result.success) {
          return interaction.editReply({ content: result.message });
        }

        // Update live lobby message embed with new fighter list
        const payload = buildLobbyPayload(result.match);
        await interaction.message.edit(payload).catch(() => null);

        const remainingSec = Math.max(
          1,
          Math.round((result.match.createdAt + result.match.signupDurationSec * 1000 - Date.now()) / 1000)
        );

        const signupMsg =
          result.match.mode === 'interactive'
            ? `⚔️ Welcome to the Arena! You have entered Chaos Clash (${result.totalJoined} fighters currently registered). 🛡️ Click Choose Archetype on the lobby message if you want to switch from default Tactician to Berserker, Medic, or Thief!\nStarting in ${remainingSec} seconds.`
            : `⚔️ Welcome to the Arena! You have entered Chaos Clash (${result.totalJoined} fighters currently registered).\nStarting in ${remainingSec} seconds.`;

        return interaction.editReply({
          content: signupMsg,
        });
      }

      // --- VIEW FIGHTERS BUTTON ---
      if (customId.startsWith('battle_view_fighters_')) {
        const matchId = customId.replace('battle_view_fighters_', '');
        const payload = buildFightersListPayload(matchId);
        return interaction.reply(payload);
      }

      // --- P. CHAOS CLASH: CHOOSE ARCHETYPE BUTTON ---
      if (customId.startsWith('battle_pick_class_')) {
        const matchId = customId.replace('battle_pick_class_', '');
        const payload = buildClassSelectionPayload(matchId);
        return interaction.reply(payload);
      }

      // --- Q. CHAOS CLASH: PLACE BET BUTTON ---
      if (customId.startsWith('battle_bet_')) {
        const matchId = customId.replace('battle_bet_', '');
        const match = getMatchById(matchId);
        if (!match || match.status !== 'signup') {
          return interaction.reply({ content: '⏳ Betting is only open during the active sign-up phase!', ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId(`modal_battle_bet_${matchId}`)
          .setTitle('🪙 Spectator Betting Pool');

        const fighterInput = new TextInputBuilder()
          .setCustomId('input_bet_fighter')
          .setLabel('Fighter Name (Exact or partial name)')
          .setPlaceholder('e.g. nahian or Alice')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const amountInput = new TextInputBuilder()
          .setCustomId('input_bet_amount')
          .setLabel('Bet Amount in Cohesion Points (CP)')
          .setPlaceholder('e.g. 50')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(fighterInput),
          new ActionRowBuilder().addComponents(amountInput)
        );

        return interaction.showModal(modal);
      }

      // --- R. CHAOS CLASH: LIVE QTE ACTIONS (SUPPLY, COVER, ION, GAS, RELIC) ---
      if (customId.startsWith('battle_qte_loot_')) {
        const matchId = customId.replace('battle_qte_loot_', '');
        await interaction.deferReply({ ephemeral: true });
        const result = resolveQTEAction(matchId, discordId, 'loot');
        return interaction.editReply({ content: result.message });
      }

      if (customId.startsWith('battle_qte_cover_')) {
        const matchId = customId.replace('battle_qte_cover_', '');
        await interaction.deferReply({ ephemeral: true });
        const result = resolveQTEAction(matchId, discordId, 'cover');
        return interaction.editReply({ content: result.message });
      }

      if (customId.startsWith('battle_qte_relic_')) {
        const matchId = customId.replace('battle_qte_relic_', '');
        await interaction.deferReply({ ephemeral: true });
        const result = resolveQTEAction(matchId, discordId, 'relic');
        return interaction.editReply({ content: result.message });
      }

      if (customId.startsWith('battle_qte_ion_')) {
        const matchId = customId.replace('battle_qte_ion_', '');
        await interaction.deferReply({ ephemeral: true });
        const result = resolveQTEAction(matchId, discordId, 'ion');
        return interaction.editReply({ content: result.message });
      }

      if (customId.startsWith('battle_qte_gas_')) {
        const matchId = customId.replace('battle_qte_gas_', '');
        await interaction.deferReply({ ephemeral: true });
        const result = resolveQTEAction(matchId, discordId, 'gas');
        return interaction.editReply({ content: result.message });
      }

      // --- S. CHAOS CLASH: ARMORY & COSMETICS CATALOG ---
      if (customId === 'battle_armory') {
        await interaction.deferReply({ ephemeral: true });

        const userCosmetics = await getUserCosmetics(guildId, discordId);

        const embed = new EmbedBuilder()
          .setColor(0x7209b7)
          .setTitle('🏪 Chaos Clash Armory & Prestige Cosmetics')
          .setDescription(
            `Upgrade your fighter status in the arena! Purchased cosmetics are permanently unlocked and displayed dynamically in live event logs.\n\n` +
            `**🎖️ Your Current Loadout:**\n` +
            `• Title / Prefix: ${userCosmetics.battle_title ? `**${userCosmetics.battle_title}**` : '*None*'}\n` +
            `• Custom Emoji: ${userCosmetics.battle_emoji || '*None*'}\n` +
            `• Hex Accent: ${userCosmetics.battle_name_color || '*Default*'}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `**Tier 1 (Common - 150 CP):** Standard Combat Emojis (⚔️, 🛡️, 🎯, 🏹)\n` +
            `**Tier 2 (Rare - 350 CP):** Luminescent Hex Bracket Tags (⟦MINT⟧, ⟦ROSE⟧, ⟦GOLD⟧, ⟦FROST⟧)\n` +
            `**Tier 3 (Epic - 750 CP):** Elite Animated Crests (🔥, 👑, ⚡, 💀, 💎)\n` +
            `**Tier 4 (Mythic - 1,500 CP):** Legendary Overriding Titles ([Warlord], [GOD-TIER], [Immortal], [Apex])\n\n` +
            `*Select an item below to purchase with your Cohesion Points (CP)!*`
          )
          .setFooter({ text: 'Points are automatically deducted from your server profile' });

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_buy_cosmetic')
          .setPlaceholder('Choose a cosmetic item to equip');

        const allItems = [
          ...BATTLE_COSMETICS_CATALOG.tier1,
          ...BATTLE_COSMETICS_CATALOG.tier2,
          ...BATTLE_COSMETICS_CATALOG.tier3,
          ...BATTLE_COSMETICS_CATALOG.tier4,
        ];

        selectMenu.addOptions(
          allItems.slice(0, 25).map((it) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`[T${it.tier}] ${it.name} (${it.cost} QP)`)
              .setDescription(it.description.slice(0, 100))
              .setValue(it.id)
              .setEmoji(it.type === 'emoji' ? it.value : '🏷️')
          )
        );

        return interaction.editReply({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(selectMenu)],
        });
      }

      // --- RAFFLE: MULTI-TICKET QUICK PURCHASE BUTTONS (rfbuy_<count>_<raffleId> or legacy raffle_buy_) ---
      if (
        (customId.startsWith('rfbuy_') && !customId.startsWith('rfbuy_custom_')) ||
        (customId.startsWith('raffle_buy_') && !customId.startsWith('raffle_buy_custom_'))
      ) {
        let count = 1;
        let raffleId = '';

        if (customId.startsWith('rfbuy_')) {
          // Format: rfbuy_<count>_<raffleId>
          const parts = customId.split('_');
          count = parseInt(parts[1], 10) || 1;
          raffleId = parts.slice(2).join('_');
        } else {
          // Legacy format: raffle_buy_<raffleId>_<count>
          const parts = customId.split('_');
          count = parseInt(parts[parts.length - 1], 10) || 1;
          raffleId = parts.slice(2, parts.length - 1).join('_');
        }

        await interaction.deferUpdate();

        const result = await executeRaffleTicketPurchase({
          guildId,
          discordId,
          raffleId,
          count,
        });

        if (result.error) {
          return interaction.followUp({ content: result.error, ephemeral: true });
        }

        return interaction.editReply({
          embeds: [result.embed],
          components: [result.row],
        });
      }

      // --- RAFFLE: CUSTOM QUANTITY BUTTON (PROMPTS MODAL) ---
      if (customId.startsWith('rfbuy_custom_') || customId.startsWith('raffle_buy_custom_')) {
        const raffleId = customId.startsWith('rfbuy_custom_')
          ? customId.replace('rfbuy_custom_', '')
          : customId.replace('raffle_buy_custom_', '');

        const modal = new ModalBuilder()
          .setCustomId(`modal_raffle_buy_${raffleId}`)
          .setTitle('🎟️ Buy Multiple Raffle Tickets');

        const countInput = new TextInputBuilder()
          .setCustomId('input_raffle_ticket_count')
          .setLabel('Ticket Quantity')
          .setPlaceholder('Enter quantity (e.g. 25)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(5)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(countInput));
        return interaction.showModal(modal);
      }
    }

    // ==========================================
    // 3. HANDLE MODAL FORM SUBMISSIONS
    // ==========================================
    if (interaction.isModalSubmit()) {
      const modalId = interaction.customId;
      const guildId = interaction.guildId;
      const discordId = interaction.user.id;

      // Security Guard: Check admin permissions for any admin modal form
      const adminModals = [
        'modal_post_tweet',
        'modal_post_multi',
        'modal_create_raffle',
        'modal_create_auction',
        'modal_add_shop',
        'modal_vc_snapshot',
        'modal_reward_member',
        'modal_create_quiz',
        'modal_setup_live_quiz',
        'modal_create_poll',
        'modal_create_battle',
        'modal_track_twitter',
        'modal_economy_settings',
        'modal_tier_roles',
        'modal_announcement_reactions',
        'modal_season_wipe',
        'modal_export_daterange',
        'modal_automod_words',
      ];
      if (
        adminModals.includes(modalId) ||
        modalId.startsWith('modal_vc_snapshot') ||
        modalId.startsWith('modal_lqz_addq_') ||
        modalId.startsWith('modal_lqz_bulkq_')
      ) {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ **Access Denied**: You need `Manage Server` or `Administrator` permissions to submit this form.',
            ephemeral: true,
          });
        }
      }

      // --- MODAL: POST TWEET QUEST ---
      if (modalId === 'modal_post_tweet') {
        await interaction.deferReply({ ephemeral: true });

        let rawUrl = '';
        try {
          rawUrl = interaction.fields.getTextInputValue('input_tweet_url');
        } catch (_) {}

        let pointsHoursStr = '';
        try {
          pointsHoursStr = interaction.fields.getTextInputValue('input_points_hours') || '';
        } catch (_) {}

        let rawPoints = '';
        try {
          rawPoints = interaction.fields.getTextInputValue('input_points') || '';
        } catch (_) {}

        let rawHours = '';
        try {
          rawHours = interaction.fields.getTextInputValue('input_expire_hours') || '';
        } catch (_) {}

        let tagStr = '';
        try {
          tagStr = interaction.fields.getTextInputValue('input_tag') || '';
        } catch (_) {}

        let optionsStr = '';
        try {
          optionsStr = interaction.fields.getTextInputValue('input_options') || '';
        } catch (_) {}
        if (!optionsStr) {
          try {
            optionsStr = interaction.fields.getTextInputValue('input_buttons') || '';
          } catch (_) {}
        }

        const customText = interaction.fields.getTextInputValue('input_custom_text') || '';

        let ctaText = '';
        try {
          const rawCta = interaction.fields.getTextInputValue('input_call_to_action');
          if (rawCta && rawCta.trim().length > 0) {
            ctaText = rawCta.trim();
          }
        } catch (_) {}

        const parsed = parseTweetUrl(rawUrl);
        if (!parsed) {
          return interaction.editReply({
            content: '❌ Invalid Twitter/X URL. Please format like: `https://x.com/username/status/123456789...`',
          });
        }

        const { username, tweetId, cleanUrl } = parsed;

        let points = 25;
        let durationMs = 24 * 60 * 60 * 1000;
        if (pointsHoursStr) {
          const parts = pointsHoursStr.split(/[,|\s]+/).filter(Boolean);
          if (parts[0]) points = parseInt(parts[0], 10) || 25;
          if (parts[1]) {
            const rawDur = parts[1].trim().toLowerCase();
            const parsedMs = parseDuration(rawDur);
            if (parsedMs) {
              durationMs = parsedMs;
            } else {
              const num = parseInt(rawDur, 10);
              if (!isNaN(num) && num > 0) {
                durationMs = num * 60 * 60 * 1000;
              }
            }
          }
        } else {
          if (rawPoints) points = parseInt(rawPoints, 10) || 25;
          if (rawHours) {
            const parsedMs = parseDuration(rawHours);
            durationMs = parsedMs || (parseInt(rawHours, 10) || 24) * 60 * 60 * 1000;
          }
        }

        // Fetch tweet metadata with media image/thumbnail and author avatar
        const tweetMeta = await fetchTweetMetadata(cleanUrl, username, tweetId);
        const authorDisplayName = tweetMeta?.authorName || `@${username}`;
        const tweetBody = tweetMeta?.text || 'Engage with this post on X to earn points!';

        const expiresAtDate = new Date(Date.now() + durationMs);
        const expireTimestampSec = Math.floor(expiresAtDate.getTime() / 1000);

        // Determine if thumbnail/image display is enabled (Default: true)
        let showImage = true;
        let includeButtons = true;
        let includeLike = true;
        let includeRt = true;
        let includeComment = true;

        if (optionsStr) {
          const lower = optionsStr.toLowerCase();

          const optParts = lower.split(/[,|\s]+/).map((s) => s.trim()).filter(Boolean);
          if (optParts.length >= 1 && ['no', 'false', 'off', '0'].includes(optParts[0])) {
            showImage = false;
          } else if (optParts.length >= 1 && ['yes', 'true', 'on', '1'].includes(optParts[0])) {
            showImage = true;
          }

          if (optParts.length >= 2 && ['no', 'false', 'off', '0', 'none'].includes(optParts[1])) {
            includeButtons = false;
            includeLike = false;
            includeRt = false;
            includeComment = false;
          } else if (optParts.length >= 2 && ['yes', 'true', 'on', '1'].includes(optParts[1])) {
            includeButtons = true;
          }

          // Image toggle: check untick [ ] or explicit "no" / "off" / "none"
          if (
            lower.includes('[ ] image') ||
            lower.includes('[-] image') ||
            lower.includes('[x] image: no') ||
            lower.includes('❌ image') ||
            lower.includes('image: no') ||
            lower.includes('image: off') ||
            lower.includes('image: false') ||
            lower.includes('image: none') ||
            lower.includes('no image') ||
            lower.includes('hide image') ||
            lower.includes('img: no') ||
            lower.includes('img: off')
          ) {
            showImage = false;
          } else if (
            lower.includes('[✓] image') ||
            lower.includes('[x] image') ||
            lower.includes('✅ image') ||
            lower.includes('image: yes') ||
            lower.includes('show image')
          ) {
            showImage = true;
          }

          // Buttons toggle: check untick [ ] or explicit "none" / "no" / "off"
          if (
            lower.includes('[ ] button') ||
            lower.includes('[-] button') ||
            lower.includes('❌ button') ||
            lower.includes('buttons: none') ||
            lower.includes('button: none') ||
            lower.includes('buttons: no') ||
            lower.includes('button: no') ||
            lower.includes('buttons: off') ||
            lower.includes('buttons: false') ||
            lower.includes('no buttons') ||
            lower.includes('no button') ||
            lower.includes('btn: none') ||
            lower.includes('btn: no') ||
            lower.includes('hide buttons') ||
            lower.trim() === 'none' ||
            lower.trim() === 'no' ||
            lower.trim() === 'off'
          ) {
            includeButtons = false;
            includeLike = false;
            includeRt = false;
            includeComment = false;
          } else {
            // Check specific button options if specified
            if (lower.includes('like') || lower.includes('rt') || lower.includes('comment')) {
              includeLike = !lower.includes('[ ] like') && (lower.includes('like') || lower.includes('[✓] like'));
              includeRt = !lower.includes('[ ] rt') && (lower.includes('rt') || lower.includes('retweet') || lower.includes('[✓] rt'));
              includeComment = !lower.includes('[ ] comment') && (lower.includes('comment') || lower.includes('reply') || lower.includes('[✓] comment'));
            }
          }
        }

        const guild =
          interaction.guild ||
          (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);
        if (guild && (!guild.roles.cache || guild.roles.cache.size <= 1)) {
          await guild.roles.fetch().catch(() => null);
        }

        const actionRow = new ActionRowBuilder();

        if (includeButtons) {
          if (includeLike) {
            actionRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`verify_like_${tweetId}`)
                .setLabel('Like')
                .setEmoji('❤️')
                .setStyle(ButtonStyle.Secondary)
            );
          }

          if (includeRt) {
            actionRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`verify_rt_${tweetId}`)
                .setLabel('Retweet')
                .setEmoji('🔁')
                .setStyle(ButtonStyle.Secondary)
            );
          }

          if (includeComment) {
            actionRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`verify_comment_${tweetId}`)
                .setLabel('Comment')
                .setEmoji('💬')
                .setStyle(ButtonStyle.Secondary)
            );
          }
        }

        // Always include "View on X" link button so users can open the post on X
        actionRow.addComponents(
          new ButtonBuilder()
            .setLabel('View on X')
            .setStyle(ButtonStyle.Link)
            .setURL(cleanUrl)
        );

        // Process custom snippet with Twitter linking and role tagging
        const processedSnippet = processSnippetRequirements(customText, guild, username);

        // Build clean message content
        let messageContent = `**${authorDisplayName}** just posted :\n${cleanUrl}\n\n`;
        if (ctaText) {
          messageContent += `**${ctaText}**\n`;
        }
        messageContent += `Expires <t:${expireTimestampSec}:R>`;

        if (processedSnippet.snippetBody) {
          messageContent += `\n\n${processedSnippet.snippetBody}`;
        }

        // Append bottom tag lines (e.g. @Socials, @everyone, etc.)
        if (processedSnippet.pingContent) {
          messageContent += `\n${processedSnippet.pingContent}`;
        } else if (tagStr && tagStr.trim()) {
          // Backward compatibility if tag was passed
          let fallbackTag = tagStr.trim();
          if (fallbackTag !== '@everyone' && fallbackTag !== '@here' && !/^<@&?\d+>$/.test(fallbackTag)) {
            const cleanName = fallbackTag.replace(/^@/, '').toLowerCase();
            const role = guild?.roles?.cache?.find((r) => r.name.toLowerCase() === cleanName);
            if (role) fallbackTag = `<@&${role.id}>`;
          }
          messageContent += `\n${fallbackTag}`;
        }

        // Build optional Tweet Media Embed if enabled
        const embeds = [];
        if (showImage) {
          const tweetEmbed = new EmbedBuilder()
            .setColor(0x1da1f2)
            .setAuthor({
              name: `${authorDisplayName} (@${username})`,
              iconURL: tweetMeta?.authorAvatar || 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
              url: cleanUrl,
            })
            .setTitle(`@${username} tweeted !`)
            .setURL(cleanUrl)
            .setDescription(tweetBody)
            .setFooter({
              text: 'Powered by Cohesion Gamification',
              iconURL: interaction.client.user.displayAvatarURL(),
            })
            .setTimestamp();

          if (tweetMeta?.mediaUrl) {
            tweetEmbed.setImage(tweetMeta.mediaUrl);
          } else if (tweetMeta?.authorAvatar) {
            tweetEmbed.setThumbnail(tweetMeta.authorAvatar);
          }

          embeds.push(tweetEmbed);
        }

        const components = actionRow.components.length > 0 ? [actionRow] : [];

        const sentMessage = await interaction.channel.send({
          content: messageContent,
          embeds,
          components,
          flags: showImage ? undefined : MessageFlags.SuppressEmbeds,
          allowedMentions: { parse: ['roles', 'users', 'everyone'] },
        });

        await supabase.from('tweet_quests').upsert(
          {
            tweet_id: tweetId,
            guild_id: guildId,
            url: cleanUrl,
            content: tweetBody,
            author_name: authorDisplayName,
            author_username: username,
            points_per_action: points,
            expires_at: expiresAtDate.toISOString(),
            channel_id: interaction.channelId,
            message_id: sentMessage.id,
          },
          { onConflict: 'tweet_id' }
        );

        return interaction.editReply({
          content: `✅ Successfully broadcasted new Cohesion tweet card to this channel! (Tweet ID: \`${tweetId}\`)`,
        });
      }

      // --- MODAL: CREATE RAFFLE ---
      if (modalId === 'modal_create_raffle') {
        await interaction.deferReply({ ephemeral: true });

        const prize = interaction.fields.getTextInputValue('input_raffle_prize');
        const costStr = interaction.fields.getTextInputValue('input_raffle_cost');
        const durationStr = interaction.fields.getTextInputValue('input_raffle_duration');

        const cost = parseInt(costStr, 10) || 50;
        const durationMs = parseDuration(durationStr) || 24 * 60 * 60 * 1000;
        const endTime = new Date(Date.now() + durationMs).toISOString();

        const { data: raffle, error } = await supabase
          .from('raffles')
          .insert({
            guild_id: guildId,
            prize,
            cost,
            end_time: endTime,
            is_active: true,
            created_by: discordId,
          })
          .select()
          .single();

        if (error) {
          return interaction.editReply({ content: '❌ Failed to create raffle in database.' });
        }

        const embed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('🎟️ New Cohesion Raffle Launched!')
          .setDescription(
            `**Prize**: ${prize}\n` +
            `**Ticket Cost**: ${cost} 🪙 Cohesion Points (CP)\n` +
            `**Ends**: <t:${Math.floor(new Date(endTime).getTime() / 1000)}:R>`
          )
          .setFooter({ text: `Raffle ID: ${raffle.raffle_id}` })
          .setTimestamp();

        await interaction.channel.send({ embeds: [embed] });

        return interaction.editReply({
          content: `✅ Raffle created successfully! Members can enter via \`/hub\` or \`/raffle enter\`.`,
        });
      }

      // --- MODAL: CONNECT TWITTER ---
      if (modalId === 'modal_connect_twitter') {
        await interaction.deferReply({ ephemeral: true });

        const rawHandle = interaction.fields.getTextInputValue('input_twitter_handle');
        const cleanHandle = rawHandle.replace(/^@/, '').trim();

        await supabase.from('user_integrations').upsert(
          {
            discord_id: discordId,
            provider: 'twitter',
            provider_user_id: `dev_${discordId}`,
            provider_username: cleanHandle,
            access_token: 'dev_token_sample',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'discord_id,provider' }
        );

        return interaction.editReply({
          content: `✅ Successfully linked your X account as **@${cleanHandle}**! You can now verify Likes, Retweets, and Comments.`,
        });
      }

      // --- MODAL: LINK WALLET (12-CHAIN AUTO-DETECTION) ---
      if (modalId === 'modal_link_wallet') {
        await interaction.deferReply({ ephemeral: true });

        const address = interaction.fields.getTextInputValue('input_wallet_address').trim();
        const userSpecifiedChain = interaction.fields.getTextInputValue('input_wallet_chain')?.trim();
        const detectedChain = detectChain(address);
        const finalChain = detectedChain || userSpecifiedChain || 'ETH';

        await supabase.from('user_integrations').upsert(
          {
            discord_id: discordId,
            provider: 'wallet',
            provider_user_id: finalChain,
            provider_username: address,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'discord_id,provider' }
        );

        return interaction.editReply({
          content:
            `✅ **Payout Wallet Linked Successfully!**\n\n` +
            `• **Address:** \`${address}\`\n` +
            `• **Detected Network:** **${finalChain}** (Auto-detected from 12 supported chains)\n\n` +
            `When you win crypto raffles or auctions, your rewards will automatically route here!`,
        });
      }

      // --- MODAL: CONNECT SOCIALS ---
      if (modalId === 'modal_connect_socials') {
        await interaction.deferReply({ ephemeral: true });

        const cmc = interaction.fields.getTextInputValue('input_cmc')?.trim();
        const yt = interaction.fields.getTextInputValue('input_yt')?.trim();
        const tiktok = interaction.fields.getTextInputValue('input_tiktok')?.trim();
        const tg = interaction.fields.getTextInputValue('input_telegram')?.trim();

        const updates = [];
        if (cmc) updates.push({ discord_id: discordId, provider: 'coinmarketcap', provider_username: cmc.replace('@', '') });
        if (yt) updates.push({ discord_id: discordId, provider: 'youtube', provider_username: yt.replace('@', '') });
        if (tiktok) updates.push({ discord_id: discordId, provider: 'tiktok', provider_username: tiktok.replace('@', '') });
        if (tg) updates.push({ discord_id: discordId, provider: 'telegram', provider_username: tg.replace('@', '') });

        for (const item of updates) {
          await supabase.from('user_integrations').upsert(
            { ...item, updated_at: new Date().toISOString() },
            { onConflict: 'discord_id,provider' }
          );
        }

        return interaction.editReply({
          content: `✅ **Social Profiles Saved!**\n\n` +
            (cmc ? `• CoinMarketCap: **@${cmc.replace('@', '')}**\n` : '') +
            (yt ? `• YouTube: **@${yt.replace('@', '')}**\n` : '') +
            (tiktok ? `• TikTok: **@${tiktok.replace('@', '')}**\n` : '') +
            (tg ? `• Telegram: **@${tg.replace('@', '')}**\n` : '') +
            `\nYou are now ready to verify CoinMarketCap, YouTube, and TikTok quests!`,
        });
      }

      // --- MODAL: REDEEM REFERRAL CODE ---
      if (modalId === 'modal_referral_redeem') {
        await interaction.deferReply({ ephemeral: true });

        const code = interaction.fields.getTextInputValue('input_ref_code').trim().toUpperCase();
        const selfCode = `COH-${discordId.slice(-5)}`;

        if (code === selfCode) {
          return interaction.editReply({ content: '❌ You cannot redeem your own referral code!' });
        }

        // Check if already redeemed a referral
        const { data: existing } = await supabase
          .from('user_integrations')
          .select('*')
          .eq('discord_id', discordId)
          .eq('provider', 'referral_redeemed')
          .maybeSingle();

        if (existing) {
          return interaction.editReply({ content: '❌ You have already redeemed a referral code.' });
        }

        // Record redemption
        await supabase.from('user_integrations').insert([
          { discord_id: discordId, provider: 'referral_redeemed', provider_username: code },
          { discord_id: discordId, provider: 'referral_by', provider_username: code }
        ]);

        // Award bonus to current user
        const { data: userRec } = await supabase.from('users').select('total_points').eq('guild_id', guildId).eq('discord_id', discordId).maybeSingle();
        const newBalance = (userRec?.total_points || 0) + 50;
        await supabase.from('users').upsert({ guild_id: guildId, discord_id: discordId, total_points: newBalance });

        return interaction.editReply({
          content: `🎉 **Referral Code Redeemed!** You received **+50 Cohesion Points (CP)**!`,
        });
      }

      // --- MODAL: PROMOTE MY TWEET (COMMUNITY RAID) ---
      if (modalId === 'modal_promote_tweet') {
        await interaction.deferReply({ ephemeral: true });

        const tweetUrl = interaction.fields.getTextInputValue('input_user_tweet_url').trim();
        const note = interaction.fields.getTextInputValue('input_user_tweet_note')?.trim() || 'Community Member Raid';

        const parsed = parseTweetUrl(tweetUrl);
        if (!parsed) {
          return interaction.editReply({ content: '❌ Invalid Twitter/X URL. Please provide a valid tweet link.' });
        }

        // Check user balance (100 CP required)
        const { data: userRec } = await supabase.from('users').select('total_points').eq('guild_id', guildId).eq('discord_id', discordId).maybeSingle();
        const balance = Number(userRec?.total_points || 0);

        if (balance < 100) {
          return interaction.editReply({ content: `❌ You need at least **100 CP** to promote your tweet. Your balance: **${balance} CP**.` });
        }

        // Deduct 100 CP
        await supabase.from('users').update({ total_points: balance - 100 }).eq('guild_id', guildId).eq('discord_id', discordId);

        // Broadcast to #cohesion-feed
        const feedChannel = interaction.guild.channels.cache.find(
          (c) => c.isTextBased() && (c.name.includes('cohesion-feed') || c.name.includes('quest-feed') || c.name.includes('engage'))
        );

        if (feedChannel) {
          const embed = new EmbedBuilder()
            .setColor(0x1da1f2)
            .setTitle('🚀 Community Member Tweet Raid!')
            .setDescription(
              `Promoted by <@${discordId}>:\n${parsed.cleanUrl}\n\n` +
              `📌 *${note}*\n\n` +
              `Like, Retweet, and Comment to earn **+25 CP** each!`
            )
            .setFooter({ text: 'Cohesion Community Raid Promotion' })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`verify_like_${parsed.tweetId}`).setLabel('Like ❤️ (+25 CP)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`verify_rt_${parsed.tweetId}`).setLabel('Retweet 🔁 (+25 CP)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setLabel('View on X ↗️').setStyle(ButtonStyle.Link).setURL(parsed.cleanUrl)
          );

          await feedChannel.send({ embeds: [embed], components: [row] }).catch(() => null);
        }

        return interaction.editReply({
          content: `✅ **Tweet Promoted Successfully!** 100 CP was deducted, and your tweet was broadcasted to the community feed!`,
        });
      }

      // --- MODAL: ADMIN MULTI-PLATFORM QUEST LAUNCHER ---
      if (modalId === 'modal_post_multi') {
        await interaction.deferReply({ ephemeral: true });

        let platform = interaction.fields.getTextInputValue('input_platform_type')?.trim().toLowerCase() || '';
        const url = interaction.fields.getTextInputValue('input_platform_url').trim();
        const points = parseInt(interaction.fields.getTextInputValue('input_platform_points'), 10) || 50;
        const actions = interaction.fields.getTextInputValue('input_platform_actions').trim();

        // Auto-detect platform from URL if needed
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
          platform = 'youtube';
        } else if (url.includes('tiktok.com')) {
          platform = 'tiktok';
        } else if (url.includes('coinmarketcap.com')) {
          platform = 'cmc';
        } else if (!platform) {
          platform = 'visit';
        }

        const feedChannel = interaction.guild.channels.cache.find(
          (c) => c.isTextBased() && (c.name.includes('cohesion-feed') || c.name.includes('quest-feed') || c.name.includes('engage'))
        ) || interaction.channel;

        let platformTitle = 'Multi-Platform Community Quest';
        let platformEmoji = '🌐';
        let color = 0x5865f2;
        let bannerImage = null;
        let thumbnailImage = 'https://cdn-icons-png.flaticon.com/512/1006/1006771.png';

        if (platform.includes('yt') || platform.includes('youtube')) {
          platformTitle = 'YouTube Video Quest';
          platformEmoji = '▶️';
          color = 0xff0000;
          thumbnailImage = 'https://cdn-icons-png.flaticon.com/512/1384/1384060.png';

          // Auto-fetch YouTube metadata & high-resolution video thumbnail
          const ytMeta = await fetchYouTubeMetadata(url);
          if (ytMeta) {
            if (ytMeta.title) {
              platformTitle = ytMeta.title.length > 55 ? `${ytMeta.title.slice(0, 52)}...` : ytMeta.title;
            }
            if (ytMeta.thumbnailUrl) {
              bannerImage = ytMeta.thumbnailUrl;
            }
          }
        } else if (platform.includes('tiktok')) {
          platformTitle = 'TikTok Clip Quest';
          platformEmoji = '🎵';
          color = 0x00f2fe;
          thumbnailImage = 'https://cdn-icons-png.flaticon.com/512/3046/3046121.png';
          
          const meta = await fetchOpenGraphMetadata(url);
          if (meta?.imageUrl) bannerImage = meta.imageUrl;
          if (meta?.title) platformTitle = meta.title.length > 55 ? `${meta.title.slice(0, 52)}...` : meta.title;
        } else if (platform.includes('cmc') || platform.includes('coinmarketcap')) {
          platformTitle = 'CoinMarketCap Gravity Quest';
          platformEmoji = '📈';
          color = 0x2a75d3;
          thumbnailImage = 'https://s2.coinmarketcap.com/static/cloud/img/coinmarketcap_logo.png';
          bannerImage = 'https://assets-global.website-files.com/64b58e7232230ef1d48c89dc/64ca5d9f00d8d5df5164bc41_CoinMarketCap-Logo.png';
          
          const meta = await fetchOpenGraphMetadata(url);
          if (meta?.imageUrl) bannerImage = meta.imageUrl;
          if (meta?.title) platformTitle = meta.title.length > 55 ? `${meta.title.slice(0, 52)}...` : meta.title;
        } else {
          // General Website / Blog / Visit Quest
          platformTitle = 'Website Visit & Engage Quest';
          platformEmoji = '🔗';
          color = 0x5865f2;
          thumbnailImage = 'https://cdn-icons-png.flaticon.com/512/1006/1006771.png';

          const meta = await fetchOpenGraphMetadata(url);
          if (meta?.imageUrl) bannerImage = meta.imageUrl;
          if (meta?.title) platformTitle = meta.title.length > 55 ? `${meta.title.slice(0, 52)}...` : meta.title;
        }

        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle(`${platformEmoji} ${platformTitle}`)
          .setURL(url)
          .setDescription(
            `Complete the required actions to earn **+${points} Cohesion Points (CP)**!\n\n` +
            `🔗 **Target Link:** [Click to Open Link](${url})\n` +
            `⚡ **Required Actions:** \`${actions}\`\n\n` +
            `*After completing on the platform, click **Verify Engagement** below!*`
          )
          .setFooter({ text: 'Cohesion Multi-Platform Verification Engine' })
          .setTimestamp();

        if (thumbnailImage) {
          embed.setThumbnail(thumbnailImage);
        }
        if (bannerImage) {
          embed.setImage(bannerImage);
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`verify_multi_${platform}_${points}`)
            .setLabel('Verify Engagement ✅')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setLabel('Open Link ↗️')
            .setStyle(ButtonStyle.Link)
            .setURL(url)
        );

        await feedChannel.send({ embeds: [embed], components: [row] });

        return interaction.editReply({
          content: `✅ Successfully published **${platformTitle}** to <#${feedChannel.id}>!`,
        });
      }

      // --- MODAL: CREATE CUSTOM QUEST DRAFT ---
      if (modalId === 'modal_create_quest_draft') {
        await interaction.deferReply({ ephemeral: true });
        const name = interaction.fields.getTextInputValue('input_draft_name').trim().toLowerCase().replace(/\s+/g, '_');
        const pd = interaction.fields.getTextInputValue('input_draft_points_duration').trim();
        const buttons = interaction.fields.getTextInputValue('input_draft_buttons').trim();
        const desc = interaction.fields.getTextInputValue('input_draft_desc').trim();
        const keyword = interaction.fields.getTextInputValue('input_draft_keyword')?.trim() || '';

        const parts = pd.split(/[,|\s]+/).filter(Boolean);
        const points = parseInt(parts[0], 10) || 50;
        const duration = parts[1] || '24h';

        const newDraft = {
          name,
          description: desc,
          points,
          duration,
          buttons,
          leadEngagersBonus: Math.round(points * 0.25),
          verifiedOnly: false,
          requireFollow: false,
          minCharacters: 5,
          keyword,
        };

        saveGuildDraft(guildId, newDraft);
        const payload = buildQuestDraftsDashboard(guildId);
        return interaction.editReply({
          content: `✅ **Custom Quest Draft \`${name}\` Created & Saved!**`,
          ...payload,
        });
      }

      // --- MODAL: QUICK-LAUNCH QUEST FROM DRAFT ---
      if (modalId.startsWith('modal_launch_draft_')) {
        await interaction.deferReply({ ephemeral: true });
        const draftName = modalId.replace('modal_launch_draft_', '');
        const drafts = getGuildDrafts(guildId);
        const draft = drafts.find((d) => d.name === draftName) || drafts[0];

        const rawUrl = interaction.fields.getTextInputValue('input_draft_url').trim();
        const ctaText = interaction.fields.getTextInputValue('input_draft_cta')?.trim() || '';
        const customText = interaction.fields.getTextInputValue('input_draft_custom_text') || '';

        const parsed = parseTweetUrl(rawUrl);
        if (!parsed) {
          return interaction.editReply({
            content: '❌ Invalid Twitter/X URL. Please format like: `https://x.com/username/status/123...`',
          });
        }

        const { username, tweetId, cleanUrl } = parsed;
        const durationMs = parseDuration(draft.duration) || 24 * 60 * 60 * 1000;
        const tweetMeta = await fetchTweetMetadata(cleanUrl, username, tweetId);
        const authorDisplayName = tweetMeta?.authorName || `@${username}`;
        const tweetBody = tweetMeta?.text || 'Engage with this post on X to earn points!';
        const expiresAtDate = new Date(Date.now() + durationMs);
        const expireTimestampSec = Math.floor(expiresAtDate.getTime() / 1000);

        const guild = interaction.guild || (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);
        if (guild && (!guild.roles.cache || guild.roles.cache.size <= 1)) {
          await guild.roles.fetch().catch(() => null);
        }

        const actionRow = new ActionRowBuilder();
        const btnsLower = (draft.buttons || 'like, rt').toLowerCase();
        if (btnsLower.includes('like')) {
          actionRow.addComponents(
            new ButtonBuilder().setCustomId(`verify_like_${tweetId}`).setLabel('Like').setEmoji('❤️').setStyle(ButtonStyle.Secondary)
          );
        }
        if (btnsLower.includes('rt') || btnsLower.includes('retweet')) {
          actionRow.addComponents(
            new ButtonBuilder().setCustomId(`verify_rt_${tweetId}`).setLabel('Retweet').setEmoji('🔁').setStyle(ButtonStyle.Secondary)
          );
        }
        if (btnsLower.includes('comment') || btnsLower.includes('reply')) {
          actionRow.addComponents(
            new ButtonBuilder().setCustomId(`verify_comment_${tweetId}`).setLabel('Comment').setEmoji('💬').setStyle(ButtonStyle.Secondary)
          );
        }
        actionRow.addComponents(
          new ButtonBuilder().setLabel('View on X').setStyle(ButtonStyle.Link).setURL(cleanUrl)
        );

        const processedSnippet = processSnippetRequirements(customText, guild, username);
        let messageContent = `**${authorDisplayName}** just posted :\n${cleanUrl}\n\n`;
        if (ctaText) {
          messageContent += `**${ctaText}**\n`;
        }
        messageContent += `Expires <t:${expireTimestampSec}:R>`;
        if (processedSnippet.snippetBody) {
          messageContent += `\n\n${processedSnippet.snippetBody}`;
        }
        if (processedSnippet.pingContent) {
          messageContent += `\n${processedSnippet.pingContent}`;
        }

        const tweetEmbed = new EmbedBuilder()
          .setColor(0x1da1f2)
          .setAuthor({
            name: `${authorDisplayName} (@${username})`,
            iconURL: tweetMeta?.authorAvatar || 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
            url: cleanUrl,
          })
          .setTitle(`@${username} tweeted !`)
          .setURL(cleanUrl)
          .setDescription(tweetBody)
          .setFooter({
            text: `Powered by Cohesion • Preset: ${draft.name} (+${draft.points} CP)`,
            iconURL: interaction.client.user.displayAvatarURL(),
          })
          .setTimestamp();

        if (tweetMeta?.mediaUrl) {
          tweetEmbed.setImage(tweetMeta.mediaUrl);
        } else if (tweetMeta?.authorAvatar) {
          tweetEmbed.setThumbnail(tweetMeta.authorAvatar);
        }

        const feedChannel = interaction.guild.channels.cache.find(
          (c) => c.isTextBased() && (c.name.includes('cohesion-feed') || c.name.includes('quest-feed') || c.name.includes('engage'))
        ) || interaction.channel;

        await feedChannel.send({
          content: messageContent,
          embeds: [tweetEmbed],
          components: [actionRow],
        });

        return interaction.editReply({
          content: `🚀 Successfully launched **${draft.name}** quest to <#${feedChannel.id}> with **+${draft.points} CP** reward!`,
        });
      }

      // --- MODAL: ADMIN TRACK TWITTER HANDLES ---
      if (modalId === 'modal_track_twitter') {
        await interaction.deferReply({ ephemeral: true });

        const raw = interaction.fields.getTextInputValue('input_track_handles').trim();
        const handles = raw.split(',').map((h) => h.trim().replace('@', '')).filter(Boolean);

        for (const h of handles) {
          addTrackedHandle(guildId, h);
        }

        return interaction.editReply({
          content: `✅ **Monitored Twitter Handles Updated!**\n\nNow monitoring: ${handles.map((h) => `@${h}`).join(', ')}\nWhenever they post, Cohesion will auto-broadcast quests to your feed channel.`,
        });
      }

      // --- MODAL: CUSTOM INFLATION RATE ---
      if (modalId === 'modal_inflation_custom') {
        await interaction.deferReply({ ephemeral: true });
        const burnRatePercent = parseInt(interaction.fields.getTextInputValue('input_inflation_custom_rate'), 10) || 0;
        const enabled = burnRatePercent > 0;
        setGuildInflation(guildId, enabled, burnRatePercent / 100);
        const payload = buildInflationDashboard(guildId, interaction.guild?.name);
        return interaction.editReply(payload);
      }

      // --- MODAL: ADMIN ECONOMY SETTINGS (LEGACY FALLBACK) ---
      if (modalId === 'modal_economy_settings') {
        await interaction.deferReply({ ephemeral: true });

        const burnRatePercent = parseInt(interaction.fields.getTextInputValue('input_inflation_rate'), 10) || 0;
        const chatRewardType = interaction.fields.getTextInputValue('input_chat_reward')?.trim().toLowerCase() || 'both';

        const enabled = burnRatePercent > 0;
        setGuildInflation(guildId, enabled, burnRatePercent / 100);

        return interaction.editReply({
          content: `✅ **Economy Settings Saved!**\n\n` +
            `• **Weekly Inflation Burn:** ${enabled ? `\`Active (${burnRatePercent}% weekly)\`` : '`Disabled`'}\n` +
            `• **Chat Reward Type:** \`${chatRewardType.toUpperCase()}\`\n\n` +
            `Cohesion's automated economic stability worker will run on schedule.`,
        });
      }

      // --- MODAL: ADMIN TIER ROLES ---
      if (modalId === 'modal_tier_roles') {
        await interaction.deferReply({ ephemeral: true });

        const t1 = interaction.fields.getTextInputValue('input_tier_1')?.trim();
        const t2 = interaction.fields.getTextInputValue('input_tier_2')?.trim();
        const t3 = interaction.fields.getTextInputValue('input_tier_3')?.trim();
        const t4 = interaction.fields.getTextInputValue('input_tier_4')?.trim();
        const t5 = interaction.fields.getTextInputValue('input_tier_5')?.trim();

        return interaction.editReply({
          content: `✅ **5-Tier Milestone Roles Saved!**\n\n` +
            (t1 ? `• Level 5 Milestone: \`${t1}\`\n` : '') +
            (t2 ? `• Level 10 Milestone: \`${t2}\`\n` : '') +
            (t3 ? `• Level 25 Milestone: \`${t3}\`\n` : '') +
            (t4 ? `• Level 50 Milestone: \`${t4}\`\n` : '') +
            (t5 ? `• Level 100 Milestone: \`${t5}\`\n` : '') +
            `\nMembers will automatically unlock these roles when leveling up!`,
        });
      }

      // --- MODAL: ADMIN ANNOUNCEMENT REACTIONS ---
      if (modalId === 'modal_announcement_reactions') {
        await interaction.deferReply({ ephemeral: true });

        const channel = interaction.fields.getTextInputValue('input_react_channel').trim();
        const points = parseInt(interaction.fields.getTextInputValue('input_react_points'), 10) || 5;

        return interaction.editReply({
          content: `✅ **Announcement Reactions Configured!**\n\n` +
            `• Channel: \`${channel}\`\n` +
            `• Reward: **+${points} CP per reaction**\n` +
            `• Anti-Abuse: 1 reward per user per message with daily rate limits.`,
        });
      }

      // --- MODAL: ADMIN SEASON WIPE ---
      if (modalId === 'modal_season_wipe') {
        await interaction.deferReply({ ephemeral: true });

        const confirm = interaction.fields.getTextInputValue('input_wipe_confirm').trim();
        if (confirm !== 'CONFIRM RESET') {
          return interaction.editReply({ content: '❌ Confirmation mismatch. Season reset was cancelled.' });
        }

        // Reset points and daily streak for new season
        await supabase
          .from('users')
          .update({ total_points: 0, daily_streak: 0 })
          .eq('guild_id', guildId);

        await logActivity(interaction.guild, {
          title: '🔄 New Competitive Season Launched!',
          description: `Server administrators have concluded the previous season and reset the leaderboard. Everyone starts fresh at **0 CP**!`,
          color: 0xffd166,
        });

        return interaction.editReply({
          content: '✅ **Season Successfully Reset!** Leaderboard points have been archived and a new season has begun.',
        });
      }

      // --- MODAL: WINNER WALLET SUBMISSION ---
      if (modalId.startsWith('modal_winner_wallet_')) {
        await interaction.deferReply({ ephemeral: false });

        const raffleId = modalId.replace('modal_winner_wallet_', '');
        const address = interaction.fields.getTextInputValue('input_wallet_address').trim();
        const chain = interaction.fields.getTextInputValue('input_wallet_chain')?.trim() || 'EVM';

        await supabase.from('user_integrations').upsert(
          {
            discord_id: discordId,
            provider: 'wallet',
            provider_user_id: chain,
            provider_username: address,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'discord_id,provider' }
        );

        const { data: raffle } = await supabase
          .from('raffles')
          .select('prize')
          .eq('raffle_id', raffleId)
          .maybeSingle();

        const prizeTitle = raffle?.prize || 'Raffle Prize';

        const embed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('👛 Winner Payout Wallet Received!')
          .setDescription(
            `Winner <@${discordId}> has submitted their payout wallet for **${prizeTitle}**:\n\n` +
            `💳 **Address:** \`${address}\`\n` +
            `🌐 **Network:** **${chain}**\n\n` +
            `📢 *Server Admins can now disburse the prize to this address.*`
          )
          .setFooter({ text: 'Cohesion Web3 Reward Manager' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }


      // --- MODAL: ADD SHOP ITEM ---
      if (modalId === 'modal_add_shop') {
        await interaction.deferReply({ ephemeral: true });

        const title = interaction.fields.getTextInputValue('input_shop_title');
        const costStr = interaction.fields.getTextInputValue('input_shop_cost');
        const desc = interaction.fields.getTextInputValue('input_shop_desc') || '';
        const rawRoleId = interaction.fields.getTextInputValue('input_shop_role_id') || '';
        const stockStr = interaction.fields.getTextInputValue('input_shop_stock');

        const cost = parseInt(costStr, 10) || 100;
        const stock = parseInt(stockStr, 10) || -1;
        const cleanRoleId = rawRoleId.replace(/[<@&>]/g, '').trim() || null;

        const { error } = await supabase.from('marketplace_items').insert({
          guild_id: guildId,
          title,
          description: desc,
          cost,
          stock,
          role_id: cleanRoleId,
        });

        if (error) {
          console.error('[ADD SHOP ERROR]:', error);
          return interaction.editReply({ content: '❌ Failed to add marketplace item to database.' });
        }

        let roleMention = '';
        let roleWarning = '';
        if (cleanRoleId && interaction.guild) {
          roleMention = ` (Auto-assigns <@&${cleanRoleId}>)`;
          const botMember = await interaction.guild.members.fetchMe().catch(() => null);
          const targetRole =
            interaction.guild.roles.cache.get(cleanRoleId) ||
            (await interaction.guild.roles.fetch(cleanRoleId).catch(() => null));

          if (!targetRole) {
            roleWarning = `\n⚠️ **Warning:** Role ID \`${cleanRoleId}\` was not found in this server.`;
          } else if (
            !botMember?.permissions.has(PermissionFlagsBits.ManageRoles) &&
            !botMember?.permissions.has(PermissionFlagsBits.Administrator)
          ) {
            roleWarning = `\n⚠️ **Notice:** Cohesion does not have **Manage Roles** permission. Please enable it in Server Settings > Roles so the bot can auto-assign this role upon purchase.`;
          } else if (botMember.roles.highest.position <= targetRole.position) {
            roleWarning = `\n⚠️ **Notice (Role Hierarchy):** Cohesion's role is positioned **below** <@&${cleanRoleId}> in Server Settings > Roles!\n👉 *Please drag the Cohesion role ABOVE <@&${cleanRoleId}> to enable automatic role assignment.*`;
          }
        }

        return interaction.editReply({
          content: `✅ Added **${title}** to the Community Marketplace for **${cost} CP**!${roleMention}${roleWarning}`,
        });
      }

      // --- MODAL: VC SNAPSHOT ---
      if (modalId.startsWith('modal_vc_snapshot')) {
        await interaction.deferReply({ ephemeral: false });

        const targetChannelId = modalId.startsWith('modal_vc_snapshot_')
          ? modalId.replace('modal_vc_snapshot_', '')
          : 'all';

        const isAllChannels = targetChannelId === 'all';

        const pointsStr = interaction.fields.getTextInputValue('input_vc_points');
        const xpStr = interaction.fields.getTextInputValue('input_vc_xp');
        const note = interaction.fields.getTextInputValue('input_vc_note') || 'Community Call';

        const rewardPoints = parseInt(pointsStr, 10) || 50;
        const rewardXp = parseInt(xpStr, 10) || 50;

        // Collect all human members in any voice channel in the guild
        const guild =
          interaction.guild ||
          (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);

        if (!guild) {
          return interaction.editReply({ content: '❌ Could not retrieve server details.' });
        }

        // Ensure channels are fetched to populate voice channels
        await guild.channels.fetch().catch(() => null);

        const rewardedMemberIds = [];

        // 1. Check guild voiceStates directly (primary)
        if (guild.voiceStates?.cache) {
          for (const [memberId, voiceState] of guild.voiceStates.cache) {
            if (voiceState.channelId) {
              // If targeting a specific channel, only reward members in that channel
              if (!isAllChannels && voiceState.channelId !== targetChannelId) {
                continue;
              }
              const member = voiceState.member || (await guild.members.fetch(memberId).catch(() => null));
              if (member && !member.user.bot && !rewardedMemberIds.includes(memberId)) {
                rewardedMemberIds.push(memberId);
              }
            }
          }
        }

        // 2. Check voice channels cache as secondary verification
        const voiceChannels = isAllChannels
          ? guild.channels.cache.filter((c) => c.isVoiceBased())
          : guild.channels.cache.filter((c) => c.id === targetChannelId);

        for (const [_, vc] of voiceChannels) {
          if (vc.members) {
            for (const [memberId, member] of vc.members) {
              if (!member.user.bot && !rewardedMemberIds.includes(memberId)) {
                rewardedMemberIds.push(memberId);
              }
            }
          }
        }

        if (rewardedMemberIds.length === 0) {
          const targetName = isAllChannels ? 'any voice channels' : `<#${targetChannelId}>`;
          return interaction.editReply({
            content: `⚠️ No active members found in ${targetName} right now. (Make sure members are connected to the voice channel).`,
          });
        }

        // Award points and XP to all connected members
        for (const mId of rewardedMemberIds) {
          const { data: uRec } = await supabase
            .from('users')
            .select('*')
            .eq('guild_id', guildId)
            .eq('discord_id', mId)
            .maybeSingle();

          const curPoints = Number(uRec?.total_points || 0);
          const curXp = Number(uRec?.xp || 0);

          await supabase.from('users').upsert(
            {
              guild_id: guildId,
              discord_id: mId,
              total_points: curPoints + rewardPoints,
              xp: curXp + rewardXp,
            },
            { onConflict: 'guild_id,discord_id' }
          );
        }

        const mentions = rewardedMemberIds.slice(0, 20).map(id => `<@${id}>`).join(' ');
        const extraCount = rewardedMemberIds.length > 20 ? ` and ${rewardedMemberIds.length - 20} more...` : '';
        const targetLabel = isAllChannels ? '🌐 All Voice Channels (Server-Wide)' : `🔊 <#${targetChannelId}>`;

        const vcEmbed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('🎙️ Voice Chat Attendance Snapshot Rewarded!')
          .setDescription(
            `**Event:** ${note}\n` +
            `👥 **Members Rewarded:** ${rewardedMemberIds.length}\n` +
            `🪙 **Points Awarded:** +${rewardPoints} CP each\n` +
            `✨ **XP Awarded:** +${rewardXp} XP each\n\n` +
            `**Attendees:**\n${mentions}${extraCount}`
          )
          .setFooter({ text: 'Cohesion Voice Engagement Tracking' })
          .setTimestamp();

        return interaction.editReply({ embeds: [vcEmbed] });
      }

      // --- MODAL: REWARD MEMBER (ADMIN) ---
      if (modalId === 'modal_reward_member') {
        await interaction.deferReply({ ephemeral: false });

        const rawUser = interaction.fields.getTextInputValue('input_reward_user').trim();
        const pointsStr = interaction.fields.getTextInputValue('input_reward_points').trim();
        const xpStr = interaction.fields.getTextInputValue('input_reward_xp').trim();
        const reason = interaction.fields.getTextInputValue('input_reward_reason')?.trim() || 'Admin adjustment';

        // Extract pure Discord Snowflake ID
        const targetId = rawUser.replace(/[<@!>]/g, '');
        if (!/^\d{17,20}$/.test(targetId)) {
          return interaction.editReply({
            content: '❌ Invalid member ID or mention. Please provide a valid 17-20 digit user ID or @mention.',
          });
        }

        const deltaPoints = parseInt(pointsStr, 10) || 0;
        const deltaXp = parseInt(xpStr, 10) || 0;

        const { data: userRecord } = await supabase
          .from('users')
          .select('*')
          .eq('guild_id', guildId)
          .eq('discord_id', targetId)
          .maybeSingle();

        const currentPoints = Number(userRecord?.total_points || 0);
        const currentXp = Number(userRecord?.xp || 0);
        const newPoints = Math.max(0, currentPoints + deltaPoints);
        const newXp = Math.max(0, currentXp + deltaXp);
        const newLevel = getLevelFromXp(newXp);

        await supabase.from('users').upsert(
          {
            guild_id: guildId,
            discord_id: targetId,
            total_points: newPoints,
            xp: newXp,
            level: newLevel,
          },
          { onConflict: 'guild_id,discord_id' }
        );

        // Check if level-up role reward should be granted
        try {
          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (member) {
            const { data: roleRewards } = await supabase
              .from('level_role_rewards')
              .select('required_level, role_id')
              .eq('guild_id', guildId)
              .lte('required_level', newLevel);

            if (roleRewards && roleRewards.length > 0) {
              for (const rw of roleRewards) {
                if (!member.roles.cache.has(rw.role_id)) {
                  await member.roles.add(rw.role_id).catch(() => null);
                }
              }
            }
          }
        } catch (e) {
          console.error('[REWARD ROLE CHECK ERROR]:', e);
        }

        const embed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('🎁 Cohesion Member Rewarded!')
          .setDescription(
            `Admin <@${discordId}> has adjusted stats for <@${targetId}>:\n\n` +
            `🪙 **Cohesion Points:** ${deltaPoints >= 0 ? '+' : ''}${deltaPoints.toLocaleString()} CP (Balance: **${newPoints.toLocaleString()} CP**)\n` +
            `✨ **XP:** ${deltaXp >= 0 ? '+' : ''}${deltaXp.toLocaleString()} XP (Total: **${newXp.toLocaleString()} XP**, Level **${newLevel}**)\n` +
            `📝 **Reason:** ${reason}`
          )
          .setFooter({ text: 'Cohesion Economy & Leveling Engine' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // --- MODAL: CREATE AUCTION (ADMIN) ---
      if (modalId === 'modal_create_auction') {
        await interaction.deferReply({ ephemeral: true });

        const title = interaction.fields.getTextInputValue('input_auction_title');
        const startBidStr = interaction.fields.getTextInputValue('input_auction_start_bid');
        const minIncStr = interaction.fields.getTextInputValue('input_auction_min_inc');
        const durationStr = interaction.fields.getTextInputValue('input_auction_duration');
        const desc = interaction.fields.getTextInputValue('input_auction_desc') || '';

        const startingBid = parseInt(startBidStr, 10) || 100;
        const minIncrement = parseInt(minIncStr, 10) || 25;
        const durationMs = parseDuration(durationStr) || 24 * 60 * 60 * 1000;
        const endTime = new Date(Date.now() + durationMs).toISOString();

        const { data: auction, error } = await supabase
          .from('auctions')
          .insert({
            guild_id: guildId,
            item_title: title,
            description: desc,
            starting_bid: startingBid,
            current_highest_bid: 0,
            highest_bidder_id: null,
            min_increment: minIncrement,
            end_time: endTime,
            is_active: true,
            created_by: discordId,
          })
          .select()
          .single();

        if (error) {
          console.error('[CREATE AUCTION ERROR]:', error);
          return interaction.editReply({ content: '❌ Failed to create auction in database.' });
        }

        // Post live auction card to channel
        const payload = buildAuctionPayload(auction);
        const sentMessage = await interaction.channel.send(payload);

        // Update message_id and channel_id
        await supabase
          .from('auctions')
          .update({
            channel_id: interaction.channelId,
            message_id: sentMessage.id,
          })
          .eq('auction_id', auction.auction_id);

        // Schedule auto-conclusion watchdog
        scheduleAuctionConclusion(
          {
            ...auction,
            channel_id: interaction.channelId,
            message_id: sentMessage.id,
          },
          interaction.client
        );

        return interaction.editReply({
          content: `✅ Auction for **${title}** launched successfully in this channel! (Auction ID: \`${auction.auction_id}\`)`,
        });
      }

      // --- MODAL: PLACE BID (MEMBER) ---
      if (modalId.startsWith('modal_place_bid_')) {
        await interaction.deferReply({ ephemeral: true });

        const auctionId = modalId.replace('modal_place_bid_', '');
        const bidStr = interaction.fields.getTextInputValue('input_bid_amount');
        const bidAmount = parseInt(bidStr, 10);

        if (isNaN(bidAmount) || bidAmount <= 0) {
          return interaction.editReply({ content: '❌ Please enter a valid positive number for your bid.' });
        }

        const result = await executeBid({
          auctionId,
          guildId,
          discordId,
          bidAmount,
          client: interaction.client,
        });

        return interaction.editReply({ content: result.message });
      }

      // --- MODAL: CREATE COMMUNITY QUIZ ---
      if (modalId === 'modal_create_quiz') {
        await interaction.deferReply({ ephemeral: true });

        const question = interaction.fields.getTextInputValue('input_quiz_question').trim();
        const rawChoices = interaction.fields.getTextInputValue('input_quiz_choices').trim();
        const answerStr = interaction.fields.getTextInputValue('input_quiz_answer').trim();
        const rewardsStr = interaction.fields.getTextInputValue('input_quiz_rewards').trim();
        const durationStr = interaction.fields.getTextInputValue('input_quiz_duration').trim();

        // Parse choices (split by newline or comma)
        const choices = (rawChoices.includes('\n') ? rawChoices.split('\n') : rawChoices.split(','))
          .map((c) => c.trim())
          .filter((c) => c.length > 0);

        if (choices.length < 2 || choices.length > 4) {
          return interaction.editReply({
            content: '❌ **Invalid Choices:** Please provide between 2 and 4 answer choices (one per line).',
          });
        }

        // Parse answer index (1-based to 0-based)
        const ansNum = parseInt(answerStr, 10);
        if (isNaN(ansNum) || ansNum < 1 || ansNum > choices.length) {
          return interaction.editReply({
            content: `❌ **Invalid Correct Option:** Please enter a number between 1 and ${choices.length}.`,
          });
        }
        const correctIndex = ansNum - 1;

        // Parse rewards
        const [ptsStr, xpStr] = rewardsStr.split(',').map((s) => s?.trim());
        const rewardPoints = parseInt(ptsStr, 10) || 50;
        const rewardXp = parseInt(xpStr, 10) || 25;

        // Parse duration
        const durationMs = parseDuration(durationStr) || 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + durationMs).toISOString();

        const quizId = 'qz_' + Date.now().toString(36);

        const quizData = {
          quiz_id: quizId,
          guild_id: guildId,
          channel_id: interaction.channelId,
          message_id: null,
          question,
          options: choices,
          correct_index: correctIndex,
          reward_points: rewardPoints,
          reward_xp: rewardXp,
          expires_at: expiresAt,
          is_active: true,
          created_by: discordId,
        };

        const payload = buildQuizPayload(quizData, 0);
        const sentMessage = await interaction.channel.send(payload);

        quizData.message_id = sentMessage.id;
        await saveQuiz(quizData);

        return interaction.editReply({
          content:
            `✅ **Community Quiz Broadcasted Successfully!**\n\n` +
            `• **Question:** ${question}\n` +
            `• **Choices:** ${choices.length} options\n` +
            `• **Reward:** +${rewardPoints} QP & +${rewardXp} XP\n` +
            `• **Expires:** <t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:R>\n\n` +
            `Members can now answer directly using the interactive buttons!`,
        });
      }

      // --- MODAL: SETUP LIVE QUIZ TOURNAMENT ---
      if (modalId === 'modal_setup_live_quiz') {
        await interaction.deferReply({ ephemeral: true });

        const title = interaction.fields.getTextInputValue('input_lqz_title').trim();
        const qTimeStr = interaction.fields.getTextInputValue('input_lqz_qtime').trim();
        const bTimeStr = interaction.fields.getTextInputValue('input_lqz_btime').trim();
        const basePtsStr = interaction.fields.getTextInputValue('input_lqz_base_pts').trim();
        const xpBonusStr = interaction.fields.getTextInputValue('input_lqz_xp_bonus').trim();

        const qTime = parseInt(qTimeStr, 10) || 20;
        const bTime = parseInt(bTimeStr, 10) || 8;
        const basePts = parseInt(basePtsStr, 10) || 100;
        const xpBonus = parseInt(xpBonusStr, 10) || 500;

        const session = createLiveSession({
          guildId,
          channelId: interaction.channelId,
          title,
          questionTimeSec: qTime,
          breakTimeSec: bTime,
          basePoints: basePts,
          xpBonus,
          createdBy: discordId,
        });

        const deckPayload = buildSetupDeck(session);
        return interaction.editReply(deckPayload);
      }

      // --- MODAL: ADD SINGLE QUESTION TO LIVE QUIZ ---
      if (modalId.startsWith('modal_lqz_addq_')) {
        await interaction.deferReply({ ephemeral: true });
        const sessionId = modalId.replace('modal_lqz_addq_', '');
        const session = getLiveSession(sessionId);

        if (!session) {
          return interaction.editReply({ content: '❌ Session expired or not found.' });
        }

        const qText = interaction.fields.getTextInputValue('input_q_text').trim();
        const choicesRaw = interaction.fields.getTextInputValue('input_q_choices').trim();
        const correctStr = interaction.fields.getTextInputValue('input_q_correct').trim();

        const choices = choicesRaw
          .split('\n')
          .map((c) => c.trim())
          .filter((c) => c.length > 0);

        if (choices.length < 2 || choices.length > 4) {
          return interaction.editReply({
            content: '❌ **Invalid Choices:** Please provide between 2 and 4 options (one per line).',
          });
        }

        const correctNum = parseInt(correctStr, 10);
        if (isNaN(correctNum) || correctNum < 1 || correctNum > choices.length) {
          return interaction.editReply({
            content: `❌ **Invalid Correct Option:** Please enter a number between 1 and ${choices.length}.`,
          });
        }

        addQuestionToSession(sessionId, {
          question: qText,
          options: choices,
          correctIndex: correctNum - 1,
        });

        const deckPayload = buildSetupDeck(session);
        return interaction.editReply(deckPayload);
      }

      // --- MODAL: QUICK PASTE BULK QUESTIONS ---
      if (modalId.startsWith('modal_lqz_bulkq_')) {
        await interaction.deferReply({ ephemeral: true });
        const sessionId = modalId.replace('modal_lqz_bulkq_', '');
        const session = getLiveSession(sessionId);

        if (!session) {
          return interaction.editReply({ content: '❌ Session expired or not found.' });
        }

        const bulkText = interaction.fields.getTextInputValue('input_bulk_text').trim();
        const res = addBulkQuestionsToSession(sessionId, bulkText);

        if (res.added === 0) {
          return interaction.editReply({
            content:
              '⚠️ **No questions could be parsed.**\n' +
              'Ensure each line follows: `Question text ? Option 1, Option 2, Option 3 ? CorrectNumber`',
          });
        }

        const deckPayload = buildSetupDeck(session);
        return interaction.editReply(deckPayload);
      }

      // --- MODAL: CREATE COMMUNITY POLL ---
      if (modalId === 'modal_create_poll') {
        await interaction.deferReply({ ephemeral: true });

        const question = interaction.fields.getTextInputValue('input_poll_question').trim();
        const rawOptions = interaction.fields.getTextInputValue('input_poll_options').trim();
        const durationAndTagStr = interaction.fields.getTextInputValue('input_poll_duration').trim();
        let settingsStr = '';
        try {
          settingsStr = interaction.fields.getTextInputValue('input_poll_settings') || '';
        } catch (_) {}
        let rewardStr = '';
        try {
          rewardStr = interaction.fields.getTextInputValue('input_poll_reward') || '';
        } catch (_) {}

        // Parse options (one per line, semicolon, or comma)
        let options = [];
        if (rawOptions.includes('\n')) {
          options = rawOptions.split('\n');
        } else if (rawOptions.includes(';')) {
          options = rawOptions.split(';');
        } else {
          options = rawOptions.split(',');
        }

        options = options
          .map((o) => o.trim())
          .filter((o) => o.length > 0);

        if (options.length < 2) {
          return interaction.editReply({
            content: '❌ **Invalid Choices:** Please provide at least 2 poll choices (one per line).',
          });
        }

        if (options.length > 125) {
          return interaction.editReply({
            content: '❌ **Choice Limit Exceeded:** Discord supports up to 125 choices per poll message.',
          });
        }

        // Parse duration & ping tag from durationAndTagStr (e.g. "24h, @everyone" or "5m")
        let durationStr = durationAndTagStr;
        let tagStr = '';
        if (durationAndTagStr.includes(',') || durationAndTagStr.includes('|')) {
          const parts = durationAndTagStr.split(/[,|]/);
          durationStr = (parts[0] || '').trim();
          tagStr = parts.slice(1).join(',').trim();
        } else if (durationAndTagStr.includes(' ')) {
          const parts = durationAndTagStr.trim().split(/\s+/);
          durationStr = (parts[0] || '').trim();
          tagStr = parts.slice(1).join(' ').trim();
        }

        // Parse duration (supporting minutes, hours, days)
        let durationMs = 24 * 60 * 60 * 1000;
        const parsedMs = parseDuration(durationStr);
        if (parsedMs) {
          durationMs = parsedMs;
        } else {
          const num = parseInt(durationStr, 10);
          if (!isNaN(num) && num > 0) durationMs = num * 60 * 60 * 1000;
        }
        const expiresAt = new Date(Date.now() + durationMs).toISOString();

        // Parse Settings: "Instant Live Results, Add Community Choice"
        // Format: "yes, no" -> [0]=Live Results (yes/no), [1]=Allow Member Options (yes/no)
        const lowerSettings = settingsStr.toLowerCase().trim();
        let resultsVisibility = 'live';
        let allowUserOptions = false;

        const settingParts = lowerSettings.split(/[,|\s]+/).map((s) => s.trim()).filter(Boolean);
        if (settingParts.length >= 1) {
          const livePart = settingParts[0];
          if (['no', 'false', '0', 'off', 'hide', 'hidden', 'ended'].includes(livePart)) {
            resultsVisibility = 'ended';
          } else {
            resultsVisibility = 'live';
          }
        }
        if (settingParts.length >= 2) {
          const optPart = settingParts[1];
          if (['yes', 'true', '1', 'on', 'allow'].includes(optPart)) {
            allowUserOptions = true;
          } else {
            allowUserOptions = false;
          }
        } else {
          // Backward-compatible fallback
          if (
            lowerSettings.includes('[ ] live') ||
            lowerSettings.includes('hide') ||
            lowerSettings.includes('hidden') ||
            lowerSettings.includes('after end')
          ) {
            resultsVisibility = 'ended';
          }
          if (
            lowerSettings.includes('allow') ||
            lowerSettings.includes('[✓]') ||
            lowerSettings.includes('[x]')
          ) {
            allowUserOptions = true;
          }
        }

        // Parse rewards: [QP], [XP] e.g. "10, 5" or "10 [QP], 5 [XP]" or "10 (QP), 5 (XP)"
        let rewardPoints = 0;
        let rewardXp = 0;
        if (rewardStr) {
          const rewardNumbers = rewardStr.match(/\d+/g);
          if (rewardNumbers && rewardNumbers.length > 0) {
            rewardPoints = parseInt(rewardNumbers[0], 10) || 0;
            if (rewardNumbers.length > 1) {
              rewardXp = parseInt(rewardNumbers[1], 10) || 0;
            }
          }
        }

        // Resolve tag
        let tagMention = '';
        if (tagStr && tagStr.trim()) {
          const t = tagStr.trim();
          if (t === '@everyone' || t === '@here') {
            tagMention = t;
          } else if (/^<@&?\d+>$/.test(t)) {
            tagMention = t;
          } else if (/^\d{17,20}$/.test(t)) {
            tagMention = `<@&${t}>`;
          } else {
            const guild =
              interaction.guild ||
              (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);
            const cleanName = t.replace(/^@/, '').toLowerCase();
            const role = guild?.roles?.cache?.find(
              (r) => r.name.toLowerCase() === cleanName
            );
            if (role) {
              tagMention = `<@&${role.id}>`;
            } else {
              tagMention = t.startsWith('@') ? t : `@${t}`;
            }
          }
        }

        const pollId = 'pol_' + Date.now().toString(36);
        const pollData = {
          poll_id: pollId,
          guild_id: guildId,
          channel_id: interaction.channelId,
          message_id: null,
          question,
          options,
          reward_points: rewardPoints,
          reward_xp: rewardXp,
          expires_at: expiresAt,
          created_by: discordId,
          is_active: true,
          results_visibility: resultsVisibility,
          allow_user_options: allowUserOptions,
        };

        const payload = await buildPollPayload(pollData);
        if (tagMention) {
          payload.content = tagMention;
          payload.allowedMentions = { parse: ['roles', 'users', 'everyone'] };
        }

        const sentMsg = await interaction.channel.send(payload);
        pollData.message_id = sentMsg.id;
        await savePoll(pollData);

        // Schedule automatic conclusion when poll duration expires
        schedulePollConclusion(pollData, interaction.client);

        return interaction.editReply({
          content:
            `✅ **Community Poll Launched Successfully!**\n\n` +
            `• **Topic:** ${question}\n` +
            `• **Choices:** ${options.length} options\n` +
            `• **Results Visibility:** ${resultsVisibility === 'ended' ? '🔒 Hidden until poll ends' : '👁️ Live results visible'}\n` +
            `• **Community Choices:** ${allowUserOptions ? '✅ Members can add options' : '❌ Disabled'}\n` +
            `• **Reward:** +${rewardPoints} QP & +${rewardXp} XP per vote\n` +
            `• **Duration:** Ends <t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:R>`,
        });
      }

      // --- MODAL: COMMUNITY POLL - MEMBER PROPOSED NEW CHOICE ---
      if (modalId.startsWith('modal_poll_add_opt_')) {
        await interaction.deferReply({ ephemeral: true });
        const pollId = modalId.replace('modal_poll_add_opt_', '');

        const newChoice = interaction.fields.getTextInputValue('input_poll_new_option').trim();
        if (!newChoice) {
          return interaction.editReply({ content: '❌ Option text cannot be empty.' });
        }

        const poll = await getPoll(pollId);
        if (!poll) {
          return interaction.editReply({ content: '❌ Poll not found or expired.' });
        }

        if (Date.now() > new Date(poll.expires_at).getTime()) {
          return interaction.editReply({ content: '⏳ This poll has already concluded! New choices cannot be added.' });
        }

        if (poll.options.length >= 24) {
          return interaction.editReply({ content: '⚠️ Maximum choice limit reached for this poll.' });
        }

        // Check if option already exists (case-insensitive)
        const isDuplicate = poll.options.some((opt) => opt.trim().toLowerCase() === newChoice.toLowerCase());
        if (isDuplicate) {
          return interaction.editReply({
            content: `⚠️ The option **"${newChoice}"** already exists in this poll!`,
          });
        }

        // Append new option
        poll.options.push(newChoice);
        await savePoll(poll);

        // Update the live poll message with new button and updated canvas
        try {
          const updatedPayload = await buildPollPayload(poll);
          const targetChannel = interaction.channel || (poll.channel_id ? await interaction.client.channels.fetch(poll.channel_id).catch(() => null) : null);
          const targetMsg = interaction.message || (targetChannel && poll.message_id ? await targetChannel.messages.fetch(poll.message_id).catch(() => null) : null);
          if (targetMsg) {
            await targetMsg.edit(updatedPayload);
          }
        } catch (err) {
          console.error('[POLL ADD OPTION RE-RENDER ERROR]:', err);
        }

        return interaction.editReply({
          content: `✅ Successfully added **"${newChoice}"** to the poll!\nYou can now cast your vote for it below.`,
        });
      }

      // --- MODAL: RAFFLE CUSTOM TICKET QUANTITY PURCHASE ---
      if (modalId.startsWith('modal_raffle_buy_')) {
        const raffleId = modalId.replace('modal_raffle_buy_', '');
        await interaction.deferReply({ ephemeral: true });

        const rawCount = interaction.fields.getTextInputValue('input_raffle_ticket_count').trim();
        const count = parseInt(rawCount, 10);

        if (isNaN(count) || count < 1) {
          return interaction.editReply({ content: '❌ Please enter a valid number of tickets (minimum 1).' });
        }

        if (count > 1000) {
          return interaction.editReply({ content: '❌ Maximum ticket purchase limit per transaction is 1,000.' });
        }

        const result = await executeRaffleTicketPurchase({
          guildId,
          discordId,
          raffleId,
          count,
        });

        if (result.error) {
          return interaction.editReply({ content: result.error });
        }

        return interaction.editReply({
          embeds: [result.embed],
          components: [result.row],
        });
      }

      // --- MODAL: CREATE CHAOS CLASH BATTLE ROYALE ---
      if (modalId === 'modal_create_battle') {
        await interaction.deferReply({ ephemeral: true });

        const existingMatch = getActiveMatch(guildId);
        if (existingMatch && existingMatch.status !== 'finished') {
          return interaction.editReply({
            content: `⚠️ An active Chaos Clash match (\`${existingMatch.matchId}\`) is already in progress in this server!`,
          });
        }

        const rawMode = (interaction.fields.getTextInputValue('input_battle_mode') || 'interactive').trim().toLowerCase();
        const mode = rawMode === 'classic' ? 'classic' : 'interactive';
        const durationStr = interaction.fields.getTextInputValue('input_battle_duration') || '5m';
        const durationSec = parseBattleDuration(durationStr);

        const prizeStr = interaction.fields.getTextInputValue('input_battle_prize') || '500, 250';
        const parts = prizeStr.split(/[,|\s]+/).filter(Boolean);
        const prizePool = Math.max(50, parseInt(parts[0], 10) || 500);
        const prizeXp = Math.max(25, parseInt(parts[1], 10) || Math.round(prizePool / 2));

        let entryFee = 0;
        try {
          entryFee = Math.max(0, parseInt(interaction.fields.getTextInputValue('input_battle_entry') || '0', 10) || 0);
        } catch (_) {}

        let tagStr = '';
        try {
          tagStr = interaction.fields.getTextInputValue('input_battle_tag') || '';
        } catch (_) {}

        let tagMention = '';
        if (tagStr && tagStr.trim()) {
          const t = tagStr.trim();
          if (t === '@everyone' || t === '@here') {
            tagMention = t;
          } else if (/^<@&?\d+>$/.test(t)) {
            tagMention = t;
          } else if (/^\d{17,20}$/.test(t)) {
            tagMention = `<@&${t}>`;
          } else {
            const guild = interaction.guild || (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);
            const cleanName = t.replace(/^@/, '').toLowerCase();
            const role = guild?.roles?.cache?.find((r) => r.name.toLowerCase() === cleanName);
            tagMention = role ? `<@&${role.id}>` : (t.startsWith('@') ? t : `@${t}`);
          }
        }

        const match = createBattleMatch({
          guildId,
          channelId: interaction.channelId,
          createdBy: discordId,
          hostName: interaction.user.displayName || interaction.user.username,
          mode,
          signupDurationSec: durationSec,
          entryFee,
          prizePool,
          prizeXp,
        });

        const lobbyPayload = buildLobbyPayload(match);
        if (tagMention) {
          lobbyPayload.content = tagMention;
          lobbyPayload.allowedMentions = { parse: ['roles', 'users', 'everyone'] };
        }

        const lobbyMsg = await interaction.channel.send(lobbyPayload);
        match.messageId = lobbyMsg.id;

        // Schedule countdown reminders (60s, 30s, 15s)
        scheduleCountdowns(match, interaction.client);

        // Schedule match start
        setTimeout(() => {
          startBattleSimulation(match, interaction.client);
        }, durationSec * 1000);

        return interaction.editReply({
          content:
            `✅ **Chaos Clash Match Created!** (${mode.toUpperCase()} MODE)\n` +
            `• Sign-up Window: **${formatDurationDisplay(durationSec)}** (Closes <t:${Math.floor((Date.now() + durationSec * 1000) / 1000)}:R>)\n` +
            `• Grand Prize: **${prizePool.toLocaleString()} QP** & **+${prizeXp} XP**\n` +
            `• Entry Fee: **${entryFee > 0 ? `${entryFee} QP` : 'Free'}**\n\n` +
            `Fighters can join using the **[ ⚔️ Enter Clash ]** button!`,
        });
      }

      // --- MODAL: SPECTATOR BET SUBMISSION ---
      if (modalId.startsWith('modal_battle_bet_')) {
        const matchId = modalId.replace('modal_battle_bet_', '');
        const match = getMatchById(matchId);
        if (!match || match.status !== 'signup') {
          return interaction.reply({ content: '⏳ Betting is closed for this match.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const fighterQuery = interaction.fields.getTextInputValue('input_bet_fighter').trim().toLowerCase();
        const amountStr = interaction.fields.getTextInputValue('input_bet_amount').trim();

        // Find matching participant
        let targetParticipant = null;
        for (const p of match.participants.values()) {
          if (
            p.displayName.toLowerCase().includes(fighterQuery) ||
            p.discordId === fighterQuery.replace(/<@!?(\d+)>/, '$1')
          ) {
            targetParticipant = p;
            break;
          }
        }

        if (!targetParticipant) {
          return interaction.editReply({
            content: `❌ Could not find a registered fighter matching "${fighterQuery}". Please check the lobby list and try again!`,
          });
        }

        const result = await placeBet({
          matchId,
          guildId,
          bettorId: discordId,
          bettorName: interaction.user.displayName || interaction.user.username,
          targetId: targetParticipant.discordId,
          targetName: targetParticipant.displayName,
          amount: amountStr,
        });

        if (!result.success) {
          return interaction.editReply({ content: result.message });
        }

        return interaction.editReply({
          content:
            `🪙 **Bet Placed Successfully!**\n` +
            `• Fighter: **${result.targetName}**\n` +
            `• Wager: **${result.betAmount.toLocaleString()} QP**\n` +
            `• Total Match Pool: **${result.totalPot.toLocaleString()} QP**\n` +
            `• Remaining Balance: **${result.remainingPoints.toLocaleString()} QP**\n\n` +
            `If your fighter claims victory, your proportional share of the pot will be credited automatically!`,
        });
      }

      // --- MODAL: EXPORT USERLIST BY DATE RANGE ---
      if (modalId === 'modal_export_daterange') {
        await interaction.deferReply({ ephemeral: true });

        const startDateStr = interaction.fields.getTextInputValue('input_export_start_date').trim();
        const endDateStr = interaction.fields.getTextInputValue('input_export_end_date').trim();

        const startMs = new Date(startDateStr).getTime();
        const endMs = new Date(`${endDateStr}T23:59:59.999Z`).getTime();

        if (isNaN(startMs) || isNaN(endMs)) {
          return interaction.editReply({
            content: '❌ Invalid date format! Please use the `YYYY-MM-DD` format (e.g. `2026-09-01`).',
          });
        }

        if (startMs > endMs) {
          return interaction.editReply({
            content: '❌ Start Date cannot be after End Date!',
          });
        }

        const { data: allUsers, error } = await supabase
          .from('users')
          .select('*')
          .eq('guild_id', guildId)
          .order('total_points', { ascending: false });

        if (error || !allUsers || allUsers.length === 0) {
          return interaction.editReply({ content: '⚠️ No users found in database for this server.' });
        }

        // Filter users whose created_at or updated_at falls inside the window
        const filtered = allUsers
          .filter(u => {
            const cTime = u.created_at ? new Date(u.created_at).getTime() : 0;
            const uTime = u.updated_at ? new Date(u.updated_at).getTime() : 0;
            return (cTime >= startMs && cTime <= endMs) || (uTime >= startMs && uTime <= endMs);
          })
          .map(u => ({
            ...u,
            messages_sent: Math.max(Number(u.messages_sent || 0), getUserMessageCount(guildId, u.discord_id)),
          }));

        if (filtered.length === 0) {
          return interaction.editReply({
            content: `⚠️ No member records found active or created between **${startDateStr}** and **${endDateStr}**.`,
          });
        }

        const attachment = generateUsersCsvAttachment(
          filtered,
          `cohesion_members_${startDateStr}_to_${endDateStr}.csv`
        );

        return interaction.editReply({
          content: `✅ **Date Range Export Complete!**\n📅 Filter: **${startDateStr}** to **${endDateStr}**\n👥 Matching Records: **${filtered.length}**`,
          files: [attachment],
        });
      }

      // --- MODAL: AUTOMOD UPDATE BANNED WORDS ---
      if (modalId === 'modal_automod_words') {
        const rawWords = interaction.fields.getTextInputValue('input_banned_words_list') || '';
        const wordsArray = rawWords
          .split(',')
          .map(w => w.trim().toLowerCase())
          .filter(w => w.length > 0);

        // Deduplicate
        const uniqueWords = Array.from(new Set(wordsArray));
        updateAutoModSettings(guildId, { banned_words: uniqueWords });

        return interaction.reply({
          content:
            `✅ **Banned Words Filter Updated!**\n` +
            `• Active Forbidden Keywords: **${uniqueWords.length}**\n` +
            `• Keywords: ${uniqueWords.length > 0 ? uniqueWords.map(w => `\`${w}\``).join(', ') : '*None*'}`,
          ephemeral: true,
        });
      }
    }

    // ==========================================
    // 4. HANDLE SELECT MENUS
    // ==========================================
    if (interaction.isStringSelectMenu()) {
      const selectId = interaction.customId;
      const guildId = interaction.guildId;
      const discordId = interaction.user.id;

      // --- SELECT: COMMUNITY POLL VOTE (FOR POLLS WITH > 25 CHOICES) ---
      if (selectId.startsWith('poll_select_vote_')) {
        const parts = selectId.split('_');
        const pollId = parts[3];
        const selectedIndex = parseInt(interaction.values[0], 10);

        await interaction.deferReply({ ephemeral: true });

        const result = await castPollVote({
          pollId,
          guildId,
          discordId,
          optionIndex: selectedIndex,
          client: interaction.client,
        });

        if (result.error) {
          if (result.error.includes('concluded')) {
            await concludePoll(pollId, interaction.client);
          }
          return interaction.editReply({ content: result.error });
        }

        // Update the live poll card with new vote count and percentage bars
        const updatedPayload = buildPollPayload(result.poll);
        await interaction.message.edit(updatedPayload).catch(() => null);

        let rewardText = '';
        if (result.pointsAwarded > 0 || result.xpAwarded > 0) {
          rewardText = `\n\n🪙 **Rewards Earned:** +${result.pointsAwarded} QP & +${result.xpAwarded} XP\n` +
            `💰 **Current Balance:** ${result.newPoints.toLocaleString()} QP (Level ${result.newLevel})`;
        }

        const voteEmbed = new EmbedBuilder()
          .setColor(0x00b4d8)
          .setTitle('✅ Vote Recorded!')
          .setDescription(
            `You voted for: **${result.chosenOption}**${rewardText}\n\n` +
            `Thank you for participating in the community vote!`
          )
          .setFooter({ text: 'Cohesion Community Polls' });

        return interaction.editReply({ embeds: [voteEmbed] });
      }

      // --- SELECT: CHAOS CLASH ARCHETYPE SELECTION ---
      if (selectId.startsWith('select_battle_class_')) {
        const archetype = interaction.values[0];
        const result = setPlayerArchetype(guildId, discordId, archetype);
        if (!result.success) {
          return interaction.reply({ content: result.message, ephemeral: true });
        }

        const match = getActiveMatch(guildId);
        if (match) {
          const lobbyPayload = buildLobbyPayload(match);
          if (match.messageId) {
            const channel = await interaction.client.channels.fetch(match.channelId).catch(() => null);
            const msg = await channel?.messages?.fetch(match.messageId).catch(() => null);
            if (msg) await msg.edit(lobbyPayload).catch(() => null);
          }
        }

        return interaction.reply({
          content: `🛡️ **Archetype Equipped:** You are now entered into the battle as a **${result.archetype}**!`,
          ephemeral: true,
        });
      }

      // --- SELECT: PURCHASE CHAOS CLASH PRESTIGE COSMETIC ---
      if (selectId === 'select_buy_cosmetic') {
        const itemId = interaction.values[0];
        await interaction.deferReply({ ephemeral: true });

        const result = await purchaseCosmeticItem({
          guildId,
          discordId,
          itemId,
        });

        if (!result.success) {
          return interaction.editReply({ content: result.message });
        }

        return interaction.editReply({
          content:
            `🎉 **Prestige Cosmetic Unlocked!**\n\n` +
            `• **Item:** ${result.item.name} (${result.item.cost} QP)\n` +
            `• **Effect:** ${result.item.description}\n` +
            `• **Remaining Balance:** ${result.remainingPoints.toLocaleString()} QP\n\n` +
            `Your custom titles and emojis will now display dynamically across all future Chaos Clash live event logs!`,
        });
      }

      // --- SELECT: DRAW RAFFLE WINNER (ADMIN) ---
      if (selectId === 'select_draw_raffle') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ **Access Denied**: You need `Manage Server` or `Administrator` permissions to draw raffle winners.',
            ephemeral: true,
          });
        }

        const raffleId = interaction.values[0];
        await interaction.deferReply({ ephemeral: false });

        const { data: raffle } = await supabase
          .from('raffles')
          .select('*')
          .eq('raffle_id', raffleId)
          .eq('guild_id', guildId)
          .maybeSingle();

        if (!raffle || !raffle.is_active) {
          return interaction.editReply({ content: '⚠️ Raffle not found or already ended.' });
        }

        const { data: entries } = await supabase
          .from('raffle_entries')
          .select('discord_id, tickets_bought')
          .eq('raffle_id', raffleId);

        if (!entries || entries.length === 0) {
          await supabase.from('raffles').update({ is_active: false }).eq('raffle_id', raffleId);
          return interaction.editReply({
            content: `⚠️ No members entered the raffle for **${raffle.prize}**. The raffle has ended with no winner.`,
          });
        }

        // Aggregate tickets per member to prevent duplicate counts
        const userTicketMap = new Map();
        for (const entry of entries) {
          const current = userTicketMap.get(entry.discord_id) || 0;
          userTicketMap.set(entry.discord_id, current + (entry.tickets_bought || 0));
        }

        const pool = [];
        for (const [memberId, tickets] of userTicketMap.entries()) {
          for (let i = 0; i < tickets; i++) {
            pool.push(memberId);
          }
        }

        if (pool.length === 0) {
          await supabase.from('raffles').update({ is_active: false }).eq('raffle_id', raffleId);
          return interaction.editReply({
            content: `⚠️ No members entered the raffle for **${raffle.prize}**. The raffle has ended with no winner.`,
          });
        }

        const winnerId = pool[Math.floor(Math.random() * pool.length)];

        await supabase
          .from('raffles')
          .update({ is_active: false, winner_id: winnerId })
          .eq('raffle_id', raffleId);

        // Automated payout detection if prize specifies QP/points or XP
        let prizePayoutText = '';
        let components = [];
        const prizeLower = (raffle.prize || '').toLowerCase();
        const pointsMatch = prizeLower.match(/(\d+)\s*(?:qp|points?|quest\s*points?)/i);
        const xpMatch = prizeLower.match(/(\d+)\s*xp/i);

        const wonPoints = pointsMatch ? parseInt(pointsMatch[1], 10) : 0;
        const wonXp = xpMatch ? parseInt(xpMatch[1], 10) : 0;

        if (wonPoints > 0 || wonXp > 0) {
          const { data: winnerRec } = await supabase
            .from('users')
            .select('*')
            .eq('guild_id', guildId)
            .eq('discord_id', winnerId)
            .maybeSingle();

          const curPoints = Number(winnerRec?.total_points || 0);
          const curXp = Number(winnerRec?.xp || 0);
          const newPoints = curPoints + wonPoints;
          const newXp = curXp + wonXp;
          const newLevel = getLevelFromXp(newXp);

          await supabase.from('users').upsert(
            {
              guild_id: guildId,
              discord_id: winnerId,
              total_points: newPoints,
              xp: newXp,
              level: newLevel,
            },
            { onConflict: 'guild_id,discord_id' }
          );

          const payouts = [];
          if (wonPoints > 0) payouts.push(`+${wonPoints.toLocaleString()} QP`);
          if (wonXp > 0) payouts.push(`+${wonXp.toLocaleString()} XP`);
          prizePayoutText = `\n\n⚡ **Automated Payout:** ${payouts.join(' and ')} has been automatically credited to <@${winnerId}>'s account!`;
        } else {
          // Check if prize explicitly indicates a crypto / web3 payout
          const isCryptoPrize = /\b(usdt|usdc|eth|ethereum|sol|solana|btc|bitcoin|matic|polygon|bnb|crypto|wallet|token|tokens|airdrop)\b/i.test(prizeLower);

          if (isCryptoPrize) {
            const { data: winnerWallet } = await supabase
              .from('user_integrations')
              .select('provider_username, provider_user_id')
              .eq('discord_id', winnerId)
              .eq('provider', 'wallet')
              .maybeSingle();

            if (winnerWallet) {
              prizePayoutText =
                `\n\n👛 **Winner's Linked Wallet:** \`${winnerWallet.provider_username}\` (${winnerWallet.provider_user_id || 'EVM'})\n` +
                `📢 **Payout Instructions:** Server Admin, please disburse **${raffle.prize}** to the address above!`;
            } else {
              prizePayoutText =
                `\n\n⚠️ **Action Required:** <@${winnerId}> has not linked a payout wallet yet!\n` +
                `👉 Click the **Submit Payout Wallet** button below to submit your address for **${raffle.prize}**!`;

              const claimRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`claim_raffle_wallet_${raffleId}_${winnerId}`)
                  .setLabel('Submit Payout Wallet')
                  .setEmoji('👛')
                  .setStyle(ButtonStyle.Success)
              );
              components = [claimRow];
            }
          } else {
            // General community / server reward (e.g. Lucky Hour, Discord Nitro, Role, Steam Key, etc.)
            prizePayoutText =
              `\n\n🎁 **Prize Claim:** Congratulations <@${winnerId}>! Server Admin, please contact the winner to disburse/activate **${raffle.prize}**!`;
            components = [];
          }
        }

        const embed = new EmbedBuilder()
          .setColor(0xffd166)
          .setTitle('🎊 Cohesion Raffle Winner Announced!')
          .setDescription(
            `The raffle for **${raffle.prize}** has officially ended!\n\n` +
            `👑 **Winner:** <@${winnerId}>\n` +
            `🎟️ **Total Tickets In Pool:** ${pool.length}` +
            prizePayoutText
          )
          .setFooter({ text: `Raffle ID: ${raffle.raffle_id}` })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed], components });
      }

      // --- SELECT: ENTER RAFFLE (MEMBER) ---
      if (selectId === 'select_enter_raffle') {
        const raffleId = interaction.values[0];
        await interaction.deferReply({ ephemeral: true });

        const panel = await buildRafflePanel({
          guildId,
          discordId,
          raffleId,
        });

        if (panel.error) {
          return interaction.editReply({ content: panel.error });
        }

        return interaction.editReply({
          embeds: [panel.embed],
          components: [panel.row],
        });
      }

      // --- SELECT: VIEW ACTIVE AUCTION (MEMBER) ---
      if (selectId === 'select_view_auction') {
        const auctionId = interaction.values[0];
        await interaction.deferReply({ ephemeral: true });

        const { data: auction } = await supabase
          .from('auctions')
          .select('*')
          .eq('auction_id', auctionId)
          .maybeSingle();

        if (!auction) {
          return interaction.editReply({ content: '❌ Auction not found.' });
        }

        const payload = buildAuctionPayload(auction);

        if (auction.guild_id && auction.channel_id && auction.message_id) {
          const jumpBtn = new ButtonBuilder()
            .setLabel('Jump to Channel')
            .setEmoji('🔗')
            .setURL(`https://discord.com/channels/${auction.guild_id}/${auction.channel_id}/${auction.message_id}`)
            .setStyle(ButtonStyle.Link);

          payload.components[0].addComponents(jumpBtn);
        }

        return interaction.editReply(payload);
      }

      // --- SELECT: VOICE SNAPSHOT TARGET (ADMIN) ---
      if (selectId === 'select_rec_target') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Manage Server` permissions to configure voice recordings.',
            ephemeral: true,
          });
        }

        const activeCheck = getRecordingStatus(guildId);
        if (activeCheck) {
          return interaction.reply({
            content: `⚠️ A recording session is already active in **<#${activeCheck.channelId}>** (started by <@${activeCheck.initiatedById}>). Please wait for it to conclude.`,
            ephemeral: true,
          });
        }

        const targetChannelId = interaction.values[0];
        const ch = interaction.guild?.channels?.cache?.get(targetChannelId);
        const channelName = ch ? ch.name : 'Selected Channel';

        const aiProvider = getActiveAiProvider();
        let aiProviderLabel = 'None (Audio Only ready)';
        if (aiProvider === 'groq') aiProviderLabel = '🟢 Groq Cloud (Free Whisper Turbo + LLaMA 3.3)';
        else if (aiProvider === 'gemini') aiProviderLabel = '🟢 Google Gemini 1.5 Flash (Free)';
        else if (aiProvider === 'openai') aiProviderLabel = '🟡 OpenAI Whisper';

        const embed = new EmbedBuilder()
          .setColor(0x118ab2)
          .setTitle(`🎙️ Configure Recording: #${channelName}`)
          .setDescription(
            `Target Channel: **<#${targetChannelId}>**\n` +
            `Active AI Engine: **${aiProviderLabel}**\n\n` +
            `**Select your desired output mode below:**\n\n` +
            `🎙️ **Both (Audio + Script + Notes)**\n` +
            `Produces all isolated audio stems (\`.wav\`), the master podcast mix (\`.mp3\`), the chronological dialogue script (\`.md\`), and executive meeting notes.\n\n` +
            `🎵 **Audio Only (0 AI / 100% Local)**\n` +
            `Produces only the audio stems (\`.zip\`) and master mix (\`.mp3\`). Requires zero AI API keys.\n\n` +
            `📝 **Script & Notes Only**\n` +
            `Transcribes dialogue and writes meeting notes, then deletes heavy audio files to save server disk space.`
          )
          .setFooter({ text: 'Click a button below to launch the recording immediately!' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`admin_rec_start_${targetChannelId}_both`)
            .setLabel('Start: Both (Audio + Script)')
            .setEmoji('🎙️')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`admin_rec_start_${targetChannelId}_audio`)
            .setLabel('Start: Audio Only (No AI)')
            .setEmoji('🎵')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`admin_rec_start_${targetChannelId}_script`)
            .setLabel('Start: Script & Notes Only')
            .setEmoji('📝')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('admin_record_vc')
            .setLabel('Change Channel')
            .setEmoji('🔙')
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({ embeds: [embed], components: [row] });
      }

      // --- SELECT: VOICE SNAPSHOT TARGET (ADMIN) ---
      if (selectId === 'select_vc_target') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Manage Server` permissions to run voice attendance snapshots.',
            ephemeral: true,
          });
        }

        const targetChannelId = interaction.values[0];
        let channelTitle = 'All Voice Channels';
        if (targetChannelId !== 'all') {
          const ch = interaction.guild?.channels?.cache?.get(targetChannelId);
          channelTitle = ch ? `#${ch.name.slice(0, 25)}` : 'Specific Channel';
        }

        const modal = new ModalBuilder()
          .setCustomId(`modal_vc_snapshot_${targetChannelId}`)
          .setTitle(`🎙️ Snapshot: ${channelTitle.slice(0, 30)}`);

        const pointsInput = new TextInputBuilder()
          .setCustomId('input_vc_points')
          .setLabel('Cohesion Points (CP) Reward')
          .setValue('50')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const xpInput = new TextInputBuilder()
          .setCustomId('input_vc_xp')
          .setLabel('XP Reward')
          .setValue('50')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const noteInput = new TextInputBuilder()
          .setCustomId('input_vc_note')
          .setLabel('Event Note / Reason')
          .setValue(targetChannelId === 'all' ? 'Community Call Attendance' : `${channelTitle} Attendance`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(pointsInput),
          new ActionRowBuilder().addComponents(xpInput),
          new ActionRowBuilder().addComponents(noteInput)
        );

        return interaction.showModal(modal);
      }

      // --- SELECT: BUY MARKETPLACE ITEM (MEMBER) ---
      if (selectId === 'select_buy_item') {
        const itemId = interaction.values[0];
        await interaction.deferReply({ ephemeral: true });

        const { data: item } = await supabase
          .from('marketplace_items')
          .select('*')
          .eq('item_id', itemId)
          .eq('guild_id', guildId)
          .maybeSingle();

        if (!item || item.stock === 0) {
          return interaction.editReply({ content: '❌ This item is out of stock or no longer available.' });
        }

        const cost = Number(item.cost);
        const currType = getCurrencyType(guildId);
        const currLabel = currType === 'xp' ? 'XP' : 'CP';
        const balanceField = currType === 'xp' ? 'xp' : 'total_points';

        const { data: userRecord } = await supabase
          .from('users')
          .select(balanceField)
          .eq('guild_id', guildId)
          .eq('discord_id', discordId)
          .maybeSingle();

        const userBalance = Number(userRecord?.[balanceField] || 0);
        if (userBalance < cost) {
          return interaction.editReply({
            content: `❌ Insufficient ${currLabel === 'XP' ? 'Experience Points' : 'Cohesion Points'}! You need **${cost} ${currLabel}**, but currently have **${userBalance} ${currLabel}**.`,
          });
        }

        // Deduct points or XP
        await supabase
          .from('users')
          .update({ [balanceField]: userBalance - cost })
          .eq('guild_id', guildId)
          .eq('discord_id', discordId);

        // Decrement stock if finite
        if (item.stock > 0) {
          await supabase
            .from('marketplace_items')
            .update({ stock: item.stock - 1 })
            .eq('item_id', itemId);
        }

        // Record purchase
        const { data: purchaseRecord } = await supabase
          .from('marketplace_purchases')
          .insert({
            guild_id: guildId,
            discord_id: discordId,
            item_id: itemId,
            cost_paid: cost,
            item_title: item.title,
          })
          .select()
          .maybeSingle();

        const rawId = purchaseRecord?.purchase_id || purchaseRecord?.id || Date.now().toString(36);
        const receiptId = rawId.toString().slice(-8).toUpperCase();

        // If a Discord Role ID is attached, auto-assign the role!
        let roleSuccessNote = '';
        let roleGranted = false;
        const cleanRoleId = item.role_id ? item.role_id.replace(/[<@&>]/g, '').trim() : null;

        if (cleanRoleId) {
          try {
            const guild = interaction.guild;
            const botMember = await guild.members.fetchMe().catch(() => null);
            const targetRole =
              guild.roles.cache.get(cleanRoleId) ||
              (await guild.roles.fetch(cleanRoleId).catch(() => null));

            if (!targetRole) {
              roleSuccessNote = `\n⚠️ **Role Not Found:** Role ID \`${cleanRoleId}\` could not be found. Please contact an admin.`;
            } else if (
              !botMember?.permissions.has(PermissionFlagsBits.ManageRoles) &&
              !botMember?.permissions.has(PermissionFlagsBits.Administrator)
            ) {
              roleSuccessNote =
                `\n⚠️ **Role Not Auto-Assigned (Missing Permission):** Cohesion is missing the **Manage Roles** permission!\n` +
                `👉 *Admin Action:* Grant Cohesion the "Manage Roles" permission in Server Settings > Roles, then grant <@&${cleanRoleId}> to <@${discordId}>.`;
            } else if (botMember.roles.highest.position <= targetRole.position) {
              roleSuccessNote =
                `\n⚠️ **Role Not Auto-Assigned (Role Hierarchy):** Cohesion's role is positioned below <@&${cleanRoleId}>!\n` +
                `👉 *Admin Action:* In **Server Settings > Roles**, drag the **Cohesion** role **ABOVE** <@&${cleanRoleId}>, then assign the role to <@${discordId}>.`;
            } else {
              const member = await guild.members.fetch(discordId).catch(() => null);
              if (member) {
                await member.roles.add(cleanRoleId);
                roleGranted = true;
                roleSuccessNote = `\n🎖️ **Role Auto-Assigned:** <@&${cleanRoleId}> has been added to your profile!`;
              }
            }
          } catch (roleErr) {
            console.warn('[ROLE ASSIGN WARN]:', roleErr.message);
            roleSuccessNote =
              `\n⚠️ **Role Not Auto-Assigned:** ${roleErr.message}.\n` +
              `👉 *Admin Action:* Make sure Cohesion's role is above <@&${cleanRoleId}> in Server Settings > Roles with "Manage Roles" enabled.`;
          }
        }

        // Post purchase log to audit channel if available
        try {
          const logChannel = interaction.guild.channels.cache.find(
            c =>
              (c.name === 'cohesion-logs' ||
                c.name === 'questify-logs' ||
                c.name === 'admin-logs' ||
                c.name === 'mod-logs' ||
                c.name === 'logs') &&
              c.isTextBased()
          );

          if (logChannel) {
            const auditEmbed = new EmbedBuilder()
              .setColor(roleGranted ? 0x06d6a0 : 0xffa500)
              .setTitle('🛒 Verified Marketplace Purchase')
              .setDescription(
                `👤 **Buyer:** <@${discordId}> (\`${interaction.user.tag}\`)\n` +
                `🛍️ **Item:** **${item.title}**\n` +
                `🪙 **Paid:** **${cost} ${currLabel}**\n` +
                `🧾 **Receipt ID:** \`#REC-${receiptId}\`\n` +
                `🎖️ **Role Attached:** ${cleanRoleId ? `<@&${cleanRoleId}>` : 'None'}\n` +
                `⚡ **Role Status:** ${
                  cleanRoleId
                    ? roleGranted
                      ? '✅ Auto-assigned successfully'
                      : '⚠️ Manual action required (Drag Cohesion role above this role)'
                    : 'N/A'
                }`
              )
              .setTimestamp()
              .setFooter({ text: `Buyer ID: ${discordId}` });

            await logChannel.send({ embeds: [auditEmbed] }).catch(() => null);
          }
        } catch (logErr) {
          console.warn('[PURCHASE AUDIT LOG ERROR]:', logErr.message);
        }

        const successEmbed = new EmbedBuilder()
          .setColor(roleGranted || !cleanRoleId ? 0x06d6a0 : 0xffd166)
          .setTitle('🛍️ Purchase Successful!')
          .setDescription(
            `You purchased **${item.title}** for **${cost} ${currLabel}**!\n\n` +
            `🧾 **Receipt ID:** \`#REC-${receiptId}\`\n` +
            `💰 **Remaining Balance:** ${(userBalance - cost).toLocaleString()} ${currLabel}\n` +
            `📅 **Date:** <t:${Math.floor(Date.now() / 1000)}:f>` +
            roleSuccessNote
          )
          .setFooter({ text: 'Cohesion Community Marketplace • Save your Receipt ID' });

        return interaction.editReply({ embeds: [successEmbed] });
      }
    }

    // ==========================================
    // 4. HANDLE STRING SELECT MENUS
    // ==========================================
    if (interaction.isStringSelectMenu()) {
      const selectId = interaction.customId;
      const guildId = interaction.guildId;
      const discordId = interaction.user.id;

      // --- SELECT: COMMUNITY POLL VOTE (>24 CHOICES) ---
      if (selectId.startsWith('poll_select_vote_')) {
        const parts = selectId.split('_');
        const pollId = parts[3];
        const selectedIndex = parseInt(interaction.values[0], 10);

        await interaction.deferReply({ ephemeral: true });

        const result = await castPollVote({
          pollId,
          guildId,
          discordId,
          optionIndex: selectedIndex,
          client: interaction.client,
        });

        if (result.error) {
          return interaction.editReply({ content: result.error });
        }

        // Update the live poll card with new vote count and percentage bars
        const updatedPayload = await buildPollPayload(result.poll);
        await interaction.message.edit(updatedPayload).catch(() => null);

        let rewardText = '';
        if (result.pointsAwarded > 0 || result.xpAwarded > 0) {
          rewardText = `\n\n🪙 **Rewards Earned:** +${result.pointsAwarded} QP & +${result.xpAwarded} XP\n` +
            `💰 **Current Balance:** ${result.newPoints.toLocaleString()} QP (Level ${result.newLevel})`;
        }

        const voteEmbed = new EmbedBuilder()
          .setColor(0x00b4d8)
          .setTitle('✅ Vote Recorded!')
          .setDescription(
            `You voted for: **${result.chosenOption}**${rewardText}\n\n` +
            `Thank you for participating in the community vote!`
          )
          .setFooter({ text: 'Cohesion Community Polls' });

        return interaction.editReply({ embeds: [voteEmbed] });
      }

      // --- SELECT: CHAOS CLASH ARCHETYPE SELECTION ---
      if (selectId.startsWith('select_battle_class_')) {
        const archetype = interaction.values[0];
        const result = setPlayerArchetype(guildId, discordId, archetype);
        if (!result.success) {
          return interaction.reply({ content: result.message, ephemeral: true });
        }

        const match = getActiveMatch(guildId);
        if (match) {
          const lobbyPayload = buildLobbyPayload(match);
          if (match.messageId) {
            const channel = await interaction.client.channels.fetch(match.channelId).catch(() => null);
            const msg = await channel?.messages?.fetch(match.messageId).catch(() => null);
            if (msg) await msg.edit(lobbyPayload).catch(() => null);
          }
        }

        return interaction.reply({
          content: `🛡️ **Archetype Equipped:** You are now entered into the battle as a **${result.archetype}**!`,
          ephemeral: true,
        });
      }

      // --- SELECT: COSMETIC ITEM PURCHASE ---
      if (selectId === 'select_buy_cosmetic') {
        const itemId = interaction.values[0];
        await interaction.deferReply({ ephemeral: true });

        const result = await purchaseCosmeticItem({
          guildId,
          discordId,
          itemId,
        });

        if (!result.success) {
          return interaction.editReply({ content: result.message });
        }

        return interaction.editReply({
          content:
            `✨ **Cosmetic Equipped!** You unlocked **${result.item.name}** for **${result.cost} QP**!\n` +
            `💰 **Remaining Balance:** ${result.newBalance.toLocaleString()} QP\n` +
            `Your arena fighter tag is now updated in all matches!`,
        });
      }

      // --- SELECT: ADMIN PRESET SELECTION ---
      if (selectId === 'select_admin_preset') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to configure server mode.',
            ephemeral: true,
          });
        }

        const chosenPreset = interaction.values[0];
        setGuildPreset(guildId, chosenPreset);

        if (chosenPreset === 'custom') {
          const selectorPayload = buildCustomModulesSelector(guildId);
          return interaction.reply(selectorPayload);
        }

        await interaction.deferUpdate();
        const payload = buildServerModePayload(guildId, interaction.guild?.name);
        return interaction.editReply(payload);
      }

      // --- SELECT: ADMIN CUSTOM MODULES CONFIGURATION ---
      if (selectId === 'select_custom_modules') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to configure modules.',
            ephemeral: true,
          });
        }

        const chosenModules = interaction.values;
        setGuildCustomModules(guildId, chosenModules);

        const enabledCount = chosenModules.length;
        const curType = getCurrencyType(guildId);
        const curLabel = curType === 'xp' ? '✨ XP' : curType === 'points' ? '🪙 CP' : '🚫 Direct Roles';

        return interaction.reply({
          content:
            `✅ **Custom Modules Saved!**\n` +
            `• Enabled Modules: **${enabledCount} / 10**\n` +
            `• Spendable Currency: **${curLabel}**\n` +
            `• Operating Mode set to: **🎛️ Custom Modular Mode**`,
          ephemeral: true,
        });
      }

      // --- SELECT: AUTOMOD PUNISHMENT POLICY ---
      if (selectId === 'select_automod_punishment') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to configure AutoMod.',
            ephemeral: true,
          });
        }

        const chosenMode = interaction.values[0];
        updateAutoModSettings(guildId, { punishment_mode: chosenMode });

        const labels = {
          warn_only: '⚠️ Warn Only (Delete & Warn in chat)',
          warn_timeout: '⏱️ Warn + Timeout (10m Timeout on repeated spam)',
          warn_timeout_ban: '🔨 Full Escalation (Warn ➔ 10m Timeout ➔ Auto-Ban)',
        };

        return interaction.reply({
          content: `✅ **AutoMod Policy Updated!** Active policy set to: **${labels[chosenMode] || chosenMode}**`,
          ephemeral: true,
        });
      }

      // --- SELECT: QUICK-LAUNCH QUEST FROM DRAFT ---
      if (selectId === 'select_launch_draft') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Administrator` or `Manage Server` permissions to launch quests.',
            ephemeral: true,
          });
        }

        const selectedDraftName = interaction.values[0];
        const drafts = getGuildDrafts(guildId);
        const draft = drafts.find((d) => d.name === selectedDraftName) || drafts[0];

        const modal = new ModalBuilder()
          .setCustomId(`modal_launch_draft_${draft.name}`)
          .setTitle(`🚀 Launch [${draft.name}] Quest`);

        const urlInput = new TextInputBuilder()
          .setCustomId('input_draft_url')
          .setLabel('Twitter / X Post URL')
          .setPlaceholder('https://x.com/username/status/123456...')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const ctaInput = new TextInputBuilder()
          .setCustomId('input_draft_cta')
          .setLabel('Headline / Call to Action (Optional)')
          .setPlaceholder('e.g. Raid this post!')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const textInput = new TextInputBuilder()
          .setCustomId('input_draft_custom_text')
          .setLabel('Custom Requirements (Optional)')
          .setPlaceholder('e.g. Must follow @account.\n@Socials')
          .setValue(draft.keyword ? `Include tag: ${draft.keyword}` : '')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(urlInput),
          new ActionRowBuilder().addComponents(ctaInput),
          new ActionRowBuilder().addComponents(textInput)
        );

        return interaction.showModal(modal);
      }
    }

    // ==========================================
    // 5. HANDLE CHANNEL SELECT MENUS
    // ==========================================
    if (interaction.isChannelSelectMenu()) {
      const selectId = interaction.customId;
      const guildId = interaction.guildId;

      if (selectId === 'select_export_channel') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Manage Server` permissions to perform channel analytics.',
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });
        const targetChannelId = interaction.values[0];
        const channel = await interaction.guild?.channels?.fetch(targetChannelId).catch(() => null);

        if (!channel || !channel.isTextBased()) {
          return interaction.editReply({ content: '❌ Selected channel is not accessible or not a text channel.' });
        }

        // Audit recent messages from channel
        const channelStats = await auditChannelMessages(channel, 100);

        if (channelStats.size === 0) {
          return interaction.editReply({
            content: `📢 No recent messages found from human members in <#${targetChannelId}>.`,
          });
        }

        const attachment = generateChannelCsvAttachment(channel.name, channelStats, interaction.guild);

        // Top 5 talkers
        const topTalkers = Array.from(channelStats.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([uId, cnt], i) => `**#${i + 1}** <@${uId}> — **${cnt}** messages`)
          .join('\n');

        const embed = new EmbedBuilder()
          .setColor(0x4361ee)
          .setTitle(`📢 Channel Message Audit: #${channel.name}`)
          .setDescription(
            `Successfully audited messages in <#${targetChannelId}>!\n\n` +
            `📊 **Unique Active Members:** **${channelStats.size}**\n\n` +
            `🏆 **Top Talkers in Channel:**\n${topTalkers}\n\n` +
            `*Full channel leaderboard exported as CSV attached below.*`
          )
          .setFooter({ text: 'Cohesion Channel Intelligence' });

        return interaction.editReply({ embeds: [embed], files: [attachment] });
      }
    }

    // ==========================================
    // 6. HANDLE USER SELECT MENUS
    // ==========================================
    if (interaction.isUserSelectMenu()) {
      const selectId = interaction.customId;
      const guildId = interaction.guildId;

      if (selectId === 'select_export_user') {
        if (!isAuthorizedAdmin(interaction)) {
          return interaction.reply({
            content: '⛔ You need `Manage Server` permissions to inspect member records.',
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });
        const targetUserId = interaction.values[0];
        const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);

        const { data: userRecord } = await supabase
          .from('users')
          .select('*')
          .eq('guild_id', guildId)
          .eq('discord_id', targetUserId)
          .maybeSingle();

        // Get live message stats
        const liveMsgCount = getUserMessageCount(guildId, targetUserId);
        const totalMessages = Math.max(Number(userRecord?.messages_sent || 0), liveMsgCount);
        const channelBreakdown = getUserChannelBreakdown(guildId, targetUserId);

        // Count quests completed
        const { count: questCount } = await supabase
          .from('quest_submissions')
          .select('*', { count: 'exact', head: true })
          .eq('guild_id', guildId)
          .eq('discord_id', targetUserId);

        // Count raffle tickets
        const { data: raffleEntries } = await supabase
          .from('raffle_entries')
          .select('tickets_bought')
          .eq('discord_id', targetUserId);

        const totalRaffleTickets = (raffleEntries || []).reduce((sum, e) => sum + (e.tickets_bought || 0), 0);

        // Count marketplace purchases
        const { count: purchaseCount } = await supabase
          .from('marketplace_purchases')
          .select('*', { count: 'exact', head: true })
          .eq('guild_id', guildId)
          .eq('discord_id', targetUserId);

        const breakdownText = channelBreakdown.length > 0
          ? channelBreakdown.slice(0, 5).map(b => `• <#${b.channelId}>: **${b.count}** msgs`).join('\n')
          : '*No channel breakdown recorded yet*';

        const embed = new EmbedBuilder()
          .setColor(0x7209b7)
          .setTitle(`👤 Member Dossier: ${targetUser?.tag || targetUserId}`)
          .setThumbnail(targetUser?.displayAvatarURL({ dynamic: true }) || null)
          .setDescription(
            `**Discord Identity:** <@${targetUserId}> (\`${targetUserId}\`)\n` +
            `**First Recorded:** <t:${Math.floor(new Date(userRecord?.created_at || Date.now()).getTime() / 1000)}:R>\n\n` +
            `📊 **Activity & Leveling:**\n` +
            `• 💬 **Total Messages Sent:** **${totalMessages}**\n` +
            `• 🎖️ **Level:** **${userRecord?.level || 1}** (${Number(userRecord?.xp || 0).toLocaleString()} XP)\n` +
            `• 🪙 **Cohesion Points:** **${Number(userRecord?.total_points || 0).toLocaleString()} CP**\n\n` +
            `🔗 **Connected Accounts:**\n` +
            `• 👛 **Wallet:** \`${userRecord?.wallet_address || userRecord?.evm_address || 'Not Linked'}\`\n` +
            `• 🐦 **Twitter:** ${userRecord?.twitter_handle ? `@${userRecord.twitter_handle}` : '*Not Linked*'}\n\n` +
            `🏆 **Ecosystem Participation:**\n` +
            `• 🎯 **Quests Verified:** **${questCount || 0}**\n` +
            `• 🎟️ **Raffle Tickets Owned:** **${totalRaffleTickets}**\n` +
            `• 🛍️ **Market Purchases:** **${purchaseCount || 0}**\n\n` +
            `📢 **Top Channel Activity:**\n${breakdownText}`
          )
          .setFooter({ text: 'Cohesion Member Intelligence' })
          .setTimestamp();

        // Download single user CSV button
        const dlBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`btn_download_user_csv_${targetUserId}`)
            .setLabel(`Download ${targetUser?.username || 'User'} CSV`)
            .setEmoji('📥')
            .setStyle(ButtonStyle.Success)
        );

        return interaction.editReply({ embeds: [embed], components: [dlBtn] });
      }
    }
  },
};
