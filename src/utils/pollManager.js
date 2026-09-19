import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { getLevelFromXp } from './levelCalculator.js';

// In-memory cache for ultra-fast response and fallback
const memoryPolls = new Map();
const memoryVotes = new Map(); // key: `${pollId}_${discordId}` => { optionIndex, votedAt }

/**
 * Builds a visual ASCII progress bar for poll percentages.
 */
function createProgressBar(percentage, length = 12) {
  const filled = Math.round((percentage / 100) * length);
  const empty = Math.max(0, length - filled);
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Builds the interactive Discord message payload for a Community Poll.
 */
export function buildPollPayload(poll) {
  const expireTimestampSec = Math.floor(new Date(poll.expires_at).getTime() / 1000);
  const isExpired = Date.now() > new Date(poll.expires_at).getTime();

  // Calculate vote counts per option
  const voteCounts = new Array(poll.options.length).fill(0);
  let totalVotes = 0;

  for (const [key, vote] of memoryVotes.entries()) {
    if (key.startsWith(`${poll.poll_id}_`)) {
      if (vote.optionIndex >= 0 && vote.optionIndex < voteCounts.length) {
        voteCounts[vote.optionIndex]++;
        totalVotes++;
      }
    }
  }

  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

  // Build the options visual display with percentages and progress bars
  const optionsText = poll.options
    .map((opt, idx) => {
      const count = voteCounts[idx] || 0;
      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      const bar = createProgressBar(pct, 10);
      const emoji = emojis[idx] || `**[${idx + 1}]**`;

      return `${emoji} **${opt}**\n\`${bar}\` **${pct}%** (${count.toLocaleString()} vote${count === 1 ? '' : 's'})`;
    })
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(isExpired ? 0x6c757d : 0x00b4d8) // Ocean cyan or muted gray if ended
    .setTitle(`📊 Community Poll: ${poll.question}`)
    .setDescription(
      `${optionsText}\n\n` +
      `🪙 **Reward:** **+${poll.reward_points || 0} QP** & **+${poll.reward_xp || 0} XP** per vote\n` +
      `⏳ **Status:** ${isExpired ? '🔒 **Poll Ended**' : `Ends <t:${expireTimestampSec}:R>`}\n` +
      `👥 **Total Participants:** **${totalVotes.toLocaleString()}** member${totalVotes === 1 ? '' : 's'}`
    )
    .setFooter({ text: `Poll ID: ${poll.poll_id} • 1 Vote Per Member` })
    .setTimestamp();

  // Create option buttons (up to 5)
  const buttonsRow = new ActionRowBuilder();
  poll.options.forEach((opt, idx) => {
    buttonsRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`poll_vote_${poll.poll_id}_${idx}`)
        .setLabel(opt.slice(0, 70))
        .setEmoji(emojis[idx] || '🔹')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(isExpired)
    );
  });

  const components = [buttonsRow];
  return { embeds: [embed], components };
}

/**
 * Saves a poll in memory and database.
 */
export async function savePoll(poll) {
  memoryPolls.set(poll.poll_id, poll);

  try {
    await supabase.from('community_polls').upsert({
      poll_id: poll.poll_id,
      guild_id: poll.guild_id,
      channel_id: poll.channel_id,
      message_id: poll.message_id,
      question: poll.question,
      options: poll.options,
      reward_points: poll.reward_points,
      reward_xp: poll.reward_xp,
      expires_at: poll.expires_at,
      created_by: poll.created_by,
      is_active: poll.is_active,
    });
  } catch (err) {
    console.warn('[POLL DB] Saved in memory cache:', err.message);
  }
}

/**
 * Retrieves a poll by ID.
 */
export async function getPoll(pollId) {
  if (memoryPolls.has(pollId)) {
    return memoryPolls.get(pollId);
  }

  try {
    const { data } = await supabase
      .from('community_polls')
      .select('*')
      .eq('poll_id', pollId)
      .maybeSingle();

    if (data) {
      memoryPolls.set(pollId, data);
      return data;
    }
  } catch (_) {}

  return null;
}

/**
 * Checks if a user has already voted on a poll.
 */
export function hasUserVoted(pollId, discordId) {
  return memoryVotes.has(`${pollId}_${discordId}`);
}

/**
 * Casts a vote on a poll and awards rewards.
 */
export async function castPollVote({ pollId, guildId, discordId, optionIndex, client }) {
  const poll = await getPoll(pollId);
  if (!poll) return { error: '❌ Poll not found or expired.' };

  if (new Date(poll.expires_at).getTime() < Date.now()) {
    return { error: '⏳ This poll has already concluded!' };
  }

  const voteKey = `${pollId}_${discordId}`;
  if (memoryVotes.has(voteKey)) {
    const existing = memoryVotes.get(voteKey);
    return {
      error: `⚠️ You have already voted for **${poll.options[existing.optionIndex]}**! Only 1 vote per member is allowed.`,
    };
  }

  // Record vote
  memoryVotes.set(voteKey, {
    optionIndex,
    votedAt: Date.now(),
  });

  try {
    await supabase.from('poll_votes').insert({
      poll_id: pollId,
      guild_id: guildId,
      discord_id: discordId,
      selected_index: optionIndex,
    });
  } catch (_) {}

  // Award QP and XP if configured
  const pointsAwarded = Number(poll.reward_points || 0);
  const xpAwarded = Number(poll.reward_xp || 0);
  let newPoints = 0;
  let newXp = 0;
  let newLevel = 1;

  if (pointsAwarded > 0 || xpAwarded > 0) {
    const { data: userRecord } = await supabase
      .from('users')
      .select('total_points, xp, level')
      .eq('guild_id', guildId)
      .eq('discord_id', discordId)
      .maybeSingle();

    const curPoints = Number(userRecord?.total_points || 0);
    const curXp = Number(userRecord?.xp || 0);
    newPoints = curPoints + pointsAwarded;
    newXp = curXp + xpAwarded;
    newLevel = getLevelFromXp(newXp);

    await supabase.from('users').upsert(
      {
        guild_id: guildId,
        discord_id: discordId,
        total_points: newPoints,
        xp: newXp,
        level: newLevel,
      },
      { onConflict: 'guild_id,discord_id' }
    );

    // Check level-up role reward
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (member) {
          const { data: roleRewards } = await supabase
            .from('level_role_rewards')
            .select('required_level, role_id')
            .eq('guild_id', guildId)
            .lte('required_level', newLevel);

          if (roleRewards && roleRewards.length > 0) {
            for (const rw of roleRewards) {
              if (!member.roles.cache.has(rw.role_id)) {
                await member.roles.add(rw.role_id).catch(() => null);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[POLL ROLE REWARD ERROR]:', e);
    }
  }

  return {
    success: true,
    chosenOption: poll.options[optionIndex],
    pointsAwarded,
    xpAwarded,
    newPoints,
    newLevel,
    poll,
  };
}
