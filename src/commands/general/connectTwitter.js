import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { supabase } from '../../lib/supabase.js';

export default {
  data: new SlashCommandBuilder()
    .setName('connect-twitter')
    .setDescription('Link your Twitter / X account to verify engagement and earn points.')
    .addStringOption(option =>
      option
        .setName('username')
        .setDescription('Your Twitter/X handle (without @)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const manualUsername = interaction.options.getString('username');
    const discordId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    // Check existing integration
    const { data: existingIntegration } = await supabase
      .from('user_integrations')
      .select('*')
      .eq('discord_id', discordId)
      .eq('provider', 'twitter')
      .maybeSingle();

    if (manualUsername) {
      const cleanUsername = manualUsername.replace(/^@/, '').trim();

      // Upsert mock/manual integration for development/testing
      const { error } = await supabase.from('user_integrations').upsert(
        {
          discord_id: discordId,
          provider: 'twitter',
          provider_user_id: `dev_${discordId}`,
          provider_username: cleanUsername,
          access_token: 'dev_token_sample',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'discord_id,provider' }
      );

      if (error) {
        console.error('[CONNECT TWITTER ERROR]:', error);
        return interaction.editReply({ content: '❌ Failed to save Twitter connection.' });
      }

      const embed = new EmbedBuilder()
        .setColor(0x1da1f2)
        .setTitle('🔗 Twitter / X Connected!')
        .setDescription(
          `Your Discord account is now linked with **@${cleanUsername}** on X!\n\n` +
          `You can now click **Like ❤️** and **Retweet 🔁** buttons on active tweet quests to claim Cohesion Points (CP).`
        )
        .setThumbnail('https://abs.twimg.com/icons/apple-touch-icon-192x192.png');

      return interaction.editReply({ embeds: [embed] });
    }

    if (existingIntegration) {
      return interaction.editReply({
        content: `✅ Your account is already linked to Twitter user **@${existingIntegration.provider_username || 'Unknown'}**.\nTo update it, run \`/connect-twitter username:YourNewHandle\`.`,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x1da1f2)
      .setTitle('🔗 Connect Your Twitter / X Account')
      .setDescription(
        'To verify your Likes and Retweets and claim points, you need to connect your X account.\n\n' +
        '**For Development / Testing:**\n' +
        'Run `/connect-twitter username:your_handle` to register your handle immediately.\n\n' +
        '*(In production, this button will direct you to the official X OAuth2 authorization portal)*'
      )
      .setThumbnail('https://abs.twimg.com/icons/apple-touch-icon-192x192.png');

    return interaction.editReply({ embeds: [embed] });
  },
};
