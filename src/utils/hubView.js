import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { getRequiredXpForLevel } from './levelCalculator.js';

/**
 * Builds the Questify Community Hub interactive embed and action rows for a user.
 */
export async function buildHubPayload(guild, user) {
  if (!guild || !guild.id) {
    return {
      content:
        '⚠️ Questify is not added to this server as a bot. Please invite Questify to this server using this link:\nhttps://discord.com/oauth2/authorize?client_id=1550543145840934942&permissions=8&scope=bot%20applications.commands',
    };
  }
  const guildId = guild.id;
  const userId = user.id;

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

  // 3. Fetch Wallet integration status
  const { data: walletRecord } = await supabase
    .from('user_integrations')
    .select('provider_username, provider_user_id')
    .eq('discord_id', userId)
    .eq('provider', 'wallet')
    .maybeSingle();

  // 4. Count user's completed claims
  const { count: completedQuests } = await supabase
    .from('claimed_quests')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('discord_id', userId);

  const xp = Number(userRecord?.xp || 0);
  const level = Number(userRecord?.level || 1);
  const points = Number(userRecord?.total_points || 0);
  const streak = Number(userRecord?.daily_streak || 0);

  // Level progress bar
  const currentLevelXp = getRequiredXpForLevel(level);
  const nextLevelXp = getRequiredXpForLevel(level + 1);
  const xpIntoLevel = Math.max(0, xp - currentLevelXp);
  const xpNeededForNext = Math.max(1, nextLevelXp - currentLevelXp);
  const progressPercent = Math.min(100, Math.floor((xpIntoLevel / xpNeededForNext) * 100));

  const totalBars = 10;
  const filledBars = Math.round((progressPercent / 100) * totalBars);
  const emptyBars = totalBars - filledBars;
  const progressBar = '▰'.repeat(filledBars) + '▱'.repeat(emptyBars);

  const twitterStatus = twitterRecord?.provider_username
    ? `✅ Linked (@${twitterRecord.provider_username})`
    : '❌ Not Connected';

  const walletStatus = walletRecord?.provider_username
    ? `\`${walletRecord.provider_username.slice(0, 6)}...${walletRecord.provider_username.slice(-4)}\` (${walletRecord.provider_user_id || 'EVM'})`
    : '❌ Not Connected';

  const hubEmbed = new EmbedBuilder()
    .setColor(0x5865f2) // Blurple
    .setAuthor({
      name: `${user.displayName || user.username}'s Questify Hub`,
      iconURL: user.displayAvatarURL({ dynamic: true }),
    })
    .setTitle(`⚡ ${guild.name} • Engagement Portal`)
    .setDescription(
      `Welcome to **Questify**! Engage with community posts, participate in chat, climb the leaderboards, and enter raffles using your points.`
    )
    .addFields(
      { name: '🎖️ Level', value: `**Level ${level}**`, inline: true },
      { name: '🪙 Quest Points', value: `**${points.toLocaleString()} QP**`, inline: true },
      { name: '🔥 Daily Streak', value: `**${streak} Day${streak === 1 ? '' : 's'}**`, inline: true },
      {
        name: `📈 Level Progress (${progressPercent}%)`,
        value: `${progressBar}\n\`${xpIntoLevel.toLocaleString()} / ${xpNeededForNext.toLocaleString()} XP to Level ${level + 1}\``,
      },
      { name: '🎯 Completed Quests', value: `**${completedQuests || 0} Actions**`, inline: true },
      { name: '🐦 Twitter / X Account', value: `**${twitterStatus}**`, inline: true },
      { name: '👛 Payout Wallet', value: `**${walletStatus}**`, inline: true }
    )
    .setThumbnail(guild.iconURL({ dynamic: true }) || user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: 'Questify • Visual Community Gamification' })
    .setTimestamp();

  // Row 1: Core Action Buttons
  const actionRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('hub_daily_claim')
      .setLabel('Claim Daily')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('hub_leaderboard')
      .setLabel('Leaderboard')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('hub_raffles')
      .setLabel('Active Raffles')
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('hub_marketplace')
      .setLabel('Marketplace')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Primary)
  );

  // Row 2: Account & Utility Buttons
  const actionRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('hub_auctions')
      .setLabel('Active Auctions')
      .setEmoji('🔨')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('hub_connect_twitter')
      .setLabel(twitterRecord ? 'Change X' : 'Link X')
      .setEmoji('🐦')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('hub_link_wallet')
      .setLabel(walletRecord ? 'Change Wallet' : 'Link Wallet')
      .setEmoji('👛')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('hub_refresh')
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [hubEmbed],
    components: [actionRow1, actionRow2],
  };
}
