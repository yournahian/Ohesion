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
  TACTICIAN_EVADE_SCENARIOS,
  BERSERKER_SCENARIOS,
  MEDIC_REVIVE_SCENARIOS,
  THIEF_HEIST_SCENARIOS,
  QTE_SUPPLY_WEAPON_SCENARIOS,
  BOUNTY_HUNT_SCENARIOS,
  TEAM_UP_SCENARIOS,
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

// Battle Shield Crest Icon
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
 * Parses duration strings into seconds (e.g. "45s", "5m", "24h").
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
 * Formats seconds into clean text (e.g. "45 Seconds", "2 Minutes", "24 Hours").
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
  mode = 'classic',
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
    mutator: null,
    qteActive: null,
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
    selfReviveUsed: false,
    hasSupplyBuff: false,
    avatarURL: user.displayAvatarURL({ dynamic: true }),
  });

  return {
    success: true,
    totalJoined: match.participants.size,
    match,
  };
}

/**
 * Sets a player's Archetype during the sign-up phase.
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
 * Builds the Rumble Royale-style Lobby Embed & Join / Bet / Class Buttons (Matching Screenshot 3)
 */
export function buildLobbyPayload(match) {
  const isInteractive = match.mode === 'interactive';
  const embed = new EmbedBuilder()
    .setColor(0x57f287) // Rumble Royale Green
    .setTitle(`Chaos Clash hosted by ${match.hostName || 'yournahian'}`)
    .setDescription(
      `Random Era: 🗡️ ${isInteractive ? 'Interactive' : 'Classic'}\n\n` +
      `Click the emoji below to join. Starting in ${formatDurationDisplay(match.signupDurationSec)}!`
    )
    .setThumbnail(BATTLE_CREST_ICON);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`battle_join_${match.matchId}`)
      .setLabel(String(match.participants.size))
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`battle_bet_${match.matchId}`)
      .setLabel('Place Bet')
      .setEmoji('🪙')
      .setStyle(ButtonStyle.Primary)
  );

  const components = [row1];

  if (isInteractive) {
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`battle_pick_class_${match.matchId}`)
        .setLabel('Choose Archetype')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Secondary)
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
 * Helper to sleep asynchronously for delays.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Helper to pick random item from array.
 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Quick-Time Event (QTE) for Interactive Mode
 */
async function triggerLiveQTE(match, channel) {
  const isSupplyDrop = Math.random() < 0.5;

  if (isSupplyDrop) {
    const qteEmbed = new EmbedBuilder()
      .setColor(0xffb703)
      .setTitle('📦 AIRDROP INCOMING! Supply Crate Touching Down!')
      .setDescription(
        'A high-tech prototype weapon crate has dropped into the arena!\n' +
        '**First active fighter to claim the loot gains a +25% Combat Power Boost!**'
      )
      .setFooter({ text: 'Quick-Time Event Active (4s window)' });

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
    if (qteMsg && typeof qteMsg.edit === 'function') await qteMsg.edit({ components: [lootRow] }).catch(() => null);

    if (match.qteActive.resolvedBy) {
      const luckyPlayer = match.participants.get(match.qteActive.resolvedBy);
      if (luckyPlayer) {
        luckyPlayer.hasSupplyBuff = true;
        match.eventLogs.push(`📦 | **${luckyPlayer.displayName}** claimed the prototype airdrop weapon (+25% Combat Power)!`);
      }
    } else {
      match.eventLogs.push(`💨 | The supply crate self-destructed before anyone could secure the payload!`);
    }
    match.qteActive = null;
  } else {
    const hazardEmbed = new EmbedBuilder()
      .setColor(0xd90429)
      .setTitle('🚨 AIR STRIKE IMMINENT! Seek Immediate Shelter!')
      .setDescription(
        'Heavy carpet bombing sirens are blaring across the sector!\n' +
        '**Fighters have 4 seconds to dive for cover! Unshielded players face a 30% chance of sudden elimination!**'
      )
      .setFooter({ text: 'Quick-Time Event Active (4s window)' });

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
    if (qteMsg && typeof qteMsg.edit === 'function') await qteMsg.edit({ components: [coverRow] }).catch(() => null);

    const safePlayers = match.qteActive.coveredPlayers;
    const unlucky = match.alivePlayers.filter((id) => !safePlayers.has(id));

    for (const victimId of unlucky) {
      if (Math.random() < 0.3 && match.alivePlayers.length > 1) {
        const victim = match.participants.get(victimId);
        match.alivePlayers = match.alivePlayers.filter((id) => id !== victimId);
        match.eliminatedPlayers.push(victimId);
        match.eventLogs.push(`💥 | **${victim?.displayName}** was caught outside bunker cover during the carpet bombing!`);
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
 * Executes a duel with full archetype perks (Berserker, Tactician, Medic, Thief, Airdrop).
 */
function resolveCombatDuel(match) {
  const shuffled = [...match.alivePlayers].sort(() => 0.5 - Math.random());
  let [attackerId, defenderId] = shuffled;
  let attacker = match.participants.get(attackerId);
  let defender = match.participants.get(defenderId);

  // Berserker perk: +15% kill aggression bonus
  if (match.mode === 'interactive') {
    if (defender.archetype === 'Berserker' && Math.random() < 0.15) {
      [attackerId, defenderId] = [defenderId, attackerId];
      [attacker, defender] = [defender, attacker];
    }
  }

  // Tactician perk: +20% radar evasion / decoy chance
  if (match.mode === 'interactive' && defender.archetype === 'Tactician' && Math.random() < 0.20) {
    const template = pickRandom(TACTICIAN_EVADE_SCENARIOS);
    return {
      log: template.replace('{player1}', defender.displayName).replace('{player2}', attacker.displayName),
      eliminated: false,
    };
  }

  // Medic perk: Emergency self-revive stim token
  if (match.mode === 'interactive' && defender.archetype === 'Medic' && !defender.selfReviveUsed && match.mutator !== 'Sudden Death') {
    defender.selfReviveUsed = true;
    match.revives.set(defenderId, (match.revives.get(defenderId) || 0) + 1);
    const template = pickRandom(MEDIC_REVIVE_SCENARIOS);
    return {
      log: template.replace('{player1}', defender.displayName),
      eliminated: false,
    };
  }

  // Eliminate defender
  match.alivePlayers = match.alivePlayers.filter((id) => id !== defenderId);
  match.eliminatedPlayers.push(defenderId);
  match.kills.set(attackerId, (match.kills.get(attackerId) || 0) + 1);

  // Thief perk: Steals 15% points on death
  let thiefNote = '';
  if (match.mode === 'interactive' && defender.archetype === 'Thief') {
    const template = pickRandom(THIEF_HEIST_SCENARIOS);
    thiefNote = '\n' + template.replace('{player1}', defender.displayName).replace('{player2}', attacker.displayName);
  }

  // QTE airdrop buff check
  if (attacker.hasSupplyBuff) {
    attacker.hasSupplyBuff = false;
    const template = pickRandom(QTE_SUPPLY_WEAPON_SCENARIOS);
    return {
      log: template.replace('{player1}', attacker.displayName).replace('{player2}', defender.displayName) + thiefNote,
      eliminated: true,
    };
  }

  // Berserker rage scenario
  if (match.mode === 'interactive' && attacker.archetype === 'Berserker' && Math.random() < 0.5) {
    const template = pickRandom(BERSERKER_SCENARIOS);
    return {
      log: template.replace('{player1}', attacker.displayName).replace('{player2}', defender.displayName) + thiefNote,
      eliminated: true,
    };
  }

  const template = pickRandom(DUEL_KILL_SCENARIOS);
  return {
    log: template.replace('{player1}', attacker.displayName).replace('{player2}', defender.displayName) + thiefNote,
    eliminated: true,
  };
}

/**
 * Executes a Hazard event with Medic revive checks.
 */
function resolveHazardEvent(match) {
  const victimId = pickRandom(match.alivePlayers);
  const victim = match.participants.get(victimId);

  // Medic self-revive check
  if (match.mode === 'interactive' && victim.archetype === 'Medic' && !victim.selfReviveUsed && match.mutator !== 'Sudden Death') {
    victim.selfReviveUsed = true;
    match.revives.set(victimId, (match.revives.get(victimId) || 0) + 1);
    const template = pickRandom(MEDIC_REVIVE_SCENARIOS);
    return {
      log: template.replace('{player1}', victim.displayName),
      eliminated: false,
    };
  }

  match.alivePlayers = match.alivePlayers.filter((id) => id !== victimId);
  match.eliminatedPlayers.push(victimId);

  const template = pickRandom(HAZARD_DEATH_SCENARIOS);
  return {
    log: template.replace('{player1}', victim.displayName),
    eliminated: true,
  };
}

/**
 * Executes the entire Rumble Royale-style game loop powered by the Core Tactical Engine.
 */
export async function startBattleSimulation(match, client) {
  const guildId = match.guildId;
  const channelId = match.channelId;

  if (match.countdownTimers) {
    match.countdownTimers.forEach(clearTimeout);
    match.countdownTimers = [];
  }

  let channel = null;
  try {
    channel = await client.channels.fetch(channelId).catch(() => null);
  } catch (_) {}

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

  // 20% Random Mutator in Interactive Mode
  if (match.mode === 'interactive' && Math.random() < 0.25) {
    match.mutator = pickRandom(['Sudden Death', 'Bounty Hunt', "Rich Man's Land"]);
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
      `**Era:** 🗡️ ${match.mode === 'interactive' ? 'Interactive' : 'Classic'}\n` +
      (match.mutator ? `**Mutator:** 🌪️ ${match.mutator}\n` : '') +
      `**Prize:** ${match.prizePool} 🪙\n` +
      `**Gold Per Kill:** ${match.goldPerKill} 🪙`
    )
    .setThumbnail(BATTLE_CREST_ICON);

  if (channel) {
    await channel.send({ embeds: [startSessionEmbed] }).catch(() => null);
  }

  await sleep(4000);

  // 2. Sequential Round-by-Round Execution (Matching Screenshots 1, 2, 4)
  let roundNumber = 1;

  while (match.alivePlayers.length > 1 && channel) {
    match.currentTick = roundNumber;

    // Trigger Interactive QTE every 3 rounds in Interactive Mode
    if (match.mode === 'interactive' && (roundNumber === 2 || (match.mutator === "Rich Man's Land" && roundNumber % 2 === 0))) {
      await triggerLiveQTE(match, channel);
      if (match.alivePlayers.length <= 1) break;
    }

    const roundEvents = [];
    if (match.eventLogs.length > 0) {
      roundEvents.push(...match.eventLogs);
      match.eventLogs = [];
    }

    if (match.alivePlayers.length === 2) {
      // Final 1v1 Showdown
      const outcome = resolveCombatDuel(match);
      roundEvents.push(outcome.log);
    } else {
      // Multi-player Round (generate 2 to 3 events)
      const numEvents = Math.min(match.alivePlayers.length, 3);
      let eliminationsInRound = 0;

      // Event 1: Ambient / Weapon Crafting
      const ambientPlayerId = pickRandom(match.alivePlayers);
      const ambientPlayer = match.participants.get(ambientPlayerId);
      if (ambientPlayer) {
        const isWeapon = Math.random() < 0.4;
        const template = isWeapon ? pickRandom(WEAPON_PREP_SCENARIOS) : pickRandom(NEUTRAL_SUPPLY_SCENARIOS);
        roundEvents.push(template.replace('{player1}', ambientPlayer.displayName));
      }

      // Event 2: Duel or Hazard with Archetype Perks
      if (match.alivePlayers.length > 1) {
        const isHazard = Math.random() < 0.3;
        const outcome = isHazard ? resolveHazardEvent(match) : resolveCombatDuel(match);
        roundEvents.push(outcome.log);
        if (outcome.eliminated) eliminationsInRound++;
      }

      // Event 3 (if 3+ alive): Another Duel
      if (match.alivePlayers.length >= 3 && numEvents >= 3) {
        const outcome = resolveCombatDuel(match);
        roundEvents.push(outcome.log);
        if (outcome.eliminated) eliminationsInRound++;
      }

      // Guarantee at least 1 elimination occurs so the match doesn't stall indefinitely
      if (eliminationsInRound === 0 && match.alivePlayers.length > 1) {
        const outcome = resolveHazardEvent(match);
        roundEvents.push(outcome.log);
      }
    }

    // Build Round Embed
    const roundEmbed = new EmbedBuilder()
      .setColor(0x57f287) // Rumble Royale Green
      .setTitle(`__Round ${roundNumber}__`)
      .setDescription(
        `${roundEvents.join('\n')}\n\n` +
        `Players Left: ${match.alivePlayers.length}\n` +
        `Era: ${match.mode === 'interactive' ? 'Interactive' : 'Classic'}`
      );

    await channel.send({ embeds: [roundEmbed] }).catch(() => null);

    roundNumber++;
    await sleep(4500);
  }

  // 3. Conclude Match & Announce Winner + Runners-up Rewards
  await concludeMatch(match, channel, client);
}

/**
 * Concludes the match, distributes prizes & XP to Winner AND Runners-Up, settles bets, and posts results.
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

  // Calculate Prize Distribution for Winner AND Runners-Up:
  const totalPrize = match.prizePool;
  const totalXp = match.prizeXp;
  const participantCount = match.participants.size;

  let winnerQP = totalPrize;
  let runner2QP = 0;
  let runner3QP = 0;

  let winnerXP = totalXp;
  let runner2XP = Math.round(totalXp * 0.5);
  let runner3XP = Math.round(totalXp * 0.25);

  if (participantCount === 2) {
    winnerQP = Math.round(totalPrize * 0.7);
    runner2QP = Math.round(totalPrize * 0.3);
  } else if (participantCount >= 3) {
    winnerQP = Math.round(totalPrize * 0.6);
    runner2QP = Math.round(totalPrize * 0.25);
    runner3QP = Math.round(totalPrize * 0.15);
  }

  // Award Winner in Supabase
  if (winner) {
    const { data: rec } = await supabase
      .from('users')
      .select('total_points, xp, level')
      .eq('guild_id', match.guildId)
      .eq('discord_id', winnerId)
      .maybeSingle();

    const curPoints = Number(rec?.total_points || 0);
    const curXp = Number(rec?.xp || 0);
    const newPoints = curPoints + winnerQP;
    const newXp = curXp + winnerXP;
    const newLevel = getLevelFromXp(newXp);

    await supabase.from('users').upsert({
      guild_id: match.guildId,
      discord_id: winnerId,
      total_points: newPoints,
      xp: newXp,
      level: newLevel,
    }, { onConflict: 'guild_id,discord_id' });
  }

  // Identify Runners-up (reverse elimination order)
  const eliminatedList = [...match.eliminatedPlayers].reverse().filter((id) => id !== winnerId);
  const runner2Id = eliminatedList[0];
  const runner3Id = eliminatedList[1];

  // Award 2nd Place
  if (runner2Id && runner2QP > 0) {
    const { data: rec2 } = await supabase
      .from('users')
      .select('total_points, xp, level')
      .eq('guild_id', match.guildId)
      .eq('discord_id', runner2Id)
      .maybeSingle();
    const curPts2 = Number(rec2?.total_points || 0);
    const curXp2 = Number(rec2?.xp || 0);
    await supabase.from('users').upsert({
      guild_id: match.guildId,
      discord_id: runner2Id,
      total_points: curPts2 + runner2QP,
      xp: curXp2 + runner2XP,
      level: getLevelFromXp(curXp2 + runner2XP),
    }, { onConflict: 'guild_id,discord_id' });
  }

  // Award 3rd Place
  if (runner3Id && runner3QP > 0) {
    const { data: rec3 } = await supabase
      .from('users')
      .select('total_points, xp, level')
      .eq('guild_id', match.guildId)
      .eq('discord_id', runner3Id)
      .maybeSingle();
    const curPts3 = Number(rec3?.total_points || 0);
    const curXp3 = Number(rec3?.xp || 0);
    await supabase.from('users').upsert({
      guild_id: match.guildId,
      discord_id: runner3Id,
      total_points: curPts3 + runner3QP,
      xp: curXp3 + runner3XP,
      level: getLevelFromXp(curXp3 + runner3XP),
    }, { onConflict: 'guild_id,discord_id' });
  }

  // Award Gold / QP Per Kill to all combatants
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
      `**Reward:** ${winnerQP} 🪙 & +${winnerXP} XP\n\n` +
      `Total Players: ${match.participants.size}`
    );

  // Build Runners-up list with rewarded prizes
  const runnersUpText = eliminatedList.slice(0, 5)
    .map((id, idx) => {
      const p = match.participants.get(id);
      const name = p?.displayName || 'Unknown';
      if (idx === 0 && runner2QP > 0) return `${idx + 2}. ${name} (+${runner2QP} 🪙, +${runner2XP} XP)`;
      if (idx === 1 && runner3QP > 0) return `${idx + 2}. ${name} (+${runner3QP} 🪙, +${runner3XP} XP)`;
      return `${idx + 2}. ${name}`;
    })
    .join('\n') || 'None';

  const killsText = `${maxKills} ${topKiller?.displayName || 'None'}`;
  const revivesText = maxRevives > 0 ? `${maxRevives} ${topReviver?.displayName}` : '1 None';

  // Build Stats Embed (Matching Screenshot 4)
  const statsEmbed = new EmbedBuilder()
    .setColor(0xfee75c)
    .addFields(
      { name: '🔮 Runners-up', value: runnersUpText, inline: true },
      { name: '⚔️ Most Kills', value: killsText, inline: true },
      { name: '✨ Most Revives', value: revivesText, inline: true }
    )
    .setFooter({ text: `🗡️ Era: ${match.mode === 'interactive' ? 'Interactive' : 'Classic'} • Chaos Clash` });

  if (channel) {
    await channel.send({
      content: `<@${winnerId}>`,
      embeds: [winnerEmbed, statsEmbed],
    }).catch(() => null);
  }

  activeMatches.delete(match.guildId);
  matchIndex.delete(match.matchId);
}
