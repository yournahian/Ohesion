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
  DUEL_SCENARIOS,
  HAZARD_SCENARIOS,
  TEAM_UP_SCENARIOS,
  BERSERKER_SCENARIOS,
  MEDIC_REVIVE_SCENARIOS,
  TACTICIAN_EVADE_SCENARIOS,
  THIEF_HEIST_SCENARIOS,
  QTE_SUPPLY_WEAPON_SCENARIOS,
  BOUNTY_HUNT_SCENARIOS,
} from './battleScenarios.js';
import {
  getUserCosmetics,
  formatParticipantName,
} from './battleCosmetics.js';
import { settleMatchBets, getMatchBets } from './battleBetting.js';

// Multi-server isolated matches: guildId => active match object
const activeMatches = new Map();
// Secondary index: matchId => match object
const matchIndex = new Map();

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
    seconds = val * 86400; // days to seconds
  } else if (unit.startsWith('h')) {
    seconds = val * 3600; // hours to seconds
  } else if (unit.startsWith('m')) {
    seconds = val * 60; // minutes to seconds
  }

  // Minimum 15 seconds, maximum 7 days (604,800 seconds)
  return Math.max(15, Math.min(604800, seconds));
}

/**
 * Formats seconds into a human-readable string (e.g. "45 Seconds", "5 Minutes", "2 Hours", "1 Day")
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
  mode = 'interactive', // 'interactive' | 'classic'
  signupDurationSec = 45,
  entryFee = 0,
  prizePool = 500,
  prizeXp = 250,
}) {
  const matchId = 'btl_' + Date.now().toString(36);
  const parsedDuration = typeof signupDurationSec === 'string'
    ? parseBattleDuration(signupDurationSec)
    : Math.max(15, Math.min(604800, parseInt(signupDurationSec, 10) || 45));

  const match = {
    matchId,
    guildId,
    channelId,
    createdBy,
    mode: mode.toLowerCase() === 'classic' ? 'classic' : 'interactive',
    signupDurationSec: parsedDuration,
    entryFee: Math.max(0, parseInt(entryFee, 10) || 0),
    prizePool: Math.max(50, parseInt(prizePool, 10) || 500),
    prizeXp: Math.max(25, parseInt(prizeXp, 10) || 250),
    status: 'signup', // 'signup' | 'running' | 'paused_qte' | 'finished' | 'cancelled'
    participants: new Map(), // discordId => participant object
    alivePlayers: [], // array of discordIds
    eliminatedPlayers: [], // array of discordIds in elimination order
    kills: new Map(), // discordId => killCount
    killStreaks: new Map(), // discordId => streak
    firstBlood: null, // { killerId, killerName, victimId, victimName }
    mutator: null, // null | 'Sudden Death' | 'Bounty Hunt' | "Rich Man's Land"
    eventLogs: [],
    currentTick: 0,
    messageId: null,
    qteActive: null, // { type, expiresAt, resolvedBy }
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
    return { success: false, message: '⚠️ You are already in the battle lobby!' };
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

    await supabase
      .from('users')
      .update({ total_points: currentPoints - match.entryFee })
      .eq('guild_id', guildId)
      .eq('discord_id', user.id)
      .catch(() => null);

    match.prizePool += match.entryFee;
  }

  const cosmetics = await getUserCosmetics(guildId, user.id);
  const displayName = user.displayName || user.username;

  match.participants.set(user.id, {
    discordId: user.id,
    displayName,
    cosmetics,
    archetype: match.mode === 'interactive' ? 'Tactician' : 'Classic Fighter', // Default archetype
    selfReviveUsed: false,
    hasSupplyBuff: false,
    bounty: 0,
    avatarURL: user.displayAvatarURL({ dynamic: true }),
  });

  return {
    success: true,
    totalJoined: match.participants.size,
    match,
  };
}

/**
 * Sets a participant's archetype during the class phase.
 */
export function setPlayerArchetype(guildId, discordId, archetype) {
  const match = activeMatches.get(guildId);
  if (!match) return { success: false, message: '❌ No active match found.' };
  if (match.status !== 'signup') return { success: false, message: '⏳ Class selection has ended.' };

  const player = match.participants.get(discordId);
  if (!player) return { success: false, message: '⚠️ You must join the battle lobby first!' };

  const validArchetypes = ['Berserker', 'Medic', 'Tactician', 'Thief'];
  if (!validArchetypes.includes(archetype)) {
    return { success: false, message: '❌ Invalid archetype selected.' };
  }

  player.archetype = archetype;
  return { success: true, archetype, displayName: player.displayName };
}

/**
 * Builds the sleek visual Lobby embed & buttons for the sign-up phase.
 */
export function buildLobbyPayload(match) {
  const isInteractive = match.mode === 'interactive';
  const participantList = Array.from(match.participants.values());
  const formattedNames = participantList
    .map((p, i) => `${i + 1}. ${formatParticipantName(p.displayName, p.cosmetics)} (${p.archetype})`)
    .slice(0, 30)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(isInteractive ? 0xe63946 : 0x457b9d)
    .setTitle(`⚔️ Chaos Clash Battle Royale [${isInteractive ? 'Interactive Mode' : 'Classic Mode'}]`)
    .setDescription(
      `A new battle royale simulation has been authorized!\n\n` +
      `🪙 **Entry Fee:** ${match.entryFee > 0 ? `**${match.entryFee} QP**` : 'Free Entry'}\n` +
      `🏆 **Prize Pool:** **${match.prizePool.toLocaleString()} QP** & **+${match.prizeXp} XP**\n` +
      `⏱️ **Sign-up Closes:** <t:${Math.floor((match.createdAt + match.signupDurationSec * 1000) / 1000)}:R>\n\n` +
      `👥 **Registered Fighters (${participantList.length}):**\n` +
      `${formattedNames || '*No fighters registered yet. Click below to enter!*'}`
    )
    .setFooter({ text: `Match ID: ${match.matchId} • Multi-Server Cluster Safe` })
    .setTimestamp();

  // Unique Button IDs with matchId embedded to guarantee zero collision across matches
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`battle_join_${match.matchId}`)
      .setLabel('Enter Clash')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`battle_bet_${match.matchId}`)
      .setLabel('Place Bet')
      .setEmoji('🪙')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('battle_armory')
      .setLabel('Armory & Titles')
      .setEmoji('🏪')
      .setStyle(ButtonStyle.Secondary)
  );

  const components = [row1];

  if (isInteractive) {
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`battle_pick_class_${match.matchId}`)
        .setLabel('Choose Archetype')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Primary)
    );
    components.push(row2);
  }

  return { embeds: [embed], components };
}

/**
 * Builds the Archetype Selection dropdown menu for interactive matches.
 */
export function buildClassSelectionPayload(matchId) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`select_battle_class_${matchId}`)
    .setPlaceholder('Select your combat Archetype')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Berserker')
        .setDescription('+15% Kill Chance, -10% Hazard Survival')
        .setValue('Berserker')
        .setEmoji('🩸'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Medic')
        .setDescription('Spawns with 1 Emergency Self-Revive Token')
        .setValue('Medic')
        .setEmoji('💉'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Tactician')
        .setDescription('+20% Radar Evasion Chance against targeted attacks')
        .setValue('Tactician')
        .setEmoji('📡'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Thief')
        .setDescription('Steals 15% of killer\'s points upon elimination')
        .setValue('Thief')
        .setEmoji('💰')
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);
  return {
    content: '🛡️ **Choose your Archetype for this match:**',
    components: [row],
    ephemeral: true,
  };
}

/**
 * Helper to sleep asynchronously for throttle delays.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Helper to pick random item from array.
 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Initializes and executes the asynchronous game loop.
 */
export async function startBattleSimulation(match, client) {
  const guildId = match.guildId;
  const channelId = match.channelId;

  if (match.participants.size < 2) {
    activeMatches.delete(guildId);
    matchIndex.delete(match.matchId);
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        await channel.send({
          content: `⚠️ **Chaos Clash Cancelled:** At least 2 fighters are required to initialize the match. (Fighters: ${match.participants.size})`,
        });
      }
    } catch (_) {}
    return;
  }

  match.status = 'running';
  match.alivePlayers = Array.from(match.participants.keys());
  match.eliminatedPlayers = [];

  // Initialize stats
  for (const id of match.alivePlayers) {
    match.kills.set(id, 0);
    match.killStreaks.set(id, 0);
  }

  // 20% Randomizer Mutator Engine (Interactive Mode only)
  if (match.mode === 'interactive' && Math.random() < 0.2) {
    const mutators = ['Sudden Death', 'Bounty Hunt', "Rich Man's Land"];
    match.mutator = pickRandom(mutators);
  }

  let channel = null;
  try {
    channel = await client.channels.fetch(channelId).catch(() => null);
  } catch (_) {}

  if (!channel) {
    activeMatches.delete(guildId);
    matchIndex.delete(match.matchId);
    return;
  }

  // Initial broadcast
  const startEmbed = new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle(`⚔️ Chaos Clash: The Battle Commences!`)
    .setDescription(
      `🚪 **The blast doors are sealed!** **${match.alivePlayers.length}** combatants enter the arena.\n\n` +
      `🌐 **Mode:** ${match.mode === 'interactive' ? '⚡ **Interactive Tactical Mode**' : '🎲 **Classic 100% RNG Mode**'}\n` +
      (match.mutator ? `⚡ **Global Mutator Active:** 🌪️ **${match.mutator}**\n` : '') +
      `🏆 **Grand Prize:** **${match.prizePool.toLocaleString()} QP** & **+${match.prizeXp} XP**\n\n` +
      `*Simulation ticks running every 3.5s... May the best fighter stand victorious!*`
    )
    .setFooter({ text: `Match ID: ${match.matchId}` });

  const liveMessage = await channel.send({ embeds: [startEmbed] }).catch(() => null);
  if (liveMessage) match.messageId = liveMessage.id;

  // Base throttle: 3.5 seconds (or 1.75s if Sudden Death)
  let throttleMs = 3500;
  if (match.mutator === 'Sudden Death') throttleMs = 1750;

  await sleep(2500);

  // Core Simulation Loop
  while (match.alivePlayers.length > 1) {
    match.currentTick++;

    // 1. Live Quick-Time Events (QTEs) trigger every 4 to 5 ticks (Interactive mode only)
    if (match.mode === 'interactive' && (match.currentTick % 4 === 0 || (match.mutator === "Rich Man's Land" && match.currentTick % 2 === 0))) {
      await triggerLiveQTE(match, channel, client);
      if (match.alivePlayers.length <= 1) break;
    }

    // 2. Regular Combat & Elimination Logic
    const eventLog = executeTickEvent(match);
    if (eventLog) {
      match.eventLogs.push(eventLog);
      if (match.eventLogs.length > 8) match.eventLogs.shift();
    }

    // Update Live Broadcast Card
    await updateLiveDisplay(match, channel, liveMessage);

    await sleep(throttleMs);
  }

  // Final Match Wrap-up
  await concludeMatch(match, channel, client);
}

/**
 * Executes a single event tick (Solo Duel, Hazard, or 3-player Team-Up).
 */
function executeTickEvent(match) {
  if (match.alivePlayers.length <= 1) return null;

  // 15% Random Temporary Team-Up Trigger (requires at least 3 alive players)
  if (match.mode === 'interactive' && match.alivePlayers.length >= 3 && Math.random() < 0.15) {
    return executeTeamUpEvent(match);
  }

  // 25% Chance Environmental Hazard, 75% Chance Player Duel
  const isHazard = Math.random() < 0.25;
  if (isHazard) {
    return executeHazardEvent(match);
  }

  return executeDuelEvent(match);
}

/**
 * Handles 15% 3-Player Temporary Team-Up
 */
function executeTeamUpEvent(match) {
  // Shuffle and pick 3 players
  const shuffled = [...match.alivePlayers].sort(() => 0.5 - Math.random());
  const [p1Id, p2Id, p3Id] = shuffled;
  const p1 = match.participants.get(p1Id);
  const p2 = match.participants.get(p2Id);
  const p3 = match.participants.get(p3Id);

  // Check Tactician Evasion for target (p3)
  if (p3.archetype === 'Tactician' && Math.random() < 0.2) {
    const template = pickRandom(TACTICIAN_EVADE_SCENARIOS);
    return template
      .replace('{player1}', formatParticipantName(p3.displayName, p3.cosmetics))
      .replace('{player2}', `${formatParticipantName(p1.displayName, p1.cosmetics)} & ${formatParticipantName(p2.displayName, p2.cosmetics)}`);
  }

  // Check Medic Self-Revive for p3
  if (p3.archetype === 'Medic' && !p3.selfReviveUsed && match.mutator !== 'Sudden Death') {
    p3.selfReviveUsed = true;
    const template = pickRandom(MEDIC_REVIVE_SCENARIOS);
    return template.replace('{player1}', formatParticipantName(p3.displayName, p3.cosmetics));
  }

  // Eliminate p3
  eliminatePlayer(match, p3Id);
  recordKill(match, p1Id, p3Id);
  recordKill(match, p2Id, p3Id);

  // Thief trigger
  let thiefText = '';
  if (p3.archetype === 'Thief') {
    thiefText = `\n↳ 💰 ${formatParticipantName(p3.displayName, p3.cosmetics)} snatched a share of points as parting tribute!`;
  }

  const template = pickRandom(TEAM_UP_SCENARIOS);
  return (
    template
      .replace('{player1}', formatParticipantName(p1.displayName, p1.cosmetics))
      .replace('{player2}', formatParticipantName(p2.displayName, p2.cosmetics))
      .replace('{player3}', formatParticipantName(p3.displayName, p3.cosmetics)) + thiefText
  );
}

/**
 * Handles 1v1 Player Duel
 */
function executeDuelEvent(match) {
  const shuffled = [...match.alivePlayers].sort(() => 0.5 - Math.random());
  let [attackerId, defenderId] = shuffled;
  let attacker = match.participants.get(attackerId);
  let defender = match.participants.get(defenderId);

  // Berserker advantage (+15% kill chance): Swap roles if defender was Berserker and rolls bonus
  if (match.mode === 'interactive') {
    if (defender.archetype === 'Berserker' && Math.random() < 0.15) {
      [attackerId, defenderId] = [defenderId, attackerId];
      [attacker, defender] = [defender, attacker];
    }
  }

  // Tactician evasion (+20% chance to dodge)
  if (match.mode === 'interactive' && defender.archetype === 'Tactician' && Math.random() < 0.2) {
    const template = pickRandom(TACTICIAN_EVADE_SCENARIOS);
    return template
      .replace('{player1}', formatParticipantName(defender.displayName, defender.cosmetics))
      .replace('{player2}', formatParticipantName(attacker.displayName, attacker.cosmetics));
  }

  // Medic self-revive
  if (match.mode === 'interactive' && defender.archetype === 'Medic' && !defender.selfReviveUsed && match.mutator !== 'Sudden Death') {
    defender.selfReviveUsed = true;
    const template = pickRandom(MEDIC_REVIVE_SCENARIOS);
    return template.replace('{player1}', formatParticipantName(defender.displayName, defender.cosmetics));
  }

  // Eliminate defender
  eliminatePlayer(match, defenderId);
  recordKill(match, attackerId, defenderId);

  // Thief death trigger
  let thiefText = '';
  if (match.mode === 'interactive' && defender.archetype === 'Thief') {
    thiefText = `\n↳ 💰 ${formatParticipantName(defender.displayName, defender.cosmetics)} triggered pickpocket heists on death!`;
  }

  // Supply weapon buff scenario
  if (attacker.hasSupplyBuff) {
    attacker.hasSupplyBuff = false;
    const template = pickRandom(QTE_SUPPLY_WEAPON_SCENARIOS);
    return template
      .replace('{player1}', formatParticipantName(attacker.displayName, attacker.cosmetics))
      .replace('{player2}', formatParticipantName(defender.displayName, defender.cosmetics)) + thiefText;
  }

  // Berserker rage scenario
  if (attacker.archetype === 'Berserker' && Math.random() < 0.5) {
    const template = pickRandom(BERSERKER_SCENARIOS);
    return template
      .replace('{player1}', formatParticipantName(attacker.displayName, attacker.cosmetics))
      .replace('{player2}', formatParticipantName(defender.displayName, defender.cosmetics)) + thiefText;
  }

  const template = pickRandom(DUEL_SCENARIOS);
  return template
    .replace('{player1}', formatParticipantName(attacker.displayName, attacker.cosmetics))
    .replace('{player2}', formatParticipantName(defender.displayName, defender.cosmetics)) + thiefText;
}

/**
 * Handles Environmental Hazard Events
 */
function executeHazardEvent(match) {
  const victimId = pickRandom(match.alivePlayers);
  const victim = match.participants.get(victimId);

  // Berserker has -10% survival rate vs hazards (already more vulnerable)
  // Medic self-revive
  if (match.mode === 'interactive' && victim.archetype === 'Medic' && !victim.selfReviveUsed && match.mutator !== 'Sudden Death') {
    victim.selfReviveUsed = true;
    const template = pickRandom(MEDIC_REVIVE_SCENARIOS);
    return template.replace('{player1}', formatParticipantName(victim.displayName, victim.cosmetics));
  }

  eliminatePlayer(match, victimId);

  const template = pickRandom(HAZARD_SCENARIOS);
  return template.replace('{player1}', formatParticipantName(victim.displayName, victim.cosmetics));
}

/**
 * Records an elimination and first blood / streaks.
 */
function recordKill(match, killerId, victimId) {
  const currentKills = (match.kills.get(killerId) || 0) + 1;
  match.kills.set(killerId, currentKills);

  const currentStreak = (match.killStreaks.get(killerId) || 0) + 1;
  match.killStreaks.set(killerId, currentStreak);

  if (!match.firstBlood) {
    const killer = match.participants.get(killerId);
    const victim = match.participants.get(victimId);
    match.firstBlood = {
      killerId,
      killerName: killer?.displayName || 'Unknown',
      victimId,
      victimName: victim?.displayName || 'Unknown',
    };
  }

  // Mutator: Bounty Hunt check
  if (match.mutator === 'Bounty Hunt' && (match.killStreaks.get(victimId) || 0) >= 2) {
    const bountyQP = 150;
    match.eventLogs.push(`🎯 **Bounty Collected!** +${bountyQP} QP awarded for claiming a killstreak.`);
  }
}

/**
 * Eliminates a player from the active pool.
 */
function eliminatePlayer(match, playerId) {
  match.alivePlayers = match.alivePlayers.filter((id) => id !== playerId);
  match.eliminatedPlayers.push(playerId);
  match.killStreaks.set(playerId, 0);
}

/**
 * Triggers a Live Quick-Time Event (Supply Drop or Hazard Alert) with unique matchId button IDs.
 */
async function triggerLiveQTE(match, channel, client) {
  const isSupplyDrop = Math.random() < 0.5;

  if (isSupplyDrop) {
    // Supply Drop QTE
    const qteEmbed = new EmbedBuilder()
      .setColor(0xffb703)
      .setTitle('📦 AIRDROP INCOMING! Supply Crate Touching Down!')
      .setDescription(
        'A high-tech prototype weapon crate has dropped into the arena!\n' +
        '**First active fighter to claim the loot gains a +25% Combat Power Boost!**'
      )
      .setFooter({ text: 'Quick-Time Event Active (4s window)' });

    // Dynamic unique Button ID containing matchId
    const lootRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`battle_qte_loot_${match.matchId}`)
        .setLabel('Claim Loot')
        .setEmoji('📦')
        .setStyle(ButtonStyle.Success)
    );

    match.qteActive = { type: 'loot', expiresAt: Date.now() + 4000, resolvedBy: null };
    const qteMsg = await channel.send({ embeds: [qteEmbed], components: [lootRow] }).catch(() => null);

    await sleep(4000);

    lootRow.components[0].setDisabled(true);
    if (qteMsg) await qteMsg.edit({ components: [lootRow] }).catch(() => null);

    if (match.qteActive.resolvedBy) {
      const luckyPlayer = match.participants.get(match.qteActive.resolvedBy);
      if (luckyPlayer) {
        luckyPlayer.hasSupplyBuff = true;
        match.eventLogs.push(`📦 **Airdrop Secured!** ${formatParticipantName(luckyPlayer.displayName, luckyPlayer.cosmetics)} acquired the prototype weapon!`);
      }
    } else {
      match.eventLogs.push(`💨 The supply crate self-destructed before anyone could secure the payload!`);
    }
    match.qteActive = null;
  } else {
    // Hazard Alert QTE
    const hazardEmbed = new EmbedBuilder()
      .setColor(0xd90429)
      .setTitle('🚨 AIR STRIKE IMMINENT! Seek Immediate Shelter!')
      .setDescription(
        'Heavy carpet bombing sirens are blaring across the sector!\n' +
        '**Fighters have 4 seconds to dive for cover! Unshielded players face a 30% chance of sudden elimination!**'
      )
      .setFooter({ text: 'Quick-Time Event Active (4s window)' });

    // Dynamic unique Button ID containing matchId
    const coverRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`battle_qte_cover_${match.matchId}`)
        .setLabel('Move to Cover')
        .setEmoji('🏃')
        .setStyle(ButtonStyle.Danger)
    );

    match.qteActive = { type: 'cover', expiresAt: Date.now() + 4000, coveredPlayers: new Set() };
    const qteMsg = await channel.send({ embeds: [hazardEmbed], components: [coverRow] }).catch(() => null);

    await sleep(4000);

    coverRow.components[0].setDisabled(true);
    if (qteMsg) await qteMsg.edit({ components: [coverRow] }).catch(() => null);

    // Evaluate players who failed to take cover
    const safePlayers = match.qteActive.coveredPlayers;
    const unlucky = match.alivePlayers.filter((id) => !safePlayers.has(id));

    for (const victimId of unlucky) {
      if (Math.random() < 0.3 && match.alivePlayers.length > 1) {
        const victim = match.participants.get(victimId);
        eliminatePlayer(match, victimId);
        match.eventLogs.push(`💥 ${formatParticipantName(victim.displayName, victim.cosmetics)} was caught outside bunker cover during the carpet bombing!`);
      }
    }
    match.qteActive = null;
  }
}

/**
 * Resolves a player's interaction with an active QTE.
 */
export function resolveQTEAction(matchId, discordId, actionType) {
  const match = matchIndex.get(matchId);
  if (!match || !match.qteActive || Date.now() > match.qteActive.expiresAt) {
    return { success: false, message: '⏳ The quick-time event has already concluded!' };
  }

  if (!match.alivePlayers.includes(discordId)) {
    return { success: false, message: '⚠️ Only active living fighters can interact with match events!' };
  }

  if (actionType === 'loot') {
    if (match.qteActive.resolvedBy) {
      return { success: false, message: '💨 Another fighter already grabbed the supply crate!' };
    }
    match.qteActive.resolvedBy = discordId;
    return { success: true, message: '🎉 **Loot Claimed!** You secured the airdrop prototype weapon (+25% Combat Power)!' };
  }

  if (actionType === 'cover') {
    match.qteActive.coveredPlayers.add(discordId);
    return { success: true, message: '🛡️ **Bunker Reached!** You safely secured blast shelter.' };
  }

  return { success: false, message: 'Invalid action.' };
}

/**
 * Updates the live battle embed card in the Discord channel.
 */
async function updateLiveDisplay(match, channel, liveMessage) {
  if (!liveMessage) return;

  const logsText = match.eventLogs.length > 0
    ? match.eventLogs.join('\n\n')
    : '*Fighters are scoping out the arena perimeter...*';

  const embed = new EmbedBuilder()
    .setColor(0xe63946)
    .setTitle(`⚔️ Chaos Clash: Live Arena Feed [Tick ${match.currentTick}]`)
    .setDescription(
      `${logsText}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 **Remaining Fighters:** **${match.alivePlayers.length}** / ${match.participants.size} Alive\n` +
      `💀 **Eliminated:** **${match.eliminatedPlayers.length}** Combatants\n` +
      (match.mutator ? `🌪️ **Active Mutator:** ${match.mutator}\n` : '') +
      `🪙 **Current Prize:** **${match.prizePool.toLocaleString()} QP**`
    )
    .setFooter({ text: `Match ID: ${match.matchId} • Live Simulation Running` })
    .setTimestamp();

  await liveMessage.edit({ embeds: [embed] }).catch(() => null);
}

/**
 * Concludes the match, distributes prizes, awards XP, and summarizes analytics.
 */
async function concludeMatch(match, channel, client) {
  match.status = 'finished';
  const winnerId = match.alivePlayers[0];
  const winner = match.participants.get(winnerId);

  // Determine Match MVP (most kills)
  let mvpId = winnerId;
  let maxKills = 0;
  for (const [id, kills] of match.kills.entries()) {
    if (kills > maxKills) {
      maxKills = kills;
      mvpId = id;
    }
  }
  const mvp = match.participants.get(mvpId);

  // Credit winner with prize pool & XP
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

  // Settle spectator bets
  const bettingResult = await settleMatchBets({
    matchId: match.matchId,
    guildId: match.guildId,
    winnerId,
    winnerName: winner?.displayName || 'Unknown',
  });

  let bettingSummaryText = 'No spectator bets were placed on this match.';
  if (bettingResult.hasBets) {
    if (bettingResult.payouts.length > 0) {
      bettingSummaryText = bettingResult.payouts
        .map((p) => `• **${p.bettorName}**: +${p.payout.toLocaleString()} QP (+${p.profit.toLocaleString()} Profit)`)
        .join('\n');
    } else {
      bettingSummaryText = bettingResult.message || 'No winning bets recorded.';
    }
  }

  const victoryEmbed = new EmbedBuilder()
    .setColor(0xffd166)
    .setTitle(`🏆 Chaos Clash Victory! ${winner?.displayName || 'Unknown'} is Champion!`)
    .setDescription(
      `👑 **MATCH CHAMPION:**\n` +
      `**${formatParticipantName(winner?.displayName || 'Unknown', winner?.cosmetics)}** survived the massacre and claims the arena crown!\n\n` +
      `🪙 **Grand Prize Awarded:** **+${match.prizePool.toLocaleString()} QP** & **+${match.prizeXp} XP**\n` +
      `💰 **Updated Balance:** ${newWinnerPoints.toLocaleString()} QP (Level ${newWinnerLevel})\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎖️ **MATCH ANALYTICS & HIGHLIGHTS:**\n` +
      `• **First Blood:** ${match.firstBlood ? `**${match.firstBlood.killerName}** (Eliminated ${match.firstBlood.victimName})` : 'None'}\n` +
      `• **Match MVP:** **${mvp?.displayName || 'Unknown'}** with **${maxKills}** eliminations\n` +
      `• **Total Participants:** ${match.participants.size} Combatants\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🪙 **SPECTATOR BETTING PAYOUTS:**\n` +
      `${bettingSummaryText}`
    )
    .setThumbnail(winner?.avatarURL || null)
    .setFooter({ text: `Match ID: ${match.matchId} • Questify Battle Royale Engine` })
    .setTimestamp();

  await channel.send({ embeds: [victoryEmbed] }).catch(() => null);

  // Clean up memory maps
  activeMatches.delete(match.guildId);
  matchIndex.delete(match.matchId);
}
