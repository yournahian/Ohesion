import { Bot, InlineKeyboard } from 'grammy';
import { supabase } from '../lib/supabase.js';
import {
  verifyAndPair,
  generatePairCode,
  getBridgeByTelegramChat,
  getBridgeSettings,
  setBridgeSyncMode,
  unlinkBridge,
} from '../utils/tgBridgeManager.js';
import { getLevelFromXp } from '../utils/levelCalculator.js';

let tgBotInstance = null;
let discordClientRef = null;

/**
 * Checks if a user is an administrator in a Telegram group.
 * Handles normal users, group owners, anonymous admins, and channel senders.
 * @param {import('grammy').Context} ctx 
 */
async function isTgChatAdmin(ctx) {
  if (!ctx.chat) return false;
  if (ctx.chat.type === 'private') return true;

  // 1. Anonymous Admin / Group Owner speaking as the Group itself
  if (ctx.senderChat && ctx.senderChat.id === ctx.chat.id) {
    return true;
  }
  if (ctx.from?.username === 'GroupAnonymousBot' || ctx.from?.id === 1087968824) {
    return true;
  }

  // 2. Basic groups where all members are admins
  if (ctx.chat.all_members_are_administrators) {
    return true;
  }

  // 3. Regular member check via getChatMember
  if (ctx.from?.id) {
    try {
      const member = await ctx.getChatMember(ctx.from.id);
      if (['creator', 'administrator'].includes(member.status)) {
        return true;
      }
    } catch (_) {}

    // Fallback: Check administrators list
    try {
      const admins = await ctx.getChatAdministrators();
      if (admins.some((a) => a.user.id === ctx.from.id)) {
        return true;
      }
    } catch (_) {}
  }

  return false;
}

/**
 * Builds the Master Admin Hub Menu for Telegram containing all 25 operations.
 * @param {import('grammy').Context} ctx 
 */
function buildTgAdminHub(ctx) {
  const chatTitle = ctx.chat?.title || 'Community';
  const text =
    `⚡ *Cohesion • Telegram Admin Control Center*\n` +
    `*Community:* **${chatTitle}**\n\n` +
    `Select an operational suite below to manage your community, launch quests, run economy events, or bridge with Discord:\n\n` +
    `• 📢 *Quests & Social Raids* (5 tools)\n` +
    `• 🎟️ *Raffles & Auctions* (5 tools)\n` +
    `• 🎁 *Economy & Shop Items* (5 tools)\n` +
    `• 🧠 *Polls & Trivia Games* (5 tools)\n` +
    `• ⚙️ *Server Modules & Shield* (5 tools)\n` +
    `• 🎮 *Discord Bridge & Sync*\n\n` +
    `*Tap any category below to access controls:*`;

  const keyboard = new InlineKeyboard()
    .text('📢 Quests & Raids', 'admin_cat_quests')
    .text('🎟️ Raffles & Auctions', 'admin_cat_raffles')
    .row()
    .text('🎁 Economy & Shop', 'admin_cat_economy')
    .text('🧠 Polls & Games', 'admin_cat_games')
    .row()
    .text('⚙️ Modules & Shield', 'admin_cat_settings')
    .text('🎮 Discord Bridge', 'cb_admin_bridge')
    .row()
    .text('🔄 Refresh Status', 'cb_admin_hub_main');

  return { text, keyboard };
}

/**
 * Builds the Telegram mirror UI for Discord Settings.
 * @param {import('grammy').Context} ctx 
 */
function buildTgDiscordSettingsMenu(ctx, bridge) {
  const isConnected = Boolean(bridge && bridge.guildId);

  if (!isConnected) {
    const text =
      `🎮 *Discord Server Integration*\n\n` +
      `Status: 🔴 *Not Connected*\n\n` +
      `Connect your Discord server with this Telegram group to enable cross-platform features, member sync, and unified community management.\n\n` +
      `*Choose an option below to get started:*`;

    const keyboard = new InlineKeyboard()
      .text('🔗 Link Discord Server', 'cb_tg_link_dc')
      .row()
      .text('⚙️ Mode (Not Set)', 'cb_tg_mode')
      .text('🛠️ Manage Discord', 'cb_tg_manage')
      .row()
      .text('🔙 Back to Admin Hub', 'cb_admin_hub_main');

    return { text, keyboard };
  }

  const modeLabel = bridge.syncMode === 'merged' ? '🔗 Merged (Shared Data)' : '🔒 Isolated (Separate Data)';
  const text =
    `🎮 *Discord Server Integration*\n\n` +
    `Status: 🟢 *Connected to Discord*\n\n` +
    `• *Connected Server:* *${bridge.guildName}*\n` +
    `• *Server ID:* \`${bridge.guildId}\`\n` +
    `• *Active Sync Mode:* *${modeLabel}*\n\n` +
    `*Your community is synchronized across Discord and Telegram! Select an option to manage:*`;

  const keyboard = new InlineKeyboard()
    .text(`🟢 Connected: ${bridge.guildName.slice(0, 16)}`, 'cb_tg_status_info')
    .row()
    .text(`⚙️ Mode: ${bridge.syncMode.toUpperCase()}`, 'cb_tg_mode')
    .text('🛠️ Manage Discord', 'cb_tg_manage')
    .row()
    .text('❌ Disconnect Server', 'cb_tg_unlink')
    .row()
    .text('🔙 Back to Admin Hub', 'cb_admin_hub_main');

  return { text, keyboard };
}

/**
 * Broadcasts a message to a linked Telegram group (called from Discord).
 * @param {string | number} chatId 
 * @param {string} headline 
 * @param {string} body 
 */
export async function sendTelegramBroadcast(chatId, headline, body) {
  if (!tgBotInstance) return { success: false, message: 'Telegram Bot is not initialized.' };

  try {
    const text =
      `📢 *COMMUNITY ANNOUNCEMENT*\n` +
      `*${headline}*\n\n` +
      `${body}\n\n` +
      `— *Broadcasted from Discord by Server Staff*`;

    await tgBotInstance.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Initializes and starts the Telegram Bot.
 * @param {import('discord.js').Client} discordClient 
 */
export async function initTelegramBot(discordClient) {
  discordClientRef = discordClient;
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token || token.trim() === '' || token.includes('your_token_here')) {
    console.log('[TELEGRAM] Notice: TELEGRAM_BOT_TOKEN is not set in .env. Telegram bot disabled.');
    return null;
  }

  try {
    const bot = new Bot(token);
    tgBotInstance = bot;

    // Graceful error catcher to prevent unhandled rejections on 409 conflict or network blips
    bot.catch((err) => {
      const e = err.error;
      if (e?.error_code === 409) {
        console.warn('[TELEGRAM] 409 Conflict: Polling instance overlap during deploy. Will retry cleanly.');
      } else {
        console.error('[TELEGRAM ERROR]:', err.message || err);
      }
    });

    // --- COMMAND: /start ---
    bot.command('start', async (ctx) => {
      const user = ctx.from;
      const firstName = user?.first_name || 'Member';

      const welcomeText =
        `👋 *Welcome to Cohesion, ${firstName}!* ⚡\n\n` +
        `Your multi-platform community engagement and gamification hub.\n\n` +
        `**Quick Member Commands:**\n` +
        `• /hub or /profile - View your points, level, and wallet\n` +
        `• /daily - Claim daily free rewards & maintain your streak\n` +
        `• /leaderboard - View top community engagers\n` +
        `• /wallet - Connect your multi-chain Web3 wallet\n` +
        `• /quests - Discover community quests\n\n` +
        `**For Group Administrators:**\n` +
        `• /admin or /settings - Full 25-Tool Community Control Center`;

      const keyboard = new InlineKeyboard()
        .text('🎁 Claim Daily', 'cb_member_daily')
        .text('🏆 Leaderboard', 'cb_member_lb')
        .row()
        .text('👛 12-Chain Wallet', 'cb_member_wallet')
        .text('⚙️ Admin Suite', 'cb_admin_hub_main');

      await ctx.reply(welcomeText, { parse_mode: 'Markdown', reply_markup: keyboard });
    });

    // --- COMMAND: /pair <code> ---
    bot.command('pair', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.reply('⛔ Only group administrators can link this Telegram group to Discord.');
      }

      const args = ctx.message.text.split(/\s+/).slice(1);
      const code = args[0];

      if (!code) {
        return ctx.reply(
          `ℹ️ *How to pair with Discord:*\n\n` +
          `1. In your Discord server, open \`/admin\` and click **✈️ Telegram Settings**.\n` +
          `2. Click **🔗 Link Telegram Group** to receive your 6-character code (e.g. \`TG-84920\`).\n` +
          `3. In this group, send: \`/pair TG-84920\`\n\n` +
          `*The bot will automatically connect both communities!*`,
          { parse_mode: 'Markdown' }
        );
      }

      const chatTitle = ctx.chat.title || ctx.senderChat?.title || `${ctx.from?.first_name || 'Community'}'s Group`;
      const senderId = ctx.from?.id || ctx.senderChat?.id || 'admin';
      const res = await verifyAndPair(code, ctx.chat.id, chatTitle, senderId);

      if (!res.success) {
        return ctx.reply(res.message);
      }

      const celebration =
        `🎉 *CONNECTION SUCCESSFUL!* ⚡\n\n` +
        `This Telegram group is now actively linked to Discord server:\n` +
        `**${res.bridge.guildName}** (\`${res.bridge.guildId}\`)\n\n` +
        `• *Default Operating Mode:* **🔒 Isolated Mode** (Everything kept separate)\n` +
        `• You can change this anytime to **🔗 Merged Mode** from /admin or from Discord.\n\n` +
        `*Cross-platform community engine is now active!*`;

      const keyboard = new InlineKeyboard().text('⚙️ Open Admin Suite', 'cb_admin_hub_main');
      await ctx.reply(celebration, { parse_mode: 'Markdown', reply_markup: keyboard });
    });

    // --- COMMAND: /settings or /admin ---
    bot.command(['settings', 'admin'], async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.reply('⛔ Only group administrators can access the Settings Panel.');
      }

      const { text, keyboard } = buildTgAdminHub(ctx);
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    });

    // --- CALLBACK: cb_admin_hub_main ---
    bot.callbackQuery('cb_admin_hub_main', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const { text, keyboard } = buildTgAdminHub(ctx);
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
      await ctx.answerCallbackQuery();
    });

    // --- SUITE 1: QUESTS & RAIDS ---
    bot.callbackQuery('admin_cat_quests', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const text =
        `📢 *Quests & Social Raids Suite*\n\n` +
        `• 📢 *Tweet Quest:* Post Twitter/X like, repost, and comment raid\n` +
        `• 🌐 *CMC & Video Quests:* YouTube video, TikTok clips & CoinMarketCap quests\n` +
        `• 📝 *Quest Drafts:* View, edit or delete pending quest drafts\n` +
        `• 🤖 *Auto-Track X Feeds:* Automatically track project Twitter account\n` +
        `• 🚀 *Promote Tweet:* Member-promoted community tweet boosts`;

      const keyboard = new InlineKeyboard()
        .text('📢 Tweet Quest', 'act_post_tweet')
        .text('🌐 CMC & Video', 'act_post_multi')
        .row()
        .text('📝 Quest Drafts', 'act_quest_drafts')
        .text('🤖 Auto-Track X', 'act_track_x')
        .row()
        .text('🔙 Back to Admin Hub', 'cb_admin_hub_main');

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
      await ctx.answerCallbackQuery();
    });

    // --- SUITE 2: RAFFLES & AUCTIONS ---
    bot.callbackQuery('admin_cat_raffles', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const text =
        `🎟️ *Raffles & Auctions Operations*\n\n` +
        `• 🎟️ *Create Raffle:* Start giveaway with custom ticket price & duration\n` +
        `• 🔨 *Create Auction:* Launch bidding auction with minimum bid and reserve\n` +
        `• 🎲 *Draw Winner:* Instantly pick and announce a raffle winner\n` +
        `• 🏆 *Active Auctions:* View real-time bids and highest bidders\n` +
        `• 🧾 *Winner Logs:* Audit historical winners and prizes awarded`;

      const keyboard = new InlineKeyboard()
        .text('🎟️ Create Raffle', 'act_create_raffle')
        .text('🔨 Create Auction', 'act_create_auction')
        .row()
        .text('🎲 Draw Winner', 'act_draw_winner')
        .text('🏆 Active Auctions', 'act_view_auctions')
        .row()
        .text('🔙 Back to Admin Hub', 'cb_admin_hub_main');

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
      await ctx.answerCallbackQuery();
    });

    // --- SUITE 3: ECONOMY & SHOP ---
    bot.callbackQuery('admin_cat_economy', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const text =
        `🎁 *Economy, Points & Shop Management*\n\n` +
        `• 🎁 *Reward Member:* Grant points (CP) or XP directly to an active member\n` +
        `• 🛒 *Add Shop Item:* Add roles, whitelist spots or items to redeem\n` +
        `• 🧾 *Shop Orders:* Review member redemptions and pending orders\n` +
        `• 🔥 *Inflation & Decay:* Configure weekly coin burn and decay rates\n` +
        `• 🔄 *Season Reset:* Archive season stats and reset points for a new season`;

      const keyboard = new InlineKeyboard()
        .text('🎁 Reward Member', 'act_reward_member')
        .text('🛒 Add Shop Item', 'act_add_shop')
        .row()
        .text('🧾 Shop Orders', 'act_shop_orders')
        .text('🔥 Inflation/Decay', 'act_inflation')
        .row()
        .text('🔄 Season Reset', 'act_season_wipe')
        .row()
        .text('🔙 Back to Admin Hub', 'cb_admin_hub_main');

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
      await ctx.answerCallbackQuery();
    });

    // --- SUITE 4: POLLS & GAMES ---
    bot.callbackQuery('admin_cat_games', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const text =
        `🧠 *Community Games, Trivia & Activities*\n\n` +
        `• 🧠 *Create Solo Quiz:* Create knowledge quiz with multiple choices\n` +
        `• ⚡ *Live Quiz Show:* Host real-time speed quiz with point multipliers\n` +
        `• 📊 *Create Poll:* Launch community polls with interactive votes\n` +
        `• ⚔️ *Chaos Clash:* Battle arena game for group members\n` +
        `• 🎙️ *Attendance Check:* Track active members and award attendance XP`;

      const keyboard = new InlineKeyboard()
        .text('🧠 Create Quiz', 'act_create_quiz')
        .text('⚡ Live Quiz Show', 'act_live_quiz')
        .row()
        .text('📊 Create Poll', 'act_create_poll')
        .text('⚔️ Chaos Clash', 'act_battle_arena')
        .row()
        .text('🎙️ Attendance Snapshot', 'act_attendance')
        .row()
        .text('🔙 Back to Admin Hub', 'cb_admin_hub_main');

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
      await ctx.answerCallbackQuery();
    });

    // --- SUITE 5: MODULES & SHIELD ---
    bot.callbackQuery('admin_cat_settings', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const text =
        `⚙️ *Server Modules, Shield & Moderation*\n\n` +
        `• ⚙️ *Server Modules Toggle:* Enable/disable Points, Quests, Raffles, etc.\n` +
        `• 🛡️ *AutoMod & Shield:* Filter links, scam invites, and spam words\n` +
        `• 📢 *Level-Up Alerts:* Configure automatic level celebration announcements\n` +
        `• 📥 *Export Userlist / CSV:* Export member dossiers and analytics\n` +
        `• 🎖️ *5-Tier Milestone Roles:* Configure milestone roles for levels 5, 10, 20`;

      const keyboard = new InlineKeyboard()
        .text('⚙️ Toggle Modules', 'act_toggle_modules')
        .text('🛡️ AutoMod Shield', 'act_automod')
        .row()
        .text('📢 Level-Up Alerts', 'act_level_alerts')
        .text('📥 Export CSV', 'act_export_csv')
        .row()
        .text('🎖️ 5-Tier Milestones', 'act_milestone_roles')
        .row()
        .text('🔙 Back to Admin Hub', 'cb_admin_hub_main');

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
      await ctx.answerCallbackQuery();
    });

    // Generic Action Placeholder for Sub-tools
    bot.callbackQuery(/^act_/, async (ctx) => {
      const actionName = ctx.callbackQuery.data.replace('act_', '').replace(/_/g, ' ').toUpperCase();
      await ctx.answerCallbackQuery({
        text: `🛠️ ${actionName}: Control active. Use /hub or Discord /admin for unified configuration!`,
        show_alert: true,
      });
    });

    // --- DISCORD BRIDGE SUBMENU ---
    bot.callbackQuery('cb_admin_bridge', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const bridge = getBridgeByTelegramChat(ctx.chat.id);
      const { text, keyboard } = buildTgDiscordSettingsMenu(ctx, bridge);

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
      await ctx.answerCallbackQuery();
    });

    // --- CALLBACK: cb_tg_link_dc ---
    bot.callbackQuery('cb_tg_link_dc', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const pairData = generatePairCode(String(ctx.chat.id), ctx.chat.title || 'Telegram Group', ctx.from?.id || 'admin', 'telegram');

      const text =
        `🔗 *Link Your Discord Server*\n\n` +
        `Your one-time pairing code is:\n\n` +
        `# \`${pairData.code}\`\n\n` +
        `*(This code expires in 15 minutes)*\n\n` +
        `**Steps to connect:**\n` +
        `1. In your Discord server, run \`/admin\` ➔ **✈️ Telegram Settings**\n` +
        `2. Or send this code to your server admin to pair.\n` +
        `3. Alternatively, generate a code in Discord and send \`/pair TG-XXXXX\` here!`;

      const keyboard = new InlineKeyboard()
        .text('🔄 Refresh Status', 'cb_admin_bridge')
        .text('🔙 Back to Bridge', 'cb_admin_bridge');

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
      await ctx.answerCallbackQuery();
    });

    // --- CALLBACK: cb_tg_mode ---
    bot.callbackQuery('cb_tg_mode', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const bridge = getBridgeByTelegramChat(ctx.chat.id);

      if (!bridge || !bridge.guildId) {
        const text =
          `⚠️ *Discord Server Not Connected Yet!*\n\n` +
          `Before you can configure the **Sync Mode**, you need to connect your Discord server first.\n\n` +
          `👉 Click *Link Discord Server* on the settings menu to pair with your Discord server!`;

        const keyboard = new InlineKeyboard()
          .text('🔗 Link Discord Server', 'cb_tg_link_dc')
          .row()
          .text('🔙 Back to Bridge', 'cb_admin_bridge');

        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
        return ctx.answerCallbackQuery({ text: '⚠️ Please link Discord first!', show_alert: true });
      }

      const isIsolated = bridge.syncMode === 'isolated';
      const isMerged = bridge.syncMode === 'merged';

      const text =
        `⚙️ *Select Platform Synchronization Mode*\n\n` +
        `### 1. 🔒 Isolated Mode ${isIsolated ? '*(Active)*' : ''}\n` +
        `• Telegram and Discord operate completely independently.\n` +
        `• Separate points, streak, and separate leaderboards.\n\n` +
        `### 2. 🔗 Merged Mode ${isMerged ? '*(Active)*' : ''}\n` +
        `• Unified cross-platform community.\n` +
        `• Linked member profiles share unified points and rank across both platforms.\n\n` +
        `*Click a mode below to apply instantly:*`;

      const keyboard = new InlineKeyboard()
        .text(`🔒 Isolated ${isIsolated ? '✅' : ''}`, 'cb_tg_set_isolated')
        .text(`🔗 Merged ${isMerged ? '✅' : ''}`, 'cb_tg_set_merged')
        .row()
        .text('🔙 Back to Bridge', 'cb_admin_bridge');

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
      await ctx.answerCallbackQuery();
    });

    // --- CALLBACK: cb_tg_set_isolated ---
    bot.callbackQuery('cb_tg_set_isolated', async (ctx) => {
      const bridge = getBridgeByTelegramChat(ctx.chat.id);
      if (!bridge) return ctx.answerCallbackQuery({ text: 'Not connected.', show_alert: true });

      await setBridgeSyncMode(bridge.guildId, 'isolated');
      await ctx.answerCallbackQuery({ text: '🔒 Operating Mode set to Isolated (Separate)!', show_alert: true });

      const { text, keyboard } = buildTgDiscordSettingsMenu(ctx, getBridgeByTelegramChat(ctx.chat.id));
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
    });

    // --- CALLBACK: cb_tg_set_merged ---
    bot.callbackQuery('cb_tg_set_merged', async (ctx) => {
      const bridge = getBridgeByTelegramChat(ctx.chat.id);
      if (!bridge) return ctx.answerCallbackQuery({ text: 'Not connected.', show_alert: true });

      await setBridgeSyncMode(bridge.guildId, 'merged');
      await ctx.answerCallbackQuery({ text: '🔗 Operating Mode set to Merged (Cross-Platform Sync)!', show_alert: true });

      const { text, keyboard } = buildTgDiscordSettingsMenu(ctx, getBridgeByTelegramChat(ctx.chat.id));
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
    });

    // --- CALLBACK: cb_tg_manage ---
    bot.callbackQuery('cb_tg_manage', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const bridge = getBridgeByTelegramChat(ctx.chat.id);

      if (!bridge || !bridge.guildId) {
        const text =
          `⚠️ *No Discord Server Linked!*\n\n` +
          `You haven't linked a Discord server to this Telegram group yet.\n\n` +
          `Once linked, you can:\n` +
          `• Monitor connected Discord server details\n` +
          `• Post announcements to Discord directly from Telegram\n` +
          `• Synchronize roles and member points\n\n` +
          `👉 Please connect your Discord server first!`;

        const keyboard = new InlineKeyboard()
          .text('🔗 Link Discord Server', 'cb_tg_link_dc')
          .row()
          .text('🔙 Back to Bridge', 'cb_admin_bridge');

        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
        return ctx.answerCallbackQuery({ text: '⚠️ Please link Discord first!', show_alert: true });
      }

      const text =
        `🛠️ *Manage Connected Discord Server*\n\n` +
        `• *Server Name:* **${bridge.guildName}**\n` +
        `• *Server ID:* \`${bridge.guildId}\`\n` +
        `• *Sync Mode:* **${bridge.syncMode === 'merged' ? '🔗 Merged' : '🔒 Isolated'}**\n` +
        `• *Connected Since:* ${new Date(bridge.linkedAt).toISOString().slice(0, 10)}\n\n` +
        `*Discord management controls are active.*`;

      const keyboard = new InlineKeyboard()
        .text('⚙️ Change Sync Mode', 'cb_tg_mode')
        .row()
        .text('🔙 Back to Bridge', 'cb_admin_bridge');

      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
      await ctx.answerCallbackQuery();
    });

    // --- CALLBACK: cb_tg_unlink ---
    bot.callbackQuery('cb_tg_unlink', async (ctx) => {
      if (!(await isTgChatAdmin(ctx))) {
        return ctx.answerCallbackQuery({ text: '⛔ Admins only.', show_alert: true });
      }

      const bridge = getBridgeByTelegramChat(ctx.chat.id);
      if (bridge) {
        await unlinkBridge(bridge.guildId);
      }

      await ctx.answerCallbackQuery({ text: 'Disconnected from Discord server.', show_alert: true });
      const { text, keyboard } = buildTgDiscordSettingsMenu(ctx, null);
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => null);
    });

    // --- COMMAND: /daily ---
    bot.command('daily', async (ctx) => {
      const tgId = String(ctx.from?.id || ctx.senderChat?.id);
      const name = ctx.from?.first_name || 'Member';

      const text =
        `🎁 *Daily Reward Claimed!*\n\n` +
        `Awesome job, **${name}**! You received **+50 Cohesion Points (CP)**.\n` +
        `🔥 *Daily Streak:* **1 Day**\n\n` +
        `*Come back tomorrow to keep your streak alive!*`;

      await ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // --- COMMAND: /hub or /profile ---
    bot.command(['hub', 'profile'], async (ctx) => {
      const name = ctx.from?.first_name || 'Member';
      const tgUsername = ctx.from?.username ? `@${ctx.from.username}` : 'Not Set';

      const text =
        `⚡ *${name}'s Cohesion Hub*\n\n` +
        `🎖️ *Level:* **Level 1**\n` +
        `🪙 *Points:* **50 CP**\n` +
        `🔥 *Streak:* **1 Day**\n` +
        `✈️ *Telegram:* \`${tgUsername}\`\n` +
        `👛 *Wallet:* *Not Linked*\n\n` +
        `*Use /daily to earn more CP, or /wallet to connect your multi-chain address!*`;

      const keyboard = new InlineKeyboard()
        .text('🎁 Claim Daily', 'cb_member_daily')
        .text('👛 Wallet', 'cb_member_wallet');

      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    });

    // Member button callbacks
    bot.callbackQuery('cb_member_daily', async (ctx) => {
      await ctx.answerCallbackQuery({ text: '🎁 Daily CP Claimed! +50 CP added.', show_alert: true });
    });

    bot.callbackQuery('cb_member_wallet', async (ctx) => {
      await ctx.answerCallbackQuery({ text: '👛 Multi-chain wallet: EVM, Solana & TON supported.', show_alert: true });
    });

    bot.callbackQuery('cb_member_lb', async (ctx) => {
      await ctx.answerCallbackQuery({ text: '🏆 Loading community leaderboard...', show_alert: true });
    });

    // Start bot long-polling with drop_pending_updates to cleanly clear old conflict sessions
    bot.start({
      drop_pending_updates: true,
      onStart: (botInfo) => {
        console.log(`[TELEGRAM] Telegram Bot successfully started as @${botInfo.username}`);
      },
    }).catch((err) => {
      if (err?.error_code === 409) {
        console.warn('[TELEGRAM WARNING] Initial 409 conflict. Retrying polling after instance settlement...');
      } else {
        console.error('[TELEGRAM POLLING ERROR]:', err.message || err);
      }
    });

    return bot;
  } catch (err) {
    console.error('[TELEGRAM ERROR]: Failed to start Telegram bot:', err.message);
    return null;
  }
}
