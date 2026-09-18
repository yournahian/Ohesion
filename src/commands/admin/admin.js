import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';

export default {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Open the visual Questify Admin Control Center to manage quests, raffles, and settings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) &&
      !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: '⛔ You need `Manage Server` permissions to access the Questify Admin Control Center.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const guild =
      interaction.guild ||
      (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);

    if (!guild) {
      return interaction.editReply({
        content:
          '⚠️ Questify is not added to this server as a bot. Please invite Questify to this server using this link:\nhttps://discord.com/oauth2/authorize?client_id=1550543145840934942&permissions=8&scope=bot%20applications.commands',
      });
    }

    // Fetch quick stats
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

    const adminEmbed = new EmbedBuilder()
      .setColor(0x06d6a0) // Emerald Green
      .setAuthor({
        name: `${guild.name} • Questify Admin Control Center`,
        iconURL: guild.iconURL({ dynamic: true }),
      })
      .setTitle('🛠️ Visual Management Dashboard')
      .setDescription(
        'Manage your community gamification without typing long slash commands or memorizing syntax!\n\n' +
        'Click any button below to open an interactive pop-up form or selection menu.'
      )
      .addFields(
        { name: '👥 Tracked Members', value: `**${totalMembersTracked || 0}**`, inline: true },
        { name: '📢 Active Quests', value: `**${activeQuestsCount || 0}**`, inline: true },
        { name: '🎟️ Active Raffles', value: `**${activeRafflesCount || 0}**`, inline: true }
      )
      .setFooter({ text: 'Questify Admin Panel • Single-Click Operations' })
      .setTimestamp();

    // Visual Action Rows
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('admin_post_tweet')
        .setLabel('Post Tweet')
        .setEmoji('📢')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('admin_create_raffle')
        .setLabel('Create Raffle')
        .setEmoji('🎟️')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('admin_create_auction')
        .setLabel('Create Auction')
        .setEmoji('🔨')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('admin_draw_raffle')
        .setLabel('Draw Winner')
        .setEmoji('🎲')
        .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('admin_add_shop')
        .setLabel('Add Shop Item')
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('admin_reward_member')
        .setLabel('Reward Member')
        .setEmoji('🎁')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('admin_vc_snapshot')
        .setLabel('VC Snapshot')
        .setEmoji('🎙️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('admin_overview')
        .setLabel('Refresh Stats')
        .setEmoji('📊')
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({
      embeds: [adminEmbed],
      components: [row1, row2],
    });
  },
};
