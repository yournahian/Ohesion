import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { supabase } from '../../lib/supabase.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Displays the top 10 members in this server ranked by XP or Cohesion Points.')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Sort ranking by XP or Cohesion Points (CP)')
        .setRequired(false)
        .addChoices(
          { name: '✨ Chat & Activity XP', value: 'xp' },
          { name: '🪙 Cohesion Points (CP)', value: 'points' }
        )
    ),

  async execute(interaction) {
    const sortType = interaction.options.getString('type') || 'xp';
    const sortColumn = sortType === 'points' ? 'total_points' : 'xp';
    const guildId = interaction.guildId;
    const guild =
      interaction.guild ||
      (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);

    await interaction.deferReply();

    // Query top 10 users ordered by selected sort column descending
    const { data: topUsers, error } = await supabase
      .from('users')
      .select('discord_id, xp, level, total_points')
      .eq('guild_id', guildId)
      .order(sortColumn, { ascending: false })
      .limit(10);

    if (error) {
      console.error('[LEADERBOARD] Query error:', error);
      return interaction.editReply({ content: '❌ Failed to load server leaderboard.' });
    }

    if (!topUsers || topUsers.length === 0) {
      return interaction.editReply({
        content: '📊 No members have earned XP or Cohesion Points in this server yet!',
      });
    }

    const medals = ['🥇', '🥈', '🥉'];

    const leaderboardList = topUsers
      .map((user, index) => {
        const medal = medals[index] || `**#${index + 1}**`;
        const xpFormatted = Number(user.xp || 0).toLocaleString();
        const pointsFormatted = Number(user.total_points || 0).toLocaleString();
        return `${medal} <@${user.discord_id}>\n   ↳ Level **${user.level || 1}** • **${xpFormatted}** XP • **${pointsFormatted}** CP`;
      })
      .join('\n\n');

    const typeTitle = sortType === 'points' ? '🪙 Cohesion Points (CP)' : '✨ XP & Level';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🏆 ${guild?.name || 'Server'} — Leaderboard (${typeTitle})`)
      .setDescription(leaderboardList)
      .setFooter({ text: 'Earn CP & XP by completing quests, active chat & voice • Cohesion' })
      .setTimestamp();

    if (guild) {
      embed.setThumbnail(guild.iconURL({ dynamic: true }));
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
