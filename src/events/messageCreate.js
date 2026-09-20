import { Events, EmbedBuilder } from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { isUserOnMessageCooldown } from '../utils/cooldowns.js';
import { getLevelFromXp, POINTS_PER_LEVEL } from '../utils/levelCalculator.js';
import { trackMessage } from '../utils/messageTracker.js';
import { inspectMessage } from '../utils/autoModEngine.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    // Ignore bots, webhooks, and direct messages
    if (!message.guild || message.author.bot) return;

    // 🛡️ Cohesion Shield: AutoMod Inspection (Links, Invites, Banned Words, Spam)
    const autoModResult = await inspectMessage(message);
    if (autoModResult.handled) {
      // Violating message was auto-deleted and member punished. Abort XP processing.
      return;
    }

    const guildId = message.guild.id;
    const userId = message.author.id;

    // Track message activity across channel & user
    trackMessage(guildId, message.channel.id, userId);

    const authorUsername = message.author.username || message.author.tag || 'Member';
    const isCooldown = isUserOnMessageCooldown(guildId, userId);

    // Award 15-25 random XP (if not on cooldown)
    const earnedXp = isCooldown ? 0 : Math.floor(Math.random() * 11) + 15;

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
          username: authorUsername,
          xp: earnedXp,
          level: newLevel,
          total_points: 0,
          messages_sent: 1,
        });
        return;
      }

      const currentMessages = Number(userRecord.messages_sent || 0) + 1;

      // If user is on XP cooldown, still count the message & keep username fresh
      if (isCooldown) {
        await supabase
          .from('users')
          .update({
            username: authorUsername,
            messages_sent: currentMessages,
            updated_at: new Date().toISOString(),
          })
          .eq('guild_id', guildId)
          .eq('discord_id', userId);
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
            username: authorUsername,
            xp: newXp,
            level: calculatedLevel,
            total_points: updatedPoints,
            messages_sent: currentMessages,
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
          .setColor(0x5865f2)
          .setTitle('🎉 Level Up!')
          .setDescription(
            `Congratulations <@${userId}>! You've reached **Level ${calculatedLevel}**!\n\n` +
            `🪙 **+${bonusPoints} Cohesion Points (CP)** have been added to your balance.${roleAwardText}`
          )
          .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Cohesion Gamification System' });

        await message.channel.send({ embeds: [levelUpEmbed] }).catch(() => null);
      } else {
        // Just update XP & message count
        await supabase
          .from('users')
          .update({
            xp: newXp,
            messages_sent: currentMessages,
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
