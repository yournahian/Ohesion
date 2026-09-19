import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { getLevelFromXp } from '../../utils/levelCalculator.js';
import {
  DUEL_KILL_SCENARIOS,
  HAZARD_DEATH_SCENARIOS,
  NEUTRAL_SUPPLY_SCENARIOS,
  WEAPON_PREP_SCENARIOS,
  REVIVE_SCENARIOS,
} from './battleScenarios.js';
import {
  getUserCosmetics,
  formatParticipantName,
} from './battleCosmetics.js';
import { settleMatchBets } from './battleBetting.js';

// Multi-server isolated matches: guildId => active match object
const activeMatches = new Map();
// Secondary index: matchId => match object
const matchIndex = new Map();

// Standard Battle Shield Crest Thumbnail
const BATTLE_CREST_ICON = 'https://cdn-icons-png.flaticon.com/512/8654/8654406.png';

/**
 * Returns the active match for a guild.
 */
export function getActiveMatch(guildId) {
  return activeMatches.get(guildId) || null;
}

/**
 * Returns a match by its unique matchId.
 */
export function getMatchById(matchId) {
  return matchIndex.get(matchId) || null;
}

/**
 * Parses duration strings into seconds, supporting s, m, h, d:
 * e.g. "45s", "5m", "30m", "2h", "24h", "1d", "3d".
 */
export function parseBattleDuration(str) {
  if (!str) return 45;
  if (typeof str === 'number') return Math.max(15, str);

  const trimmed = str.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
  if (!match) {
    const num = parseInt(trimmed, 10);
    return !isNaN(num) && num > 0 ? Math.max(15, num) : 45;
  }

  const val = parseInt(match[1], 10);
  const unit = match[2] || 's';

  let seconds = val;
  if (unit.startsWith('d')) {
    seconds = val * 86400;
  } else if (unit.startsWith('h')) {
    seconds = val * 3600;
  } else if (unit.startsWith('m')) {
    seconds = val * 60;
  }

  return Math.max(15, Math.min(604800, seconds));
}

/**
 * Formats seconds into a human-readable string (e.g. "45 Seconds", "2 Minutes", "24 Hours")
 */
export function formatDurationDisplay(seconds) {
  if (seconds >= 86400) {
    const d = Math.round((seconds / 86400) * 10) / 10;
    return `${d} Day${d === 1 ? '' : 's'}`;
  }
  if (seconds >= 3600) {
    const h = Math.round((seconds / 3600) * 10) / 10;
    return `${h} Hour${h === 1 ? '' : 's'}`;
  }
  if (seconds >= 60) {
    const m = Math.round((seconds / 60) * 10) / 10;
    return `${m} Minute${m === 1 ? '' : 's'}`;
  }
  return `${seconds} Seconds`;
}

/**
 * Creates a new Chaos Clash Battle Royale match.
 */
export function createBattleMatch({
  guildId,
  channelId,
  createdBy,
  hostName = 'yournahian',
  mode = 'classic', // 'classic' | 'interactive'
  signupDurationSec = 45,
  entryFee = 0,
  prizePool = 500,
  prizeXp = 250,
}) {
  const matchId = 'btl_' + Date.now().toString(36);
  const parsedDuration = typeof signupDurationSec === 'string'
    ? parseBattleDuration(signupDurationSec)
    : Math.max(15, Math.min(604800, parseInt(signupDurationSec, 10) || 45));

  const totalPrize = Math.max(50, parseInt(prizePool, 10) || 500);
  const goldPerKill = Math.max(5, Math.round(totalPrize / 100)) || 12;

  const match = {
    matchId,
    guildId,
    channelId,
    createdBy,
    hostName,
    mode: mode.toLowerCase() === 'interactive' ? 'interactive' : 'classic',
    signupDurationSec: parsedDuration,
    entryFee: Math.max(0, parseInt(entryFee, 10) || 0),
    prizePool: totalPrize,
    prizeXp: Math.max(25, parseInt(prizeXp, 10) || 250),
    goldPerKill,
    status: 'signup',
    participants: new Map(),
    alivePlayers: [],
    eliminatedPlayers: [],
    kills: new Map(),
    killStreaks: new Map(),
    revives: new Map(),
    eventLogs: [],
    currentTick: 0,
    messageId: null,
    countdownTimers: [],
    createdAt: Date.now(),
  };

  activeMatches.set(guildId, match);
  matchIndex.set(matchId, match);
  return match;
}

/**
 * Joins a user to the match lobby.
 */
export async function joinBattleMatch(guildId, user) {
  const match = activeMatches.get(guildId);
  if (!match) return { success: false, message: '❌ No active match is accepting sign-ups in this server.' };
  if (match.status !== 'signup') return { success: false, message: '⏳ Sign-ups for this match have already closed!' };

  if (match.participants.has(user.id)) {
    return { success: false, message: '⚠️ You are already registered for this battle!' };
  }

  // Deduct entry fee if required
  if (match.entryFee > 0) {
    const { data: userRec } = await supabase
      .from('users')
      .select('total_points')
      .eq('guild_id', guildId)
      .eq('discord_id', user.id)
      .maybeSingle();

    const currentPoints = Number(userRec?.total_points || 0);
    if (currentPoints < match.entryFee) {
      return {
        success: false,
        message: `🪙 **Insufficient Points:** You need **${match.entryFee} QP** to enter this match (You have: ${currentPoints} QP).`,
      };
    }

    try {
      await supabase
        .from('users')
        .update({ total_points: currentPoints - match.entryFee })
        .eq('guild_id', guildId)
        .eq('discord_id', user.id);
    } catch (_) {}

    match.prizePool += match.entryFee;
  }

  const cosmetics = await getUserCosmetics(guildId, user.id);
  const displayName = user.displayName || user.username;

  match.participants.set(user.id, {
    discordId: user.id,
    displayName,
    cosmetics,
    archetype: match.mode === 'interactive' ? 'Tactician' : 'Classic',
    avatarURL: user.displayAvatarURL({ dynamic: true }),
  });

  return {
    success: true,
    totalJoined: match.participants.size,
    match,
  };
}

/**
 * Builds the Rumble Royale-style Lobby Embed & Join Button (Matching Screenshot 3)
 */
export function buildLobbyPayload(match) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287) // Rumble Royale Green
    .setTitle(`Chaos Clash hosted by ${match.hostName || 'yournahian'}`)
    .setDescription(
      `Random Era: 🗡️ Classic\n\n` +
      `Click the emoji below to join. Starting in ${formatDurationDisplay(match.signupDurationSec)}!`
    )
    .setThumbnail(BATTLE_CREST_ICON);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`battle_join_${match.matchId}`)
      .setLabel(String(match.participants.size))
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Schedules countdown alerts during the sign-up window (Matching Screenshot 3)
 */
export function scheduleCountdowns(match, client) {
  const totalSec = match.signupDurationSec;
  const milestones = [60, 30, 15];
  const flavorQuotes = [
    'Mopping up blood stains...',
    'Ordering new supplies...',
    'Sharpening rusty daggers...',
    'Tuning up battle gear...',
  ];

  for (const ms of milestones) {
    if (totalSec > ms + 5) {
      const delayMs = (totalSec - ms) * 1000;
      const timer = setTimeout(async () => {
        if (match.status !== 'signup') return;
        try {
          const channel = await client.channels.fetch(match.channelId).catch(() => null);
          if (!channel) return;

          const jumpLink = match.messageId
            ? `[Jump!](https://discord.com/channels/${match.guildId}/${match.channelId}/${match.messageId})\n\n`
            : '';
          const quote = flavorQuotes[Math.floor(Math.random() * flavorQuotes.length)];

          const countdownEmbed = new EmbedBuilder()
            .setColor(0xfee75c) // Rumble Royale Yellow
            .setTitle('Chaos Clash')
            .setDescription(`Starting in ${ms} seconds.\n${jumpLink}${quote}`)
            .setThumbnail(BATTLE_CREST_ICON);

          await channel.send({ embeds: [countdownEmbed] }).catch(() => null);
        } catch (_) {}
      }, delayMs);

      match.countdownTimers.push(timer);
    }
  }
}

/**
 * Helper to sleep asynchronously for delays between rounds.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Helper to pick random item from array.
 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Executes the entire Rumble Royale-style game loop (Matching Screenshots 1, 2, 4)
 */
export async function startBattleSimulation(match, client) {
  const guildId = match.guildId;
  const channelId = match.channelId;

  // Cancel remaining countdown timers
  if (match.countdownTimers) {
    match.countdownTimers.forEach(clearTimeout);
    match.countdownTimers = [];
  }

  let channel = null;
  try {
    channel = await client.channels.fetch(channelId).catch(() => null);
  } catch (_) {}

  // Validate participant minimum
  if (match.participants.size < 2) {
    activeMatches.delete(guildId);
    matchIndex.delete(match.matchId);
    if (channel) {
      await channel.send({
        content: `⚠️ **Chaos Clash Cancelled:** At least 2 fighters are required to initialize a battle royale session. (Registered: ${match.participants.size})`,
      });
    }
    return;
  }

  match.status = 'running';
  match.alivePlayers = Array.from(match.participants.keys());
  match.eliminatedPlayers = [];

  for (const id of match.alivePlayers) {
    match.kills.set(id, 0);
    match.killStreaks.set(id, 0);
    match.revives.set(id, 0);
  }

  // 1. Session Start Announcement (Matching Screenshot 1)
  const participantList = Array.from(match.participants.values());
  const participantMentions = participantList.map((p) => `<@${p.discordId}>`).join('\n');

  const startSessionEmbed = new EmbedBuilder()
    .setColor(0x57f287) // Rumble Royale Green
    .setTitle('Started a new Chaos Clash session')
    .setDescription(
      `**Number of participants:** ${match.participants.size}\n` +
      `**Participants:**\n` +
      `${participantMentions}\n\n` +
      `**Era:** 🗡️ Classic\n` +
      `**Prize:** ${match.prizePool} 🪙\n` +
      `**Gold Per Kill:** ${match.goldPerKill} 🪙`
    )
    .setThumbnail(BATTLE_CREST_ICON);

  if (channel) {
    await channel.send({ embeds: [startSessionEmbed] }).catch(() => null);
  }

  // 4s delay before Round 1 starts
  await sleep(4000);

  // 2. Sequential Round-by-Round Execution (Matching Screenshots 1, 2, 4)
  let roundNumber = 1;

  while (match.alivePlayers.length > 1 && channel) {
    const roundEvents = [];

    if (match.alivePlayers.length === 2) {
      // Final 1v1 Showdown
      const p1Id = match.alivePlayers[0];
      const p2Id = match.alivePlayers[1];
      const p1 = match.participants.get(p1Id);
      const p2 = match.participants.get(p2Id);

      // Randomly pick winner of the duel
      const p1Wins = Math.random() < 0.5;
      const killer = p1Wins ? p1 : p2;
      const victim = p1Wins ? p2 : p1;
      const victimId = p1Wins ? p2Id : p1Id;
      const killerId = p1Wins ? p1Id : p2Id;

      const template = pickRandom(DUEL_KILL_SCENARIOS);
      const logText = template
        .replace('{player1}', killer.displayName)
        .replace('{player2}', victim.displayName);

      match.kills.set(killerId, (match.kills.get(killerId) || 0) + 1);
      match.alivePlayers = match.alivePlayers.filter((id) => id !== victimId);
      match.eliminatedPlayers.push(victimId);

      roundEvents.push(logText);
    } else {
      // Multi-player Round (generate 2 to 4 events)
      const numEvents = Math.min(match.alivePlayers.length, Math.floor(Math.random() * 2) + 2);
      let eliminationsInRound = 0;

      // Event 1: Ambient / Supply / Weapon Crafting
      const ambientPlayerId = pickRandom(match.alivePlayers);
      const ambientPlayer = match.participants.get(ambientPlayerId);
      if (ambientPlayer) {
        const isWeapon = Math.random() < 0.4;
        const template = isWeapon ? pickRandom(WEAPON_PREP_SCENARIOS) : pickRandom(NEUTRAL_SUPPLY_SCENARIOS);
        roundEvents.push(template.replace('{player1}', ambientPlayer.displayName));
      }

      // Event 2: Duel Kill or Environmental Death
      if (match.alivePlayers.length > 1) {
        const isHazard = Math.random() < 0.3;

        if (isHazard) {
          const victimId = pickRandom(match.alivePlayers);
          const victim = match.participants.get(victimId);
          if (victim) {
            const template = pickRandom(HAZARD_DEATH_SCENARIOS);
            roundEvents.push(template.replace('{player1}', victim.displayName));
            match.alivePlayers = match.alivePlayers.filter((id) => id !== victimId);
            match.eliminatedPlayers.push(victimId);
            eliminationsInRound++;
          }
        } else {
          // Duel Kill
          const killerId = pickRandom(match.alivePlayers);
          const potentialVictims = match.alivePlayers.filter((id) => id !== killerId);
          const victimId = pickRandom(potentialVictims);
          const killer = match.participants.get(killerId);
          const victim = match.participants.get(victimId);

          if (killer && victim) {
            const template = pickRandom(DUEL_KILL_SCENARIOS);
            roundEvents.push(template.replace('{player1}', killer.displayName).replace('{player2}', victim.displayName));
            match.kills.set(killerId, (match.kills.get(killerId) || 0) + 1);

            // 15% Chance of miracle revive!
            const canRevive = Math.random() < 0.15 && match.alivePlayers.length > 2;
            if (canRevive) {
              const reviveTemplate = pickRandom(REVIVE_SCENARIOS);
              roundEvents.push(reviveTemplate.replace('{player1}', victim.displayName));
              match.revives.set(victimId, (match.revives.get(victimId) || 0) + 1);
            } else {
              match.alivePlayers = match.alivePlayers.filter((id) => id !== victimId);
              match.eliminatedPlayers.push(victimId);
              eliminationsInRound++;
            }
          }
        }
      }

      // Event 3 (if still >= 3 players alive and room for another event):
      if (match.alivePlayers.length >= 3 && numEvents >= 3) {
        const killerId = pickRandom(match.alivePlayers);
        const potentialVictims = match.alivePlayers.filter((id) => id !== killerId);
        const victimId = pickRandom(potentialVictims);
        const killer = match.participants.get(killerId);
        const victim = match.participants.get(victimId);

        if (killer && victim) {
          const template = pickRandom(DUEL_KILL_SCENARIOS);
          roundEvents.push(template.replace('{player1}', killer.displayName).replace('{player2}', victim.displayName));
          match.kills.set(killerId, (match.kills.get(killerId) || 0) + 1);
          match.alivePlayers = match.alivePlayers.filter((id) => id !== victimId);
          match.eliminatedPlayers.push(victimId);
          eliminationsInRound++;
        }
      }

      // Guarantee at least 1 elimination occurs so the match doesn't stall indefinitely
      if (eliminationsInRound === 0 && match.alivePlayers.length > 1) {
        const victimId = pickRandom(match.alivePlayers);
        const victim = match.participants.get(victimId);
        if (victim) {
          const template = pickRandom(HAZARD_DEATH_SCENARIOS);
          roundEvents.push(template.replace('{player1}', victim.displayName));
          match.alivePlayers = match.alivePlayers.filter((id) => id !== victimId);
          match.eliminatedPlayers.push(victimId);
        }
      }
    }

    // Build Round Embed (Underlined Title, Green Left-Border)
    const roundEmbed = new EmbedBuilder()
      .setColor(0x57f287) // Rumble Royale Green
      .setTitle(`__Round ${roundNumber}__`)
      .setDescription(
        `${roundEvents.join('\n')}\n\n` +
        `Players Left: ${match.alivePlayers.length}\n` +
        `Era: Classic`
      );

    // Send as a brand new message in chat
    await channel.send({ embeds: [roundEmbed] }).catch(() => null);

    roundNumber++;
    // 4.5s delay so chat participants can read and discuss each round
    await sleep(4500);
  }

  // 3. Conclude Match & Announce Winner (Matching Screenshot 4)
  await concludeMatch(match, channel, client);
}

/**
 * Concludes the match, distributes prizes & kills gold, and displays winner card (Matching Screenshot 4)
 */
async function concludeMatch(match, channel, client) {
  match.status = 'finished';
  const winnerId = match.alivePlayers[0] || match.eliminatedPlayers[match.eliminatedPlayers.length - 1];
  const winner = match.participants.get(winnerId);

  // Top Killer
  let topKillerId = winnerId;
  let maxKills = 0;
  for (const [id, count] of match.kills.entries()) {
    if (count > maxKills) {
      maxKills = count;
      topKillerId = id;
    }
  }
  const topKiller = match.participants.get(topKillerId);

  // Top Reviver
  let topReviverId = winnerId;
  let maxRevives = 0;
  for (const [id, count] of match.revives.entries()) {
    if (count > maxRevives) {
      maxRevives = count;
      topReviverId = id;
    }
  }
  const topReviver = match.participants.get(topReviverId);

  // Credit winner with prize pool in Supabase
  let newWinnerPoints = 0;
  let newWinnerLevel = 1;

  if (winner) {
    const { data: winnerRec } = await supabase
      .from('users')
      .select('total_points, xp, level')
      .eq('guild_id', match.guildId)
      .eq('discord_id', winnerId)
      .maybeSingle();

    const curPoints = Number(winnerRec?.total_points || 0);
    const curXp = Number(winnerRec?.xp || 0);
    newWinnerPoints = curPoints + match.prizePool;
    const newXp = curXp + match.prizeXp;
    newWinnerLevel = getLevelFromXp(newXp);

    await supabase.from('users').upsert({
      guild_id: match.guildId,
      discord_id: winnerId,
      total_points: newWinnerPoints,
      xp: newXp,
      level: newWinnerLevel,
    }, { onConflict: 'guild_id,discord_id' });
  }

  // Award Gold / QP Per Kill to all combatants who scored eliminations
  for (const [killerId, killsCount] of match.kills.entries()) {
    if (killsCount > 0 && killerId !== winnerId) {
      const killBounty = killsCount * match.goldPerKill;
      const { data: rec } = await supabase
        .from('users')
        .select('total_points')
        .eq('guild_id', match.guildId)
        .eq('discord_id', killerId)
        .maybeSingle();
      const currentPts = Number(rec?.total_points || 0);
      try {
        await supabase
          .from('users')
          .update({ total_points: currentPts + killBounty })
          .eq('guild_id', match.guildId)
          .eq('discord_id', killerId);
      } catch (_) {}
    }
  }

  // Settle spectator bets if any
  try {
    await settleMatchBets({
      matchId: match.matchId,
      guildId: match.guildId,
      winnerId,
      winnerName: winner?.displayName || 'Unknown',
    });
  } catch (_) {}

  // Build Winner Card (Matching Screenshot 4)
  const winnerEmbed = new EmbedBuilder()
    .setColor(0xfee75c) // Rumble Royale Gold/Yellow
    .setTitle('__👑 WINNER!__')
    .setDescription(
      `**${winner?.displayName || 'Unknown'}**\n` +
      `**Reward:** ${match.prizePool} 🪙\n\n` +
      `Total Players: ${match.participants.size}`
    );

  // Build Runners-up list (reverse elimination order)
  const runnersUp = [...match.eliminatedPlayers].reverse().filter((id) => id !== winnerId).slice(0, 5);
  const runnersUpText = runnersUp
    .map((id, idx) => `${idx + 2}. ${match.participants.get(id)?.displayName || 'Unknown'}`)
    .join('\n') || 'None';

  const killsText = `${maxKills} ${topKiller?.displayName || 'None'}`;
  const revivesText = maxRevives > 0 ? `${maxRevives} ${topReviver?.displayName}` : '1 None';

  // Build Stats Embed (Matching Screenshot 4)
  const statsEmbed = new EmbedBuilder()
    .setColor(0xfee75c) // Gold/Yellow
    .addFields(
      { name: '🔮 Runners-up', value: runnersUpText, inline: true },
      { name: '⚔️ Most Kills', value: killsText, inline: true },
      { name: '✨ Most Revives', value: revivesText, inline: true }
    )
    .setFooter({ text: '🗡️ Era: Classic • Chaos Clash' });

  if (channel) {
    await channel.send({
      content: `<@${winnerId}>`,
      embeds: [winnerEmbed, statsEmbed],
    }).catch(() => null);
  }

  // Clean up memory maps
  activeMatches.delete(match.guildId);
  matchIndex.delete(match.matchId);
}
