import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { getRequiredXpForLevel } from '../../utils/levelCalculator.js';

export default {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your or another user\'s level, XP, and Engage Points.')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The member whose profile you want to view')
        .setRequired(false)
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;

    await interaction.deferReply();

    const { data: userRecord, error } = await supabase
      .from('users')
      .select('*')
      .eq('guild_id', guildId)
      .eq('discord_id', targetUser.id)
      .maybeSingle();

    if (error) {
      console.error('[PROFILE] Error fetching profile:', error);
      return interaction.editReply({ content: '❌ Failed to fetch user profile from the database.' });
    }

    const xp = Number(userRecord?.xp || 0);
    const level = Number(userRecord?.level || 1);
    const points = Number(userRecord?.total_points || 0);

    const currentLevelXp = getRequiredXpForLevel(level);
    const nextLevelXp = getRequiredXpForLevel(level + 1);
    const xpIntoLevel = Math.max(0, xp - currentLevelXp);
    const xpNeededForNext = Math.max(1, nextLevelXp - currentLevelXp);
    const progressPercent = Math.min(100, Math.floor((xpIntoLevel / xpNeededForNext) * 100));

    // Progress bar visualization
    const totalBars = 10;
    const filledBars = Math.round((progressPercent / 100) * totalBars);
    const emptyBars = totalBars - filledBars;
    const progressBar = '▰'.repeat(filledBars) + '▱'.repeat(emptyBars);

    const embed = new EmbedBuilder()
      .setColor(0x3a86ff)
      .setAuthor({
        name: `${targetUser.displayName || targetUser.username}'s Profile`,
        iconURL: targetUser.displayAvatarURL({ dynamic: true }),
      })
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: '🎖️ Level', value: `**${level}**`, inline: true },
        { name: '🪙 Quest Points', value: `**${points.toLocaleString()}**`, inline: true },
        { name: '✨ Total XP', value: `**${xp.toLocaleString()}**`, inline: true },
        {
          name: `📈 Level Progress (${progressPercent}%)`,
          value: `${progressBar}\n${xpIntoLevel.toLocaleString()} / ${xpNeededForNext.toLocaleString()} XP to Level ${level + 1}`,
        }
      )
      .setFooter({ text: 'Questify Gamification System' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
