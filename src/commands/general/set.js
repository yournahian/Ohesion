import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { detectChain } from '../../utils/walletValidator.js';

export default {
  data: new SlashCommandBuilder()
    .setName('set')
    .setDescription('Connect your multi-chain wallet or social media accounts to Cohesion.')
    .addSubcommand((sub) =>
      sub
        .setName('wallet')
        .setDescription('Connect a crypto payout address (Auto-detects across 12 blockchains)')
        .addStringOption((opt) =>
          opt
            .setName('address')
            .setDescription('Your public wallet address (e.g. EVM 0x..., SOL base58, BTC, SEI, etc.)')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('twitter')
        .setDescription('Connect your Twitter / X username')
        .addStringOption((opt) =>
          opt
            .setName('username')
            .setDescription('Your X handle (without @)')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('coinmarketcap')
        .setDescription('Connect your CoinMarketCap Community / Gravity account')
        .addStringOption((opt) =>
          opt
            .setName('account')
            .setDescription('Your CoinMarketCap username or profile URL')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('youtube')
        .setDescription('Connect your YouTube channel or handle')
        .addStringOption((opt) =>
          opt
            .setName('account')
            .setDescription('Your YouTube handle or channel URL')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('tiktok')
        .setDescription('Connect your TikTok profile handle')
        .addStringOption((opt) =>
          opt
            .setName('account')
            .setDescription('Your TikTok username (without @)')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('telegram')
        .setDescription('Connect your Telegram handle')
        .addStringOption((opt) =>
          opt
            .setName('account')
            .setDescription('Your Telegram username (without @)')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const discordId = interaction.user.id;
    const guildId = interaction.guildId;

    await interaction.deferReply({ ephemeral: true });

    if (subcommand === 'wallet') {
      const address = interaction.options.getString('address').trim();
      const detected = detectChain(address);

      if (!detected.valid) {
        return interaction.editReply({
          content: `❌ **Invalid Wallet Address**: The provided address format is not recognized.\n\n` +
            `• Supported chains: **ETH / EVM, SOL, BTC, SEI, XION, AVAX, BSC, ZKS, ADA, RONIN, Bifrost, Polkadot**.`,
        });
      }

      const { error } = await supabase.from('users').upsert(
        {
          guild_id: guildId,
          discord_id: discordId,
          wallet_address: address,
          wallet_chain: detected.chain,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'guild_id,discord_id' }
      );

      if (error) {
        console.error('[SET WALLET ERROR]:', error);
        return interaction.editReply({ content: '❌ Failed to save wallet address.' });
      }

      const embed = new EmbedBuilder()
        .setColor(0x06d6a0)
        .setTitle('👛 Wallet Connected Successfully!')
        .setDescription(
          `Your payout address has been registered in your Cohesion profile.\n\n` +
          `• **Network Detected:** **${detected.name}** (\`${detected.chain}\`)\n` +
          `• **Address:** \`${address}\`\n\n` +
          `*All raffle wins and auction deliverables on this chain will automatically be routed here!*`
        )
        .setFooter({ text: 'Cohesion 12-Chain Wallet Engine' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // Social subcommands: twitter, coinmarketcap, youtube, tiktok, telegram
    const targetAccount =
      interaction.options.getString('username') ||
      interaction.options.getString('account') ||
      '';
    const cleanAccount = targetAccount.replace(/^@/, '').trim();

    const { error } = await supabase.from('user_integrations').upsert(
      {
        discord_id: discordId,
        provider: subcommand,
        provider_username: cleanAccount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'discord_id,provider' }
    );

    if (error) {
      console.error(`[SET ${subcommand.toUpperCase()} ERROR]:`, error);
      return interaction.editReply({ content: `❌ Failed to save ${subcommand} account.` });
    }

    const platformLabels = {
      twitter: { title: 'Twitter / X', emoji: '🐦', color: 0x1da1f2 },
      coinmarketcap: { title: 'CoinMarketCap Gravity', emoji: '📈', color: 0x2a75d3 },
      youtube: { title: 'YouTube', emoji: '▶️', color: 0xff0000 },
      tiktok: { title: 'TikTok', emoji: '🎵', color: 0x00f2fe },
      telegram: { title: 'Telegram', emoji: '✈️', color: 0x2aabee },
    };

    const info = platformLabels[subcommand] || { title: subcommand, emoji: '🌐', color: 0x5865f2 };

    const embed = new EmbedBuilder()
      .setColor(info.color)
      .setTitle(`${info.emoji} ${info.title} Connected!`)
      .setDescription(
        `Your Discord account is now linked with **@${cleanAccount}** on **${info.title}**!\n\n` +
        `You can now participate in community quests and earn Cohesion Points (CP).`
      )
      .setFooter({ text: 'Cohesion Social Identity Engine' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
