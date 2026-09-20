import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { logActivity } from '../../utils/activityLogger.js';

const DAILY_REWARD_BASE = 50;
const STREAK_MULTIPLIER = 10;
const MAX_STREAK_BONUS = 150;

export default {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim your daily rewards or level-up role bonuses.')
    .addSubcommand((sub) =>
      sub
        .setName('daily')
        .setDescription('Claim your 24-hour daily Cohesion Points streak reward.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('role')
        .setDescription('Check and claim any unlocked role bonuses based on your current level.')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const discordId = interaction.user.id;
    const guildId = interaction.guildId;

    await interaction.deferReply({ ephemeral: true });

    if (subcommand === 'daily') {
      const { data: userRecord } = await supabase
        .from('users')
        .select('*')
        .eq('guild_id', guildId)
        .eq('discord_id', discordId)
        .maybeSingle();

      const lastClaim = userRecord?.last_claim ? new Date(userRecord.last_claim) : null;
      const now = new Date();
      const oneDayMs = 24 * 60 * 60 * 1000;

      if (lastClaim && now.getTime() - lastClaim.getTime() < oneDayMs) {
        const nextClaimTimestamp = Math.floor((lastClaim.getTime() + oneDayMs) / 1000);
        return interaction.editReply({
          content: `⏳ You have already claimed your daily reward!\nNext claim available: <t:${nextClaimTimestamp}:R>.`,
        });
      }

      // Check streak: resets if more than 48h since last claim
      let streak = userRecord?.daily_streak || 0;
      if (lastClaim && now.getTime() - lastClaim.getTime() < 2 * oneDayMs) {
        streak += 1;
      } else {
        streak = 1;
      }

      const streakBonus = Math.min((streak - 1) * STREAK_MULTIPLIER, MAX_STREAK_BONUS);
      const dailyReward = DAILY_REWARD_BASE + streakBonus;
      const currentPoints = Number(userRecord?.total_points || 0);
      const newPoints = currentPoints + dailyReward;

      await supabase.from('users').upsert(
        {
          guild_id: guildId,
          discord_id: discordId,
          total_points: newPoints,
          daily_streak: streak,
          last_claim: now.toISOString(),
        },
        { onConflict: 'guild_id,discord_id' }
      );

      await logActivity(interaction.guild, {
        title: '🎁 Daily Streak Claimed',
        description: `<@${discordId}> claimed **+${dailyReward} CP** (Streak: ${streak} days)!`,
        color: 0x06d6a0,
        userId: discordId,
      });

      const embed = new EmbedBuilder()
        .setColor(0x06d6a0)
        .setTitle('🎁 Daily Cohesion Points Claimed!')
        .setDescription(
          `You received **+${dailyReward} Cohesion Points (CP)** today!\n\n` +
          `🔥 **Current Streak:** **${streak} Day${streak === 1 ? '' : 's'}**\n` +
          `💰 **Total Balance:** **${newPoints.toLocaleString()} CP**\n\n` +
          `*Come back every 24 hours to keep your streak multiplier active!*`
        )
        .setFooter({ text: 'Cohesion Daily Streaks Engine' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'role') {
      const { data: userRecord } = await supabase
        .from('users')
        .select('level')
        .eq('guild_id', guildId)
        .eq('discord_id', discordId)
        .maybeSingle();

      const userLevel = Number(userRecord?.level || 1);

      const { data: eligibleRoles } = await supabase
        .from('level_role_rewards')
        .select('*')
        .eq('guild_id', guildId)
        .lte('required_level', userLevel);

      if (!eligibleRoles || eligibleRoles.length === 0) {
        return interaction.editReply({
          content: `ℹ️ No role rewards unlocked at Level **${userLevel}** yet. Keep chatting and engaging to level up!`,
        });
      }

      let addedCount = 0;
      const member = await interaction.guild.members.fetch(discordId).catch(() => null);
      if (member) {
        for (const rw of eligibleRoles) {
          if (!member.roles.cache.has(rw.role_id)) {
            await member.roles.add(rw.role_id).catch(() => null);
            addedCount++;
          }
        }
      }

      return interaction.editReply({
        content: `🎖️ **Role Rewards Sync:** Checked **${eligibleRoles.length}** tier roles for your Level **${userLevel}**.\n` +
          (addedCount > 0 ? `✅ Assigned **${addedCount}** newly unlocked role(s) to your profile!` : `✨ All eligible roles are already active on your account!`),
      });
    }
  },
};
