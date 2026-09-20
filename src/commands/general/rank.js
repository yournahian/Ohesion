import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { getRequiredXpForLevel } from '../../utils/levelCalculator.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Display your or another member\'s visual rank card, level, tier, and XP progress.')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The member whose rank you want to inspect')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;

    await interaction.deferReply();

    // Fetch user record
    const { data: userRecord, error } = await supabase
      .from('users')
      .select('*')
      .eq('guild_id', guildId)
      .eq('discord_id', targetUser.id)
      .maybeSingle();

    if (error) {
      console.error('[RANK COMMAND ERROR]:', error);
      return interaction.editReply({ content: '❌ Failed to fetch user rank data.' });
    }

    const xp = Number(userRecord?.xp || 0);
    const level = Number(userRecord?.level || 1);
    const points = Number(userRecord?.total_points || 0);

    // Calculate server position/rank
    const { count: higherUsersCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .gt('xp', xp);

    const rankPosition = (higherUsersCount || 0) + 1;

    // Mathematical XP curve calculations
    const currentLevelXp = getRequiredXpForLevel(level);
    const nextLevelXp = getRequiredXpForLevel(level + 1);
    const xpIntoLevel = Math.max(0, xp - currentLevelXp);
    const xpNeededForNext = Math.max(1, nextLevelXp - currentLevelXp);
    const progressPercent = Math.min(100, Math.floor((xpIntoLevel / xpNeededForNext) * 100));

    // 10-bar progress representation
    const totalBars = 10;
    const filledBars = Math.round((progressPercent / 100) * totalBars);
    const emptyBars = totalBars - filledBars;
    const progressBar = '▰'.repeat(filledBars) + '▱'.repeat(emptyBars);

    // Milestone Tier determination
    let tierTitle = 'Tier 1: Novice';
    let tierColor = 0x5865f2; // Blurple
    if (level >= 80) {
      tierTitle = 'Tier 5: Ascended Mythic';
      tierColor = 0xff007f; // Magenta / Rose
    } else if (level >= 50) {
      tierTitle = 'Tier 4: Legendary Vanguard';
      tierColor = 0xffb703; // Gold
    } else if (level >= 30) {
      tierTitle = 'Tier 3: Veteran Champion';
      tierColor = 0x06d6a0; // Emerald
    } else if (level >= 15) {
      tierTitle = 'Tier 2: Elite Pioneer';
      tierColor = 0x3a86ff; // Azure
    }

    const embed = new EmbedBuilder()
      .setColor(tierColor)
      .setAuthor({
        name: `${targetUser.displayName || targetUser.username} • Cohesion Rank Card`,
        iconURL: targetUser.displayAvatarURL({ dynamic: true }),
      })
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
      .setTitle(`🎖️ Server Rank #${rankPosition} — ${tierTitle}`)
      .setDescription(
        `**Level ${level}** • **${points.toLocaleString()} CP** • **${xp.toLocaleString()} XP**\n\n` +
        `**Level Progress (${progressPercent}%)**\n` +
        `${progressBar}\n` +
        `\`${xpIntoLevel.toLocaleString()} / ${xpNeededForNext.toLocaleString()} XP to Level ${level + 1}\``
      )
      .addFields(
        { name: '🏆 Server Rank', value: `**#${rankPosition}**`, inline: true },
        { name: '🎖️ Current Level', value: `**Level ${level}**`, inline: true },
        { name: '🪙 Cohesion Points', value: `**${points.toLocaleString()} CP**`, inline: true }
      )
      .setFooter({ text: 'Cohesion Gamification Ecosystem • 100% UI Driven' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
