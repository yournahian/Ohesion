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
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';
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
import { placeBet } from '../modules/battle/battleBetting.js';

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

  // Fetch user profile
  const { data: userRecord } = await supabase
    .from('users')
    .select('total_points')
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .maybeSingle();

  const userPoints = Number(userRecord?.total_points || 0);

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
    banner = `✅ **Successfully bought ${purchaseResult.count.toLocaleString()} ticket${purchaseResult.count > 1 ? 's' : ''} for ${purchaseResult.totalCost.toLocaleString()} QP!**\n\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(purchaseResult ? 0x06d6a0 : 0x118ab2)
    .setTitle(purchaseResult ? `🎟️ Tickets Purchased: ${raffle.prize}` : `🎟️ Enter Raffle: ${raffle.prize}`)
    .setDescription(
      banner +
      `🎁 **Prize:** **${raffle.prize}**\n` +
      `🪙 **Ticket Cost:** **${costPerTicket.toLocaleString()} QP** per ticket\n` +
      `🎟️ **Your Tickets in Pool:** **${userTickets.toLocaleString()} ticket${userTickets === 1 ? '' : 's'}**\n` +
      `🌐 **Total Tickets in Pool:** **${totalPoolTickets.toLocaleString()}**\n` +
      `💰 **Your QP Balance:** **${userPoints.toLocaleString()} QP**\n` +
      `⏳ **Raffle Ends:** <t:${endTimestampSec}:R> (<t:${endTimestampSec}:f>)\n\n` +
      `*Click a button below to choose how many tickets to buy:*`
    )
    .setFooter({ text: `Raffle ID: ${raffle.raffle_id} • 1 Ticket = ${costPerTicket} QP` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rfbuy_1_${raffleId}`)
      .setLabel(`Buy 1 Ticket (${costPerTicket} QP)`)
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(userPoints < costPerTicket),
    new ButtonBuilder()
      .setCustomId(`rfbuy_5_${raffleId}`)
      .setLabel(`Buy 5 Tickets (${costPerTicket * 5} QP)`)
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(userPoints < costPerTicket * 5),
    new ButtonBuilder()
      .setCustomId(`rfbuy_10_${raffleId}`)
      .setLabel(`Buy 10 Tickets (${costPerTicket * 10} QP)`)
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(userPoints < costPerTicket * 10),
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

  const { data: userRecord } = await supabase
    .from('users')
    .select('total_points')
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .maybeSingle();

  const userPoints = Number(userRecord?.total_points || 0);
  if (userPoints < totalCost) {
    return {
      error: `❌ Insufficient Quest Points! You need **${totalCost.toLocaleString()} QP** for ${safeCount} ticket(s) (${costPerTicket} QP each), but you only have **${userPoints.toLocaleString()} QP**.`,
    };
  }

  // Deduct points
  const remainingPoints = userPoints - totalCost;
  await supabase
    .from('users')
    .update({ total_points: remainingPoints })
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

    // 1. Explicit Twitter/X URL conversion: e.g. https://x.com/username -> [@username](https://x.com/username)
    line = line.replace(/https?:\/\/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,25})(?:\/[^\s)]*)?/gi, '[@$1](https://x.com/$1)');

    // 2. Explicit prefix conversion:
    // x:@handle or twitter:@handle -> [@handle](https://x.com/handle)
    line = line.replace(/\b(?:x|twitter):@?([a-zA-Z0-9_]{1,25})\b/gi, '[@$1](https://x.com/$1)');

    // role:@roleName or discord:@roleName -> resolve to role mention
    line = line.replace(/\b(?:role|discord):@?([a-zA-Z0-9_\- ]+?)(?=[,.:;!?)]|$)/gi, (match, roleQuery) => {
      const cleanQ = roleQuery.trim().toLowerCase();
      const r = roles.find((role) => role.name.toLowerCase() === cleanQ || role.id === cleanQ);
      return r ? `<@&${r.id}>` : match;
    });

    // 3. Smart contextual X handle detection:
    // When preceded by action verbs (follow, sub, subscribe, check, visit, repost, rt, support)
    // ALWAYS treat as X account handle, even if a Discord role with the same name exists!
    line = line.replace(/\b(follow(?:ing)?|sub(?:scribe)?|check(?:\s+out)?|visit|repost|rt|support)\s+@([a-zA-Z0-9_]{1,25})\b/gi, '$1 [@$2](https://x.com/$2)');

    // Support "follow the account" or "follow account" or "follow x"
    line = line.replace(/\bfollow(?:\s+the)?\s+(?:account|x(?:\s+acc(?:ount)?)?)\b/gi, `follow [@${tweetUsername}](https://x.com/${tweetUsername})`);

    // 4. Resolve Discord roles for remaining @mentions:
    for (const r of sortedRoles) {
      const escapedRole = r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match @RoleName only if NOT already part of a markdown link or Discord mention
      const roleRegex = new RegExp(`(?<!\\[|/|&|<)@${escapedRole}(?=[\\s,.:;!?)]|$)`, 'gi');
      if (roleRegex.test(line)) {
        line = line.replace(roleRegex, `<@&${r.id}>`);
      }
    }

    // 5. Any remaining @handle (that isn't a role, link, or mention)
    line = line.replace(/(^|[^\w<@&/])@([a-zA-Z0-9_]{1,25})(?=[^\w]|$)/g, (match, prefix, handle) => {
      const lowerHandle = handle.toLowerCase();
      if (lowerHandle === 'everyone' || lowerHandle === 'here') {
        return `${prefix}@${handle}`;
      }
      if (lowerHandle === 'account' || lowerHandle === 'x') {
        return `${prefix}[@${tweetUsername}](https://x.com/${tweetUsername})`;
      }
      // Check if it matches a guild role
      const matchedRole = roles.find((r) => r.name.toLowerCase() === lowerHandle);
      if (matchedRole) {
        return `${prefix}<@&${matchedRole.id}>`;
      }
      // Otherwise, default to X profile link
      return `${prefix}[@${handle}](https://x.com/${handle})`;
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
          .setValue('Engage to collect your points')
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
          .setLabel('Ticket Cost (Quest Points)')
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
          .setPlaceholder('e.g. What blockchain does Questify primarily deploy on?')
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
          .setValue('Questify Live Trivia Show')
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
          .setPlaceholder('e.g. QuestifyApp (without @)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(handleInput));
        return interaction.showModal(modal);
      }

      // --- LINK WALLET BUTTON (FROM HUB) ---
      if (customId === 'hub_link_wallet') {
        const modal = new ModalBuilder()
          .setCustomId('modal_link_wallet')
          .setTitle('👛 Link Payout Wallet');

        const addressInput = new TextInputBuilder()
          .setCustomId('input_wallet_address')
          .setLabel('Wallet Address (EVM / Solana)')
          .setPlaceholder('e.g. 0x71C... or Solana public key')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const chainInput = new TextInputBuilder()
          .setCustomId('input_wallet_chain')
          .setLabel('Network / Chain (Optional)')
          .setValue('Base / EVM')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(addressInput),
          new ActionRowBuilder().addComponents(chainInput)
        );

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
          .setLabel('Price in Quest Points (QP)')
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
          .setFooter({ text: 'Questify Economy & Marketplace Audit' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      if (customId === 'admin_vc_snapshot') {
        const modal = new ModalBuilder()
          .setCustomId('modal_vc_snapshot')
          .setTitle('🎙️ Voice Chat Attendance Snapshot');

        const pointsInput = new TextInputBuilder()
          .setCustomId('input_vc_points')
          .setLabel('Quest Points Reward')
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
          .setValue('Community AMA Attendance')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(pointsInput),
          new ActionRowBuilder().addComponents(xpInput),
          new ActionRowBuilder().addComponents(noteInput)
        );

        return interaction.showModal(modal);
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
          .setLabel('Quest Points (QP) to Add / Deduct')
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
          .setLabel('Starting Bid (in Quest Points)')
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
            `📊 **Live Questify Server Stats:**\n` +
            `• Tracked Members: **${totalMembersTracked || 0}**\n` +
            `• Active Tweet Quests: **${activeQuestsCount || 0}**\n` +
            `• Active Raffles: **${activeRafflesCount || 0}**`,
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
            `You received **+${dailyReward} Quest Points** today!\n\n` +
            `${streakBadge}\n` +
            `💰 **Total Balance:** ${newPoints.toLocaleString()} QP`
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
          .setFooter({ text: 'Questify Gamification Leaderboard' });

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

        const options = raffles.slice(0, 25).map(r =>
          new StringSelectMenuOptionBuilder()
            .setLabel(r.prize.slice(0, 50))
            .setDescription(`Cost: ${r.cost} QP per ticket • Ends soon!`)
            .setValue(r.raffle_id)
            .setEmoji('🎟️')
        );

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_enter_raffle')
          .setPlaceholder('Select a raffle to enter (1 Ticket)')
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const raffleListText = raffles
          .map(
            (r, i) =>
              `**${i + 1}. ${r.prize}**\n` +
              `↳ Cost: **${r.cost} QP** • Ends: <t:${Math.floor(new Date(r.end_time).getTime() / 1000)}:R>`
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
            .setDescription(`Cost: ${item.cost} QP • ${item.stock === -1 ? 'Unlimited' : `${item.stock} in stock`}`)
            .setValue(item.item_id)
            .setEmoji('🛍️')
        );

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_buy_item')
          .setPlaceholder('Choose an item to purchase with your QP')
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
              `**${i + 1}. ${it.title}** — **${it.cost} QP**\n` +
              `↳ ${it.description || 'No description'} • Stock: ${it.stock === -1 ? 'Unlimited' : it.stock}`
          )
          .join('\n\n');

        const embed = new EmbedBuilder()
          .setColor(0xffb703)
          .setTitle(`🛒 ${interaction.guild?.name || 'Server'} • Community Marketplace`)
          .setDescription(`${itemListText}\n\n*Select an item below to purchase, or view your past receipts!*`)
          .setFooter({ text: 'Quest Points are automatically deducted upon purchase' });

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
          .setFooter({ text: 'Questify Live Escrow Auctions' });

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
              `🪙 **+${pointsReward} Quest Points** have been added to your balance.\n` +
              `💰 Total Points: **${newPoints.toLocaleString()} QP**`
            )
            .setFooter({ text: 'Questify Engagement Engine' });

          return interaction.editReply({ embeds: [successEmbed] });
        } catch (err) {
          console.error('[BUTTON ERROR]:', err);
          return interaction.editReply({ content: '❌ An error occurred during verification.' });
        }
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
              `• **+${pointsAwarded} Quest Points**\n` +
              `• **+${xpAwarded} XP**\n\n` +
              `💰 **Updated Balance:** ${newPoints.toLocaleString()} QP (Level ${newLevel})`
            )
            .setFooter({ text: 'Questify Gamification Engine' });

          return interaction.editReply({ embeds: [winEmbed] });
        } else {
          const lossEmbed = new EmbedBuilder()
            .setColor(0xef476f)
            .setTitle('❌ Incorrect Answer')
            .setDescription(
              `You selected: **${quiz.options[choiceIndex]}**\n\n` +
              `Better luck next time! Stay tuned to the community channels for the next trivia drop.`
            )
            .setFooter({ text: 'Questify Trivia System' });

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
              `🪙 **Points Awarded:** **+${result.pointsAwarded} QP** (Speed-Bonus Applied)\n` +
              `🏆 **Total Tournament Score:** **${result.totalScore.toLocaleString()} QP**`
            )
            .setFooter({ text: 'Questify Live Tournament' });

          return interaction.editReply({ embeds: [winEmbed] });
        } else {
          const lossEmbed = new EmbedBuilder()
            .setColor(0xef476f)
            .setTitle('❌ Incorrect Answer')
            .setDescription(
              `You selected: **${result.chosenOption}**\n\n` +
              `0 points awarded for this round. Keep your eyes on the channel for the next question!`
            )
            .setFooter({ text: 'Questify Live Tournament' });

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
          .setFooter({ text: 'Questify Community Polls' });

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
          .setLabel('Bet Amount in Quest Points (QP)')
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
            `**Tier 1 (Common - 150 QP):** Standard Combat Emojis (⚔️, 🛡️, 🎯, 🏹)\n` +
            `**Tier 2 (Rare - 350 QP):** Luminescent Hex Bracket Tags (⟦MINT⟧, ⟦ROSE⟧, ⟦GOLD⟧, ⟦FROST⟧)\n` +
            `**Tier 3 (Epic - 750 QP):** Elite Animated Crests (🔥, 👑, ⚡, 💀, 💎)\n` +
            `**Tier 4 (Mythic - 1,500 QP):** Legendary Overriding Titles ([Warlord], [GOD-TIER], [Immortal], [Apex])\n\n` +
            `*Select an item below to purchase with your Quest Points!*`
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
        'modal_create_raffle',
        'modal_create_auction',
        'modal_add_shop',
        'modal_vc_snapshot',
        'modal_reward_member',
        'modal_create_quiz',
        'modal_setup_live_quiz',
        'modal_create_poll',
        'modal_create_battle',
      ];
      if (
        adminModals.includes(modalId) ||
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

        let ctaText = 'Engage to collect your points';
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
        let messageContent =
          `**${authorDisplayName}** just posted :\n${cleanUrl}\n\n` +
          `**${ctaText}**\n` +
          `Expires <t:${expireTimestampSec}:R>`;

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
              text: 'Powered by Questify Gamification',
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
          content: `✅ Successfully broadcasted new Questify tweet card to this channel! (Tweet ID: \`${tweetId}\`)`,
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
          .setTitle('🎟️ New Questify Raffle Launched!')
          .setDescription(
            `**Prize**: ${prize}\n` +
            `**Ticket Cost**: ${cost} 🪙 Quest Points\n` +
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

      // --- MODAL: LINK WALLET ---
      if (modalId === 'modal_link_wallet') {
        await interaction.deferReply({ ephemeral: true });

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

        return interaction.editReply({
          content:
            `✅ **Payout Wallet Linked Successfully!**\n\n` +
            `• Address: \`${address}\`\n` +
            `• Network: **${chain}**\n\n` +
            `When you win raffles for USDC, USDT, or crypto, your prizes will be routed here!`,
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
          .setFooter({ text: 'Questify Web3 Reward Manager' })
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
            roleWarning = `\n⚠️ **Notice:** Questify does not have **Manage Roles** permission. Please enable it in Server Settings > Roles so the bot can auto-assign this role upon purchase.`;
          } else if (botMember.roles.highest.position <= targetRole.position) {
            roleWarning = `\n⚠️ **Notice (Role Hierarchy):** Questify's role is positioned **below** <@&${cleanRoleId}> in Server Settings > Roles!\n👉 *Please drag the Questify role ABOVE <@&${cleanRoleId}> to enable automatic role assignment.*`;
          }
        }

        return interaction.editReply({
          content: `✅ Added **${title}** to the Community Marketplace for **${cost} QP**!${roleMention}${roleWarning}`,
        });
      }

      // --- MODAL: VC SNAPSHOT ---
      if (modalId === 'modal_vc_snapshot') {
        await interaction.deferReply({ ephemeral: false });

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
              const member = voiceState.member || (await guild.members.fetch(memberId).catch(() => null));
              if (member && !member.user.bot && !rewardedMemberIds.includes(memberId)) {
                rewardedMemberIds.push(memberId);
              }
            }
          }
        }

        // 2. Check voice channels cache as secondary verification
        const voiceChannels = guild.channels.cache.filter((c) => c.isVoiceBased());
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
          return interaction.editReply({
            content: '⚠️ No active members found in any voice channels right now. (Make sure members are connected to a voice channel).',
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

        const vcEmbed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('🎙️ Voice Chat Attendance Snapshot Rewarded!')
          .setDescription(
            `**Event:** ${note}\n` +
            `👥 **Members Rewarded:** ${rewardedMemberIds.length}\n` +
            `🪙 **Points Awarded:** +${rewardPoints} QP each\n` +
            `✨ **XP Awarded:** +${rewardXp} XP each\n\n` +
            `**Attendees:**\n${mentions}${extraCount}`
          )
          .setFooter({ text: 'Questify Voice Engagement Tracking' })
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
          .setTitle('🎁 Questify Member Rewarded!')
          .setDescription(
            `Admin <@${discordId}> has adjusted stats for <@${targetId}>:\n\n` +
            `🪙 **Quest Points:** ${deltaPoints >= 0 ? '+' : ''}${deltaPoints.toLocaleString()} QP (Balance: **${newPoints.toLocaleString()} QP**)\n` +
            `✨ **XP:** ${deltaXp >= 0 ? '+' : ''}${deltaXp.toLocaleString()} XP (Total: **${newXp.toLocaleString()} XP**, Level **${newLevel}**)\n` +
            `📝 **Reason:** ${reason}`
          )
          .setFooter({ text: 'Questify Economy & Leveling Engine' })
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
          .setFooter({ text: 'Questify Community Polls' });

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
          .setTitle('🎊 Questify Raffle Winner Announced!')
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

        const { data: userRecord } = await supabase
          .from('users')
          .select('total_points')
          .eq('guild_id', guildId)
          .eq('discord_id', discordId)
          .maybeSingle();

        const userPoints = Number(userRecord?.total_points || 0);
        if (userPoints < cost) {
          return interaction.editReply({
            content: `❌ Insufficient Quest Points! You need **${cost} QP**, but currently have **${userPoints} QP**.`,
          });
        }

        // Deduct points
        await supabase
          .from('users')
          .update({ total_points: userPoints - cost })
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
                `\n⚠️ **Role Not Auto-Assigned (Missing Permission):** Questify is missing the **Manage Roles** permission!\n` +
                `👉 *Admin Action:* Grant Questify the "Manage Roles" permission in Server Settings > Roles, then grant <@&${cleanRoleId}> to <@${discordId}>.`;
            } else if (botMember.roles.highest.position <= targetRole.position) {
              roleSuccessNote =
                `\n⚠️ **Role Not Auto-Assigned (Role Hierarchy):** Questify's role is positioned below <@&${cleanRoleId}>!\n` +
                `👉 *Admin Action:* In **Server Settings > Roles**, drag the **Questify** role **ABOVE** <@&${cleanRoleId}>, then assign the role to <@${discordId}>.`;
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
              `👉 *Admin Action:* Make sure Questify's role is above <@&${cleanRoleId}> in Server Settings > Roles with "Manage Roles" enabled.`;
          }
        }

        // Post purchase log to audit channel if available
        try {
          const logChannel = interaction.guild.channels.cache.find(
            c =>
              (c.name === 'questify-logs' ||
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
                `🪙 **Paid:** **${cost} QP**\n` +
                `🧾 **Receipt ID:** \`#REC-${receiptId}\`\n` +
                `🎖️ **Role Attached:** ${cleanRoleId ? `<@&${cleanRoleId}>` : 'None'}\n` +
                `⚡ **Role Status:** ${
                  cleanRoleId
                    ? roleGranted
                      ? '✅ Auto-assigned successfully'
                      : '⚠️ Manual action required (Drag Questify role above this role)'
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
            `You purchased **${item.title}** for **${cost} QP**!\n\n` +
            `🧾 **Receipt ID:** \`#REC-${receiptId}\`\n` +
            `💰 **Remaining Balance:** ${(userPoints - cost).toLocaleString()} QP\n` +
            `📅 **Date:** <t:${Math.floor(Date.now() / 1000)}:f>` +
            roleSuccessNote
          )
          .setFooter({ text: 'Questify Community Marketplace • Save your Receipt ID' });

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
          .setFooter({ text: 'Questify Community Polls' });

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
    }
  },
};
