import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { supabase } from '../../lib/supabase.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Displays the top 10 members in this server ranked by XP and Level.'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const guild =
      interaction.guild ||
      (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);

    await interaction.deferReply();

    // Query top 10 users ordered by xp descending
    const { data: topUsers, error } = await supabase
      .from('users')
      .select('discord_id, xp, level, total_points')
      .eq('guild_id', guildId)
      .order('xp', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[LEADERBOARD] Query error:', error);
      return interaction.editReply({ content: '❌ Failed to load server leaderboard.' });
    }

    if (!topUsers || topUsers.length === 0) {
      return interaction.editReply({
        content: '📊 No members have earned XP in this server yet! Start chatting to climb the leaderboard.',
      });
    }

    const medals = ['🥇', '🥈', '🥉'];

    const leaderboardList = topUsers
      .map((user, index) => {
        const medal = medals[index] || `**#${index + 1}**`;
        const xpFormatted = Number(user.xp || 0).toLocaleString();
        const pointsFormatted = Number(user.total_points || 0).toLocaleString();
        return `${medal} <@${user.discord_id}>\n   ↳ Level **${user.level || 1}** • **${xpFormatted}** XP • **${pointsFormatted}** 🪙 Points`;
      })
      .join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(0x8338ec)
      .setTitle(`🏆 ${guild?.name || 'Server'} — Community Leaderboard`)
      .setDescription(leaderboardList)
      .setFooter({ text: 'Earn XP by being active in chat • Questify' })
      .setTimestamp();

    if (guild) {
      embed.setThumbnail(guild.iconURL({ dynamic: true }));
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
