import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Explore all features, commands, and interactive decks available in Cohesion.'),

  async execute(interaction) {
    const mainEmbed = new EmbedBuilder()
      .setColor(0x5865f2) // Cohesion Blurple
      .setTitle('🌀 Cohesion Ecosystem — Member & Admin Guide')
      .setDescription(
        'Welcome to **Cohesion**! A 100% UI-driven gamification, social growth, and community rewards ecosystem.\n\n' +
        '**⚡ Key Highlights:**\n' +
        '• **Cohesion Hub (`/hub`):** Your personal command center for daily claims, multi-chain wallets, social connections, and marketplace.\n' +
        '• **Admin Control Deck (`/admin`):** 100% visual control center with 20+ modules (Zero complex syntax required!).\n' +
        '• **Multi-Chain Wallet Validator:** Auto-detects 12 major blockchains (ETH, SOL, BTC, SEI, XION, AVAX, BSC, ZKS, ADA, RONIN, Bifrost, Polkadot).\n' +
        '• **Multi-Platform Quests:** Twitter/X, CoinMarketCap Gravity, YouTube, TikTok, and external visits.\n' +
        '• **Real-Time Economy:** Raffles (1-999 spots), live escrow auctions, marketplace roles, and weekly deflationary burns.\n\n' +
        '*Select a module below or use the quick buttons for instant access!*'
      )
      .addFields(
        {
          name: '🎮 Core Member Decks',
          value: '`/hub` — Open interactive profile & action deck\n`/rank` — View visual level & tier progress\n`/leaderboard` — Server XP & CP leaderboard\n`/profile` — Comprehensive stats & linked wallets',
          inline: false,
        },
        {
          name: '📢 Social & Quests',
          value: '`/post-tweet` or `/tweet` — Launch tracked Twitter quest\n`/connect-twitter` — Link your X account\n`/submit-quest` — Submit engagement proof URL',
          inline: false,
        },
        {
          name: '🛠️ Server Management',
          value: '`/admin` — Open 20-button visual command center\n`/setup` — Automatically deploy channels & roles\n`/raffle` — Create point-based giveaways',
          inline: false,
        }
      )
      .setFooter({ text: 'Cohesion • 100% UI Driven Gamification Ecosystem' })
      .setTimestamp();

    const rowButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('hub_refresh')
        .setLabel('Open Hub')
        .setEmoji('🌀')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('hub_daily_claim')
        .setLabel('Claim Daily CP')
        .setEmoji('🎁')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('hub_rank_card')
        .setLabel('My Rank')
        .setEmoji('🪪')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('hub_link_wallet')
        .setLabel('12-Chain Wallet')
        .setEmoji('👛')
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
      embeds: [mainEmbed],
      components: [rowButtons],
      ephemeral: true,
    });
  },
};
