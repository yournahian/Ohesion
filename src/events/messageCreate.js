import { Events, EmbedBuilder } from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { isUserOnMessageCooldown } from '../utils/cooldowns.js';
import { getLevelFromXp, POINTS_PER_LEVEL } from '../utils/levelCalculator.js';
import { trackMessage } from '../utils/messageTracker.js';
import { inspectMessage } from '../utils/autoModEngine.js';
import { getGuildSettings } from '../utils/guildSettings.js';
import { verifyAndPair } from '../utils/tgBridgeManager.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    // Ignore bots, webhooks, and direct messages
    if (!message.guild || message.author.bot) return;

    // Admin Handshake Command: !pair <code> or /pair <code>
    if (message.content.startsWith('!pair') || message.content.startsWith('/pair')) {
      if (
        message.member?.permissions?.has('Administrator') ||
        message.member?.permissions?.has('ManageGuild') ||
        message.guild.ownerId === message.author.id
      ) {
        const parts = message.content.trim().split(/\s+/);
        const code = parts[1];
        if (code) {
          const res = await verifyAndPair(code, message.guild.id, message.guild.name, message.author.id);
          if (res.success) {
            return message.reply(
              `🎉 **Connection Successful!** This server is now linked to Telegram group **"${res.bridge.chatTitle}"**!\nOperating Mode: **${res.bridge.syncMode.toUpperCase()}**.`
            );
          } else {
            return message.reply(res.message);
          }
        }
      }
    }

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
          xp: earnedXp,
          level: newLevel,
          total_points: 0,
        });
        return;
      }

      // If user is on XP cooldown, message is already tracked. Abort XP processing.
      if (isCooldown) {
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

        // Persist level-up in database FIRST before sending announcement
        const { error: updateError } = await supabase
          .from('users')
          .update({
            xp: newXp,
            level: calculatedLevel,
            total_points: updatedPoints,
            updated_at: new Date().toISOString(),
          })
          .eq('guild_id', guildId)
          .eq('discord_id', userId);

        if (updateError) {
          console.error('[XP SYSTEM ERROR] Failed to save level up to database:', updateError);
          return;
        }

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

        // 📢 Route Level Up announcement to designated channel or smart fallback
        const settings = getGuildSettings(guildId);
        const configuredChannelId = settings.level_up_channel_id;

        if (configuredChannelId !== 'disabled') {
          let targetChannel = null;

          if (configuredChannelId && configuredChannelId !== 'same') {
            targetChannel = message.guild.channels.cache.get(configuredChannelId);
          }

          // Auto-detect dedicated channel if not explicitly forced to 'same'
          if (!targetChannel && configuredChannelId !== 'same') {
            targetChannel = message.guild.channels.cache.find(
              (c) =>
                c.isTextBased() &&
                c.permissionsFor(message.guild.members.me)?.has('SendMessages') &&
                /level[-_]?up|levels|bot[-_]?channel|bot[-_]?log/i.test(c.name)
            );
          }

          const sendChannel = targetChannel || message.channel;
          await sendChannel.send({ embeds: [levelUpEmbed] }).catch(() => null);
        }
      } else {
        // Just update XP
        const { error: xpUpdateError } = await supabase
          .from('users')
          .update({
            xp: newXp,
            updated_at: new Date().toISOString(),
          })
          .eq('guild_id', guildId)
          .eq('discord_id', userId);

        if (xpUpdateError) {
          console.error('[XP UPDATE ERROR] Failed to save XP:', xpUpdateError);
        }
      }
    } catch (err) {
      console.error('[XP SYSTEM ERROR]:', err);
    }
  },
};
