import { Events } from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { logActivity } from '../utils/activityLogger.js';

// Cache to prevent duplicate rewards: `${messageId}_${userId}`
const reactionClaims = new Set();

// Server-level 24-hour rate limit tracking: `${guildId}_${dateString}` -> count
const dailyReactionCap = new Map();
const MAX_REWARDED_REACTIONS_PER_DAY = 500;
const REACTION_REWARD_CP = 5;

export default {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    // Ignore bots
    if (user.bot) return;

    // Fetch partials if needed
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (err) {
        return;
      }
    }

    const message = reaction.message;
    const guild = message.guild;
    if (!guild) return;

    const channelName = message.channel.name.toLowerCase();

    // Only reward reactions in announcement channels or designated channels
    const isAnnouncementChannel =
      channelName.includes('announcement') ||
      channelName.includes('updates') ||
      channelName.includes('official') ||
      message.channel.type === 5; // GuildAnnouncement type

    if (!isAnnouncementChannel) return;

    const claimKey = `${message.id}_${user.id}`;
    if (reactionClaims.has(claimKey)) {
      return; // Already rewarded for this message
    }

    // Check server daily cap
    const today = new Date().toISOString().slice(0, 10);
    const capKey = `${guild.id}_${today}`;
    const currentDayCount = dailyReactionCap.get(capKey) || 0;

    if (currentDayCount >= MAX_REWARDED_REACTIONS_PER_DAY) {
      return; // Server reached daily reaction reward cap
    }

    // Mark claimed
    reactionClaims.add(claimKey);
    dailyReactionCap.set(capKey, currentDayCount + 1);

    // Fetch or create user record and award Cohesion Points
    try {
      const { data: userRecord } = await supabase
        .from('users')
        .select('total_points')
        .eq('guild_id', guild.id)
        .eq('discord_id', user.id)
        .maybeSingle();

      const newTotal = (userRecord?.total_points || 0) + REACTION_REWARD_CP;

      await supabase
        .from('users')
        .upsert({
          guild_id: guild.id,
          discord_id: user.id,
          total_points: newTotal,
          updated_at: new Date().toISOString(),
        });

      // Send ephemeral or audit notification
      await logActivity(guild, {
        title: '📢 Announcement Reaction Rewarded',
        description: `<@${user.id}> earned **+${REACTION_REWARD_CP} CP** for reacting to an official announcement in <#${message.channelId}>!`,
        color: 0x06d6a0,
        fields: [{ name: 'Emoji', value: `${reaction.emoji.name}`, inline: true }],
      });
    } catch (err) {
      console.warn('[REACTION REWARD ERROR]:', err.message);
    }
  },
};
