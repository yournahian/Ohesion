import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { getRequiredXpForLevel } from './levelCalculator.js';
import {
  getGuildSettings,
  getCurrencyType,
  isModuleEnabled,
} from './guildSettings.js';

/**
 * Builds the Cohesion Hub interactive embed and action rows for a user.
 */
export async function buildHubPayload(guild, user, member = null) {
  if (!guild || !guild.id) {
    return {
      content:
        '⚠️ Cohesion is not added to this server as a bot. Please invite Cohesion to this server with Administrator permissions.',
    };
  }
  const guildId = guild.id;
  const userId = user.id;

  const resolvedMember =
    member ||
    guild.members?.cache?.get(userId) ||
    (await guild.members?.fetch(userId).catch(() => null));

  const isAdmin = Boolean(
    resolvedMember?.permissions?.has(PermissionFlagsBits.Administrator) ||
    resolvedMember?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    guild.ownerId === userId
  );

  // 1. Fetch user stats from Supabase
  const { data: userRecord } = await supabase
    .from('users')
    .select('*')
    .eq('guild_id', guildId)
    .eq('discord_id', userId)
    .maybeSingle();

  // 2. Fetch Twitter integration status
  const { data: twitterRecord } = await supabase
    .from('user_integrations')
    .select('provider_username')
    .eq('discord_id', userId)
    .eq('provider', 'twitter')
    .maybeSingle();

  // 3. Fetch completed quests count
  const { count: completedQuests } = await supabase
    .from('quest_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('discord_id', userId)
    .eq('status', 'verified');

  const xp = Number(userRecord?.xp || 0);
  const level = Number(userRecord?.level || 1);
  const points = Number(userRecord?.total_points || 0);
  const streak = Number(userRecord?.daily_streak || 0);

  // Guild mode & currency settings
  const settings = getGuildSettings(guild.id);
  const currencyType = getCurrencyType(guild.id);
  const pointsEnabled = isModuleEnabled(guild.id, 'points');
  const xpEnabled = isModuleEnabled(guild.id, 'xp');
  const rafflesEnabled = isModuleEnabled(guild.id, 'raffles');
  const marketplaceEnabled = isModuleEnabled(guild.id, 'marketplace');
  const auctionsEnabled = isModuleEnabled(guild.id, 'auctions');
  const questsEnabled = isModuleEnabled(guild.id, 'quests');
  const referralsEnabled = isModuleEnabled(guild.id, 'referrals');
  const ticketsEnabled = isModuleEnabled(guild.id, 'tickets');

  // Math progression
  const currentLevelXp = getRequiredXpForLevel(level);
  const nextLevelXp = getRequiredXpForLevel(level + 1);
  const xpIntoLevel = Math.max(0, xp - currentLevelXp);
  const xpNeededForNext = Math.max(1, nextLevelXp - currentLevelXp);
  const progressPercent = Math.min(100, Math.floor((xpIntoLevel / xpNeededForNext) * 100));

  const totalBars = 10;
  const filledBars = Math.round((progressPercent / 100) * totalBars);
  const emptyBars = totalBars - filledBars;
  const progressBar = '▰'.repeat(filledBars) + '▱'.repeat(emptyBars);

  // Status badges
  const twitterStatus = twitterRecord ? `@${twitterRecord.provider_username}` : 'Not Linked';
  const walletAddress = userRecord?.wallet_address || userRecord?.evm_address;
  const walletChain = userRecord?.wallet_chain || 'EVM';
  const walletStatus = walletAddress
    ? `\`${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}\` (${walletChain})`
    : 'Not Linked';

  // Dynamic description based on active mode
  let modeDesc = `Welcome to **Cohesion**! Engage with community posts, participate in chat, climb the leaderboards, and enter raffles using your points.`;
  if (currencyType === 'xp') {
    modeDesc = `Welcome to **Cohesion**! This server uses **Server XP** as the spendable currency for raffles, auctions, and marketplace perks.`;
  } else if (!pointsEnabled) {
    modeDesc = `Welcome to **Cohesion**! Earn XP through chat and voice, unlock exclusive tier roles, and climb the community leaderboards.`;
  }

  const iconURL = typeof user.displayAvatarURL === 'function'
    ? user.displayAvatarURL({ dynamic: true })
    : null;

  const authorObj = {
    name: `${user.displayName || user.username || 'Member'}'s Cohesion Hub`,
  };
  if (iconURL) authorObj.iconURL = iconURL;

  let tierTitle = 'Bronze Explorer';
  let tierColor = 0x5865f2;
  if (level >= 50) { tierTitle = 'Apex Legend'; tierColor = 0xe0aaff; }
  else if (level >= 25) { tierTitle = 'Diamond Master'; tierColor = 0x4cc9f0; }
  else if (level >= 10) { tierTitle = 'Gold Veteran'; tierColor = 0xffd166; }
  else if (level >= 5) { tierTitle = 'Silver Pioneer'; tierColor = 0xc0c0c0; }

  const hubEmbed = new EmbedBuilder()
    .setColor(tierColor)
    .setAuthor(authorObj)
    .setTitle(`⚡ ${guild.name} • Community Ecosystem`)
    .setDescription(modeDesc);

  // Add fields dynamically based on enabled modules
  if (xpEnabled) {
    hubEmbed.addFields({ name: '🎖️ Rank & Level', value: `**${tierTitle}** (Level ${level})`, inline: true });
  }

  if (currencyType === 'points') {
    hubEmbed.addFields({ name: '🪙 Cohesion Points', value: `**${points.toLocaleString()} CP**`, inline: true });
  } else if (currencyType === 'xp') {
    hubEmbed.addFields({ name: '✨ Spendable XP', value: `**${xp.toLocaleString()} XP**`, inline: true });
  }

  hubEmbed.addFields({ name: '🔥 Daily Streak', value: `**${streak} Day${streak === 1 ? '' : 's'}**`, inline: true });

  if (xpEnabled) {
    hubEmbed.addFields({
      name: `📈 Level Progress (${progressPercent}%)`,
      value: `${progressBar}\n\`${xpIntoLevel.toLocaleString()} / ${xpNeededForNext.toLocaleString()} XP to Level ${level + 1} • Total: ${xp.toLocaleString()} XP\``,
    });
  }

  if (questsEnabled) {
    hubEmbed.addFields({ name: '🎯 Completed Quests', value: `**${completedQuests || 0} Actions**`, inline: true });
  }

  hubEmbed.addFields(
    { name: '🐦 Twitter / X Account', value: `**${twitterStatus}**`, inline: true },
    { name: '👛 Multi-Chain Wallet', value: `**${walletStatus}**`, inline: true }
  );

  const thumbURL = (typeof guild.iconURL === 'function' ? guild.iconURL({ dynamic: true }) : null) || iconURL;
  if (thumbURL) {
    hubEmbed.setThumbnail(thumbURL);
  }
  hubEmbed
    .setFooter({ text: `Cohesion • ${(settings.server_mode || 'full_economy').toUpperCase().replace(/_/g, ' ')}` })
    .setTimestamp();

  // Row 1: Core Action Buttons
  const row1Components = [];

  // Claim Daily button (if currency or streak enabled)
  row1Components.push(
    new ButtonBuilder()
      .setCustomId('hub_daily_claim')
      .setLabel(currencyType === 'xp' ? 'Claim Daily XP' : 'Claim Daily')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success)
  );

  // Leaderboard button
  row1Components.push(
    new ButtonBuilder()
      .setCustomId('hub_leaderboard')
      .setLabel('Leaderboard')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Primary)
  );

  // Raffles button
  if (rafflesEnabled) {
    row1Components.push(
      new ButtonBuilder()
        .setCustomId('hub_raffles')
        .setLabel(currencyType === 'xp' ? 'Raffles (XP)' : 'Raffles')
        .setEmoji('🎟️')
        .setStyle(ButtonStyle.Primary)
    );
  }

  // Marketplace button
  if (marketplaceEnabled) {
    row1Components.push(
      new ButtonBuilder()
        .setCustomId('hub_marketplace')
        .setLabel(currencyType === 'xp' ? 'Marketplace (XP)' : 'Marketplace')
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Primary)
    );
  }

  // Auctions button
  if (auctionsEnabled) {
    row1Components.push(
      new ButtonBuilder()
        .setCustomId('hub_auctions')
        .setLabel(currencyType === 'xp' ? 'Auctions (XP)' : 'Auctions')
        .setEmoji('🔨')
        .setStyle(ButtonStyle.Primary)
    );
  }

  const actionRow1 = new ActionRowBuilder().addComponents(row1Components.slice(0, 5));

  // Row 2: Account, Multi-chain Wallet, and Socials
  const actionRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('hub_link_wallet')
      .setLabel('12-Chain Wallet')
      .setEmoji('👛')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('hub_connect_twitter')
      .setLabel(twitterRecord ? 'Change X' : 'Link X')
      .setEmoji('🐦')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('hub_socials')
      .setLabel('Connect Socials')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('hub_refresh')
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 3: Growth & Social Raids
  const row3Components = [];
  if (referralsEnabled) {
    row3Components.push(
      new ButtonBuilder()
        .setCustomId('hub_referrals')
        .setLabel('Invite Codes & Referrals')
        .setEmoji('👥')
        .setStyle(ButtonStyle.Success)
    );
  }
  if (questsEnabled) {
    row3Components.push(
      new ButtonBuilder()
        .setCustomId('hub_promote_tweet')
        .setLabel('Promote My Tweet (Raid)')
        .setEmoji('🚀')
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (ticketsEnabled) {
    row3Components.push(
      new ButtonBuilder()
        .setCustomId('hub_open_ticket')
        .setLabel('Support Ticket')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Success)
    );
  }



  const components = [actionRow1, actionRow2];
  if (row3Components.length > 0) {
    for (let i = 0; i < row3Components.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(row3Components.slice(i, i + 5)));
    }
  }

  return {
    embeds: [hubEmbed],
    components,
  };
}
