import { Events, EmbedBuilder } from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { isUserOnMessageCooldown } from '../utils/cooldowns.js';
import { getLevelFromXp, POINTS_PER_LEVEL } from '../utils/levelCalculator.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    // Ignore bots, webhooks, and direct messages
    if (!message.guild || message.author.bot) return;

    const guildId = message.guild.id;
    const userId = message.author.id;

    // 1-minute anti-spam cooldown
    if (isUserOnMessageCooldown(guildId, userId)) {
      return;
    }

    // Award 15-25 random XP
    const earnedXp = Math.floor(Math.random() * 11) + 15;

    try {
      // Ensure guild exists in database
      await supabase
        .from('guilds')
        .upsert({ guild_id: guildId, name: message.guild.name }, { onConflict: 'guild_id' });

      // Fetch current user data
      const { data: userRecord, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('guild_id', guildId)
        .eq('discord_id', userId)
        .maybeSingle();

      if (fetchError) {
        console.error('[DATABASE ERROR] Failed to fetch user record:', fetchError);
        return;
      }

      if (!userRecord) {
        // First message by this user
        const newLevel = getLevelFromXp(earnedXp);
        await supabase.from('users').insert({
          guild_id: guildId,
          discord_id: userId,
          xp: earnedXp,
          level: newLevel,
          total_points: 0,
        });
        return;
      }

      const currentXp = Number(userRecord.xp || 0);
      const currentLevel = Number(userRecord.level || 1);
      const currentPoints = Number(userRecord.total_points || 0);

      const newXp = currentXp + earnedXp;
      const calculatedLevel = getLevelFromXp(newXp);

      if (calculatedLevel > currentLevel) {
        const levelsGained = calculatedLevel - currentLevel;
        const bonusPoints = levelsGained * POINTS_PER_LEVEL;
        const updatedPoints = currentPoints + bonusPoints;

        await supabase
          .from('users')
          .update({
            xp: newXp,
            level: calculatedLevel,
            total_points: updatedPoints,
            updated_at: new Date().toISOString(),
          })
          .eq('guild_id', guildId)
          .eq('discord_id', userId);

        // Check for Level Role Reward
        const { data: roleReward } = await supabase
          .from('level_role_rewards')
          .select('role_id')
          .eq('guild_id', guildId)
          .eq('level', calculatedLevel)
          .maybeSingle();

        let roleAwardText = '';
        if (roleReward?.role_id) {
          const member = await message.guild.members.fetch(userId).catch(() => null);
          if (member) {
            await member.roles.add(roleReward.role_id).catch(() => null);
            roleAwardText = `\n🎖️ **Unlocked Role Reward:** <@&${roleReward.role_id}>!`;
          }
        }

        // Level Up Announcement
        const levelUpEmbed = new EmbedBuilder()
          .setColor(0xffb703)
          .setTitle('🎉 Level Up!')
          .setDescription(
            `Congratulations <@${userId}>! You've reached **Level ${calculatedLevel}**!\n\n` +
            `🪙 **+${bonusPoints} Quest Points** have been added to your balance.${roleAwardText}`
          )
          .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Questify Gamification System' });

        await message.channel.send({ embeds: [levelUpEmbed] }).catch(() => null);
      } else {
        // Just update XP
        await supabase
          .from('users')
          .update({
            xp: newXp,
            updated_at: new Date().toISOString(),
          })
          .eq('guild_id', guildId)
          .eq('discord_id', userId);
      }
    } catch (err) {
      console.error('[XP SYSTEM ERROR]:', err);
    }
  },
};
