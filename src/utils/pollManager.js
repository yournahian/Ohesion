import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  AttachmentBuilder,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { getLevelFromXp } from './levelCalculator.js';
import { generatePollImage } from './pollCanvas.js';

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
 * Helper to parse custom options, recognizing custom emojis or prefixes provided by admin.
 */
export function parsePollOption(rawOpt, index) {
  const trimmed = rawOpt.trim();
  const defaultEmojis = [
    '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣',
    '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟',
    '🇦', '🇧', '🇨', '🇩', '🇪',
    '🇫', '🇬', '🇭', '🇮', '🇯',
    '🇰', '🇱', '🇲', '🇳', '🇴',
    '🇵', '🇶', '🇷', '🇸', '🇹'
  ];

  // Check for custom Discord emoji: <:name:id> or <a:name:id>
  const customMatch = trimmed.match(/^(<a?:\w+:(\d+)>)\s*(.*)$/);
  if (customMatch) {
    return {
      raw: trimmed,
      label: customMatch[3] || trimmed,
      buttonEmoji: customMatch[2],
      displayEmoji: customMatch[1],
      isCustom: true,
    };
  }

  // Check for standard unicode emoji at start of option
  const unicodeMatch = trimmed.match(/^([\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}✅❌🟢🔴⚪🔵🟡🟣🟠⭐🔥💎⚡👍👎🎉])\s*(.*)$/u);
  if (unicodeMatch) {
    return {
      raw: trimmed,
      label: unicodeMatch[2] || trimmed,
      buttonEmoji: unicodeMatch[1],
      displayEmoji: unicodeMatch[1],
      isCustom: false,
    };
  }

  // Check for number/letter prefix like "1. Option" or "A) Option"
  const prefixMatch = trimmed.match(/^([A-Za-z0-9]+[.)])\s*(.*)$/);
  if (prefixMatch) {
    return {
      raw: trimmed,
      label: prefixMatch[2] || trimmed,
      buttonEmoji: defaultEmojis[index] || '🔹',
      displayEmoji: `**[${prefixMatch[1]}]**`,
      isCustom: false,
    };
  }

  return {
    raw: trimmed,
    label: trimmed,
    buttonEmoji: defaultEmojis[index] || '🔹',
    displayEmoji: defaultEmojis[index] || `**[${index + 1}]**`,
    isCustom: false,
  };
}

/**
 * Builds the interactive Discord message payload for a Community Poll.
 * Renders the official Discord Poll UI visual card (matching screenshot), supports live vs. hidden results,
 * and includes dynamic buttons with optional "Add Option" for community members.
 */
export async function buildPollPayload(poll) {
  const expireTimestampSec = Math.floor(new Date(poll.expires_at).getTime() / 1000);
  const isExpired = Date.now() > new Date(poll.expires_at).getTime();

  // Results visibility: 'live' (default) shows live percentages; 'ended' hides until poll concludes
  const showResults = poll.results_visibility !== 'ended' || isExpired;

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

  // Generate visual poll image matching Discord screenshot UI
  let attachment = null;
  try {
    const imageBuffer = generatePollImage(poll, voteCounts, totalVotes, showResults);
    attachment = new AttachmentBuilder(imageBuffer, { name: `poll_${poll.poll_id}.png` });
  } catch (err) {
    console.error('[POLL CANVAS ERROR]:', err);
  }

  const components = [];

  // If 24 options or fewer: use interactive buttons chunked into ActionRows (up to 5 buttons per row)
  if (poll.options.length <= 24) {
    for (let i = 0; i < poll.options.length; i += 5) {
      const row = new ActionRowBuilder();
      const slice = poll.options.slice(i, i + 5);
      slice.forEach((opt, relIdx) => {
        const globalIdx = i + relIdx;
        const parsed = parsePollOption(opt, globalIdx);
        const btn = new ButtonBuilder()
          .setCustomId(`poll_vote_${poll.poll_id}_${globalIdx}`)
          .setLabel(parsed.label.slice(0, 75))
          .setStyle(ButtonStyle.Primary)
          .setDisabled(isExpired);

        if (parsed.buttonEmoji) {
          try {
            btn.setEmoji(parsed.buttonEmoji);
          } catch (_) {}
        }
        row.addComponents(btn);
      });
      components.push(row);
    }

    // Community Member "Add Option" button if enabled by admin
    if (poll.allow_user_options && !isExpired && poll.options.length < 24) {
      const lastRow = components[components.length - 1];
      const addOptBtn = new ButtonBuilder()
        .setCustomId(`poll_add_option_${poll.poll_id}`)
        .setLabel('Add Option')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Secondary);

      if (lastRow && lastRow.components.length < 5) {
        lastRow.addComponents(addOptBtn);
      } else if (components.length < 5) {
        components.push(new ActionRowBuilder().addComponents(addOptBtn));
      }
    }
  } else {
    // If more than 24 choices: use StringSelectMenus
    const maxSelectRows = Math.min(Math.ceil(poll.options.length / 25), 4);
    for (let r = 0; r < maxSelectRows; r++) {
      const start = r * 25;
      const end = Math.min(start + 25, poll.options.length);
      const slice = poll.options.slice(start, end);

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`poll_select_vote_${poll.poll_id}_${r}`)
        .setPlaceholder(`Select your vote (Choices ${start + 1} - ${end})`)
        .setDisabled(isExpired);

      const menuOptions = slice.map((opt, relIdx) => {
        const globalIdx = start + relIdx;
        const parsed = parsePollOption(opt, globalIdx);
        const optCount = voteCounts[globalIdx] || 0;
        const optPct = totalVotes > 0 ? Math.round((optCount / totalVotes) * 100) : 0;

        const optBuilder = new StringSelectMenuOptionBuilder()
          .setLabel(parsed.label.slice(0, 95))
          .setValue(String(globalIdx))
          .setDescription(
            showResults
              ? `${optCount} vote${optCount === 1 ? '' : 's'} (${optPct}%)`
              : 'Cast secret vote'
          );

        if (parsed.buttonEmoji) {
          try {
            optBuilder.setEmoji(parsed.buttonEmoji);
          } catch (_) {}
        }
        return optBuilder;
      });

      selectMenu.addOptions(menuOptions);
      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    if (poll.allow_user_options && !isExpired && poll.options.length < 100 && components.length < 5) {
      const addOptBtn = new ButtonBuilder()
        .setCustomId(`poll_add_option_${poll.poll_id}`)
        .setLabel('Add Option')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Secondary);
      components.push(new ActionRowBuilder().addComponents(addOptBtn));
    }
  }

  const payload = {
    components,
    files: attachment ? [attachment] : [],
    embeds: [],
  };

  // Embed fallback in case canvas is unavailable
  if (!attachment) {
    const lines = [];
    for (let idx = 0; idx < poll.options.length; idx++) {
      const opt = poll.options[idx];
      const parsed = parsePollOption(opt, idx);
      const count = voteCounts[idx] || 0;
      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      const bar = createProgressBar(pct, 10);
      lines.push(
        showResults
          ? `${parsed.displayEmoji} **${parsed.label}**\n\`${bar}\` **${pct}%** (${count.toLocaleString()} votes)`
          : `${parsed.displayEmoji} **${parsed.label}**`
      );
    }
    const embed = new EmbedBuilder()
      .setColor(isExpired ? 0x6c757d : 0x5865f2)
      .setTitle(`📊 ${poll.question}`)
      .setDescription(
        `${lines.join('\n\n')}\n\n` +
        `⏳ **Status:** ${isExpired ? '🔒 **Poll Ended**' : `Ends <t:${expireTimestampSec}:R>`}\n` +
        `👥 **Total Answers:** **${totalVotes.toLocaleString()}**`
      );
    payload.embeds = [embed];
  }

  return payload;
}

/**
 * Saves a poll in memory and database.
 */
export async function savePoll(poll) {
  memoryPolls.set(poll.poll_id, poll);

  try {
    const record = {
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
    };
    if (poll.results_visibility) record.results_visibility = poll.results_visibility;
    if (poll.allow_user_options !== undefined) record.allow_user_options = poll.allow_user_options;

    await supabase.from('community_polls').upsert(record);
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
