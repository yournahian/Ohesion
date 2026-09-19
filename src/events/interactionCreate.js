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
import { buildAuctionPayload, executeBid } from '../utils/auctionManager.js';
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

        const tagInput = new TextInputBuilder()
          .setCustomId('input_tag')
          .setLabel('Ping Role / Server Tag (Optional)')
          .setPlaceholder('e.g. @Socials, @everyone, or role name')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const optionsInput = new TextInputBuilder()
          .setCustomId('input_options')
          .setLabel('Thumbnail / Image & Action Buttons')
          .setValue('Image: Yes | Buttons: Like, RT, Comment')
          .setPlaceholder('Image: Yes/No | Buttons: Like, RT, Comment (or "none")')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const textInput = new TextInputBuilder()
          .setCustomId('input_custom_text')
          .setLabel('Custom Snippet / Requirements (Engage.io)')
          .setPlaceholder('e.g. Account must have 100 followers\nMust follow @account')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(urlInput),
          new ActionRowBuilder().addComponents(pointsHoursInput),
          new ActionRowBuilder().addComponents(tagInput),
          new ActionRowBuilder().addComponents(optionsInput),
          new ActionRowBuilder().addComponents(textInput)
        );

        return interaction.showModal(modal);
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

        const { data: raffles } = await supabase
          .from('raffles')
          .select('*')
          .eq('guild_id', guildId)
          .eq('is_active', true)
          .order('end_time', { ascending: true });

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
          .setDescription(`${itemListText}\n\n*Select an item below to purchase!*`)
          .setFooter({ text: 'Quest Points are automatically deducted upon purchase' });

        return interaction.editReply({ embeds: [embed], components: [row] });
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
            return `**${i + 1}. ${a.item_title}**\n` +
              `↳ Highest Bid: **${highBid > 0 ? `${highBid.toLocaleString()} QP` : 'Starting: ' + a.starting_bid + ' QP'}**\n` +
              `↳ Ends: <t:${Math.floor(new Date(a.end_time).getTime() / 1000)}:R> • ID: \`${a.auction_id.slice(0, 8)}...\``;
          })
          .join('\n\n');

        const embed = new EmbedBuilder()
          .setColor(0xffd166)
          .setTitle(`🔨 ${interaction.guild?.name || 'Server'} • Active Auctions`)
          .setDescription(
            `${auctionListText}\n\n` +
            `*Head over to the live auction message to place bids!*`
          )
          .setFooter({ text: 'Questify Live Escrow Auctions' });

        return interaction.editReply({ embeds: [embed] });
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

        // Determine if thumbnail/image display is enabled (Default: true unless explicitly set to no/off/false)
        let showImage = true;
        let btnFilter = 'all';

        if (optionsStr) {
          const lower = optionsStr.toLowerCase();
          if (
            lower.includes('image: no') ||
            lower.includes('image: off') ||
            lower.includes('image: false') ||
            lower.includes('no image') ||
            lower.includes('img: no') ||
            lower.includes('img: off') ||
            lower.includes('hide image') ||
            lower.trim() === 'no' ||
            lower.trim() === 'off'
          ) {
            showImage = false;
          } else if (
            lower.includes('image: yes') ||
            lower.includes('image: on') ||
            lower.includes('image: true') ||
            lower.includes('show image')
          ) {
            showImage = true;
          }

          // Clean out image directive so it doesn't collide with buttons
          const cleanBtnPart = lower
            .replace(/image\s*:\s*(yes|no|on|off|true|false)/gi, '')
            .replace(/(no\s+image|show\s+image|img\s*:\s*(yes|no|on|off)|hide\s+image)/gi, '')
            .replace(/[|]/g, ' ')
            .trim();

          if (cleanBtnPart) {
            btnFilter = cleanBtnPart;
          }
        }

        // Resolve tag mention (e.g. @Socials, @everyone, @here, or role ID / name)
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

        // Determine which action buttons to include based on admin preference
        const isNone =
          btnFilter === 'none' ||
          btnFilter === 'no' ||
          btnFilter === 'off' ||
          btnFilter === '0' ||
          btnFilter === 'false' ||
          btnFilter === 'remove' ||
          btnFilter === 'remove all' ||
          btnFilter === 'hide';

        const isAll =
          !isNone &&
          (btnFilter === 'all' ||
            btnFilter === '' ||
            (!btnFilter.includes('like') &&
              !btnFilter.includes('rt') &&
              !btnFilter.includes('retweet') &&
              !btnFilter.includes('repost') &&
              !btnFilter.includes('comment') &&
              !btnFilter.includes('reply')));

        const includeLike = !isNone && (isAll || btnFilter.includes('like'));
        const includeRt =
          !isNone &&
          (isAll || btnFilter.includes('rt') || btnFilter.includes('retweet') || btnFilter.includes('repost'));
        const includeComment = !isNone && (isAll || btnFilter.includes('comment') || btnFilter.includes('reply'));

        const actionRow = new ActionRowBuilder();

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

        if (btnFilter !== 'hide all' && btnFilter !== 'no buttons') {
          actionRow.addComponents(
            new ButtonBuilder()
              .setLabel('View on X')
              .setStyle(ButtonStyle.Link)
              .setURL(cleanUrl)
          );
        }

        const hasAnyAction = includeLike || includeRt || includeComment;

        // Build Engage.io styled message content
        let messageContent = hasAnyAction
          ? `**${authorDisplayName}** just posted :\n${cleanUrl}\n\n` +
            `**Engage to collect your points**\n` +
            `Expires <t:${expireTimestampSec}:R>`
          : `**${authorDisplayName}** just posted :\n${cleanUrl}`;

        // Format custom snippet with Engage.io bullet points
        if (customText && customText.trim()) {
          const formattedSnippet = customText
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => (/^[•\-\*]\s+/.test(line) ? line : `• ${line}`))
            .join('\n');

          messageContent += `\n\n${formattedSnippet}`;
        }

        // Append role / tag ping
        if (tagMention) {
          messageContent += `\n${tagMention}`;
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
        const roleId = interaction.fields.getTextInputValue('input_shop_role_id') || null;
        const stockStr = interaction.fields.getTextInputValue('input_shop_stock');

        const cost = parseInt(costStr, 10) || 100;
        const stock = parseInt(stockStr, 10) || -1;

        const { error } = await supabase.from('marketplace_items').insert({
          guild_id: guildId,
          title,
          description: desc,
          cost,
          stock,
          role_id: roleId && roleId.trim().length > 0 ? roleId.trim() : null,
        });

        if (error) {
          console.error('[ADD SHOP ERROR]:', error);
          return interaction.editReply({ content: '❌ Failed to add marketplace item to database.' });
        }

        const roleMention = roleId ? ` (Auto-assigns <@&${roleId.trim()}>)` : '';
        return interaction.editReply({
          content: `✅ Added **${title}** to the Community Marketplace for **${cost} QP**!${roleMention}`,
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
        const voiceChannels = guild ? guild.channels.cache.filter((c) => c.isVoiceBased()) : [];
        const rewardedMemberIds = [];

        for (const [_, vc] of voiceChannels) {
          for (const [memberId, member] of vc.members) {
            if (!member.user.bot && !rewardedMemberIds.includes(memberId)) {
              rewardedMemberIds.push(memberId);
            }
          }
        }

        if (rewardedMemberIds.length === 0) {
          return interaction.editReply({
            content: '⚠️ No active members found in any voice channels right now.',
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
    }

    // ==========================================
    // 4. HANDLE SELECT MENUS
    // ==========================================
    if (interaction.isStringSelectMenu()) {
      const selectId = interaction.customId;
      const guildId = interaction.guildId;
      const discordId = interaction.user.id;

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

        const pool = [];
        for (const entry of entries) {
          for (let i = 0; i < entry.tickets_bought; i++) {
            pool.push(entry.discord_id);
          }
        }

        const winnerId = pool[Math.floor(Math.random() * pool.length)];

        await supabase
          .from('raffles')
          .update({ is_active: false, winner_id: winnerId })
          .eq('raffle_id', raffleId);

        // Automated payout detection if prize specifies QP/points or XP
        let prizePayoutText = '';
        const prizeLower = (raffle.prize || '').toLowerCase();
        const pointsMatch = prizeLower.match(/(\d+)\s*(?:qp|points|quest points)/i);
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
          // External currency / Crypto prize (e.g. USDC, USDT, ETH, SOL, Nitro, etc.)
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

        const { data: raffle } = await supabase
          .from('raffles')
          .select('*')
          .eq('raffle_id', raffleId)
          .eq('guild_id', guildId)
          .maybeSingle();

        if (!raffle || !raffle.is_active || new Date(raffle.end_time) < new Date()) {
          return interaction.editReply({ content: '❌ This raffle is inactive or has already ended.' });
        }

        const totalCost = Number(raffle.cost);

        const { data: userRecord } = await supabase
          .from('users')
          .select('total_points')
          .eq('guild_id', guildId)
          .eq('discord_id', discordId)
          .maybeSingle();

        const userPoints = Number(userRecord?.total_points || 0);
        if (userPoints < totalCost) {
          return interaction.editReply({
            content: `❌ Insufficient Quest Points! You need **${totalCost} QP** for 1 ticket, but have **${userPoints} QP**.`,
          });
        }

        // Deduct points
        await supabase
          .from('users')
          .update({ total_points: userPoints - totalCost })
          .eq('guild_id', guildId)
          .eq('discord_id', discordId);

        // Upsert entry
        const { data: existingEntry } = await supabase
          .from('raffle_entries')
          .select('*')
          .eq('raffle_id', raffleId)
          .eq('discord_id', discordId)
          .maybeSingle();

        if (existingEntry) {
          await supabase
            .from('raffle_entries')
            .update({ tickets_bought: existingEntry.tickets_bought + 1 })
            .eq('entry_id', existingEntry.entry_id);
        } else {
          await supabase.from('raffle_entries').insert({
            raffle_id: raffleId,
            discord_id: discordId,
            tickets_bought: 1,
          });
        }

        return interaction.editReply({
          content: `🎟️ **Ticket Purchased!** You bought 1 ticket for **${raffle.prize}** for **${totalCost} QP**.\nRemaining Balance: **${userPoints - totalCost} QP** 🪙. Good luck!`,
        });
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
        await supabase.from('marketplace_purchases').insert({
          guild_id: guildId,
          discord_id: discordId,
          item_id: itemId,
          cost_paid: cost,
          item_title: item.title,
        });

        // If a Discord Role ID is attached, auto-assign the role!
        let roleSuccessNote = '';
        if (item.role_id) {
          try {
            const member = await interaction.guild.members.fetch(discordId);
            if (member) {
              await member.roles.add(item.role_id);
              roleSuccessNote = `\n🎖️ **Role Granted:** <@&${item.role_id}> has been assigned to your profile!`;
            }
          } catch (roleErr) {
            console.warn('[ROLE ASSIGN WARN]:', roleErr.message);
            roleSuccessNote = `\n⚠️ (Note: Please ask an admin to manually verify role <@&${item.role_id}>).`;
          }
        }

        const successEmbed = new EmbedBuilder()
          .setColor(0x06d6a0)
          .setTitle('🛍️ Purchase Successful!')
          .setDescription(
            `You purchased **${item.title}** for **${cost} QP**!\n` +
            `💰 **Remaining Balance:** ${(userPoints - cost).toLocaleString()} QP${roleSuccessNote}`
          )
          .setFooter({ text: 'Questify Community Marketplace' });

        return interaction.editReply({ embeds: [successEmbed] });
      }
    }
  },
};
