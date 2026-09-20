import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { getCurrencyType } from './guildSettings.js';

/**
 * Builds the visual Discord Embed and Action Buttons for a live Auction card.
 */
export function buildAuctionPayload(auction) {
  const isExpired = new Date(auction.end_time).getTime() < Date.now();
  const endTimestamp = Math.floor(new Date(auction.end_time).getTime() / 1000);

  const highestBid = Number(auction.current_highest_bid || 0);
  const minNextBid = highestBid > 0 ? highestBid + Number(auction.min_increment) : Number(auction.starting_bid);
  const currType = auction.guild_id ? getCurrencyType(auction.guild_id) : 'points';
  const currLabel = currType === 'xp' ? 'XP' : 'CP';

  const embed = new EmbedBuilder()
    .setColor(isExpired || !auction.is_active ? 0x6c757d : 0xffd166) // Gold if active, gray if ended
    .setTitle(`🔨 Community Auction: ${auction.item_title}`)
    .setDescription(
      `${auction.description ? `${auction.description}\n\n` : ''}` +
      `**Current Highest Bid**: **${highestBid > 0 ? `${highestBid.toLocaleString()} ${currLabel}` : 'No bids yet'}**\n` +
      `**Highest Bidder**: ${auction.highest_bidder_id ? `<@${auction.highest_bidder_id}>` : '*None*'}\n` +
      `**Minimum Next Bid**: **${minNextBid.toLocaleString()} ${currLabel}**\n` +
      `**Min Increment**: **+${auction.min_increment} ${currLabel}**\n` +
      `**Status**: ${!auction.is_active || isExpired ? '🛑 **Auction Ended**' : `⏳ Ends <t:${endTimestamp}:R>`}`
    )
    .setFooter({ text: `Auction ID: ${auction.auction_id} • Cohesion Escrow Protected (${currLabel})` })
    .setTimestamp();

  const actionRow = new ActionRowBuilder();

  if (auction.is_active && !isExpired) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`auction_bid_${auction.auction_id}`)
        .setLabel(`Place Bid (${currLabel})`)
        .setEmoji('💰')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`auction_history_${auction.auction_id}`)
        .setLabel('Bid History')
        .setEmoji('📜')
        .setStyle(ButtonStyle.Secondary)
    );
  } else {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`auction_bid_${auction.auction_id}`)
        .setLabel('Auction Closed')
        .setEmoji('🛑')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`auction_history_${auction.auction_id}`)
        .setLabel('Bid History')
        .setEmoji('📜')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return {
    embeds: [embed],
    components: [actionRow],
  };
}

/**
 * Executes a bid with full automatic escrow protection and instant outbid refund.
 */
export async function executeBid({ auctionId, guildId, discordId, bidAmount, client }) {
  // 1. Fetch current auction state
  const { data: auction, error: fetchErr } = await supabase
    .from('auctions')
    .select('*')
    .eq('auction_id', auctionId)
    .maybeSingle();

  if (fetchErr || !auction) {
    return { success: false, message: 'Auction not found.' };
  }

  if (!auction.is_active || new Date(auction.end_time).getTime() < Date.now()) {
    return { success: false, message: 'This auction has already ended!' };
  }

  if (auction.highest_bidder_id === discordId) {
    return { success: false, message: 'You already hold the highest bid!' };
  }

  const currType = getCurrencyType(guildId);
  const currLabel = currType === 'xp' ? 'XP' : 'CP';
  const balanceField = currType === 'xp' ? 'xp' : 'total_points';

  const currentHighest = Number(auction.current_highest_bid || 0);
  const minRequired = currentHighest > 0 ? currentHighest + Number(auction.min_increment) : Number(auction.starting_bid);

  if (bidAmount < minRequired) {
    return {
      success: false,
      message: `Your bid of **${bidAmount} ${currLabel}** is too low! Minimum required bid is **${minRequired} ${currLabel}**.`,
    };
  }

  // 2. Check bidder's balance (XP or CP)
  const { data: bidderRecord } = await supabase
    .from('users')
    .select(balanceField)
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .maybeSingle();

  const bidderBalance = Number(bidderRecord?.[balanceField] || 0);
  if (bidderBalance < bidAmount) {
    return {
      success: false,
      message: `Insufficient ${currLabel === 'XP' ? 'Experience Points' : 'Cohesion Points'}! You have **${bidderBalance} ${currLabel}**, but bid requires **${bidAmount} ${currLabel}**.`,
    };
  }

  // 3. Deduct bid amount from new bidder
  await supabase
    .from('users')
    .update({ [balanceField]: bidderBalance - bidAmount })
    .eq('guild_id', guildId)
    .eq('discord_id', discordId);

  // 4. Automatic Escrow Refund: Refund previous highest bidder
  const previousBidderId = auction.highest_bidder_id;
  const previousBidAmount = Number(auction.current_highest_bid || 0);

  if (previousBidderId && previousBidAmount > 0) {
    const { data: prevRecord } = await supabase
      .from('users')
      .select(balanceField)
      .eq('guild_id', guildId)
      .eq('discord_id', previousBidderId)
      .maybeSingle();

    const prevBalance = Number(prevRecord?.[balanceField] || 0);
    await supabase
      .from('users')
      .update({ [balanceField]: prevBalance + previousBidAmount })
      .eq('guild_id', guildId)
      .eq('discord_id', previousBidderId);
  }

  // 5. Update auction state
  const { data: updatedAuction, error: updateErr } = await supabase
    .from('auctions')
    .update({
      current_highest_bid: bidAmount,
      highest_bidder_id: discordId,
    })
    .eq('auction_id', auctionId)
    .select()
    .single();

  if (updateErr) {
    console.error('[AUCTION UPDATE ERROR]:', updateErr);
    return { success: false, message: 'Failed to record bid.' };
  }

  // 6. Record bid history
  await supabase.from('auction_bids').insert({
    auction_id: auctionId,
    guild_id: guildId,
    discord_id: discordId,
    bid_amount: bidAmount,
  });

  // 7. Update the live Discord message in the channel in real-time!
  if (updatedAuction.channel_id && updatedAuction.message_id) {
    try {
      const channel = await client.channels.fetch(updatedAuction.channel_id);
      if (channel) {
        const msg = await channel.messages.fetch(updatedAuction.message_id);
        if (msg) {
          const newPayload = buildAuctionPayload(updatedAuction);
          await msg.edit(newPayload);
        }
      }
    } catch (err) {
      console.warn('[AUCTION EDIT MSG WARN]:', err.message);
    }
  }

  return {
    success: true,
    message: `✅ **Bid Placed!** You are now the highest bidder with **${bidAmount.toLocaleString()} ${currLabel}**!\n(Remaining balance: ${(bidderBalance - bidAmount).toLocaleString()} ${currLabel})`,
  };
}

/**
 * Concludes an expired auction, edits the live Discord message, and announces the winner.
 */
export async function concludeAuction(auctionId, client) {
  try {
    const { data: auction } = await supabase
      .from('auctions')
      .select('*')
      .eq('auction_id', auctionId)
      .maybeSingle();

    if (!auction || !auction.is_active) return;

    // Mark auction inactive
    await supabase
      .from('auctions')
      .update({ is_active: false })
      .eq('auction_id', auctionId);

    const hasWinner = Boolean(auction.highest_bidder_id && Number(auction.current_highest_bid) > 0);
    const winningBid = Number(auction.current_highest_bid || 0);
    const currType = auction.guild_id ? getCurrencyType(auction.guild_id) : 'points';
    const currLabel = currType === 'xp' ? 'XP' : 'CP';

    // 1. Update the original Discord auction card in the channel
    if (auction.channel_id && auction.message_id && client) {
      try {
        const channel = await client.channels.fetch(auction.channel_id).catch(() => null);
        if (channel) {
          const msg = await channel.messages.fetch(auction.message_id).catch(() => null);
          if (msg) {
            const updatedAuction = { ...auction, is_active: false };
            const payload = buildAuctionPayload(updatedAuction);
            await msg.edit(payload).catch(() => null);
          }

          // 2. Send public announcement in channel
          const endEmbed = new EmbedBuilder()
            .setColor(hasWinner ? 0x06d6a0 : 0x6c757d)
            .setTitle(hasWinner ? '🎊 Auction Ended — Winner Announced!' : '🛑 Auction Ended')
            .setDescription(
              hasWinner
                ? `The auction for **${auction.item_title}** has officially closed!\n\n` +
                  `👑 **Winner:** <@${auction.highest_bidder_id}>\n` +
                  `💰 **Winning Bid:** **${winningBid.toLocaleString()} ${currLabel}**\n` +
                  `🎁 **Item:** **${auction.item_title}**\n\n` +
                  `📢 **Claim Instructions:** Server Admin, please contact <@${auction.highest_bidder_id}> to distribute the reward!`
                : `The auction for **${auction.item_title}** has ended with no bids placed.`
            )
            .setFooter({ text: `Auction ID: ${auction.auction_id}` })
            .setTimestamp();

          await channel.send({ embeds: [endEmbed] }).catch(() => null);
        }
      } catch (e) {
        console.warn('[CONCLUDE AUCTION MSG ERROR]:', e.message);
      }
    }

    // 3. Post to audit log channel if available
    if (client && auction.guild_id) {
      try {
        const guild =
          client.guilds.cache.get(auction.guild_id) ||
          (await client.guilds.fetch(auction.guild_id).catch(() => null));
        if (guild) {
          const logChannel = guild.channels.cache.find(
            c =>
              (c.name === 'cohesion-logs' ||
                c.name === 'questify-logs' ||
                c.name === 'admin-logs' ||
                c.name === 'logs' ||
                c.name === 'mod-logs') &&
              c.isTextBased()
          );

          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setColor(hasWinner ? 0x06d6a0 : 0xffa500)
              .setTitle('🔨 Community Auction Concluded')
              .setDescription(
                `• **Item:** **${auction.item_title}**\n` +
                `• **Status:** ${hasWinner ? 'Won' : 'Closed without bids'}\n` +
                `• **Winner:** ${hasWinner ? `<@${auction.highest_bidder_id}>` : 'None'}\n` +
                `• **Winning Bid:** **${winningBid.toLocaleString()} QP**\n` +
                `• **Auction ID:** \`${auction.auction_id}\``
              )
              .setTimestamp();

            await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
          }
        }
      } catch (e) {
        console.warn('[AUCTION AUDIT LOG ERROR]:', e.message);
      }
    }
  } catch (err) {
    console.error('[CONCLUDE AUCTION ERROR]:', err);
  }
}

const scheduledAuctionTimers = new Map();

/**
 * Schedules auto-conclusion for a single auction.
 */
export function scheduleAuctionConclusion(auction, client) {
  if (!auction || !auction.is_active) return;

  if (scheduledAuctionTimers.has(auction.auction_id)) {
    clearTimeout(scheduledAuctionTimers.get(auction.auction_id));
  }

  const remainingMs = new Date(auction.end_time).getTime() - Date.now();
  if (remainingMs <= 0) {
    concludeAuction(auction.auction_id, client);
    return;
  }

  const timer = setTimeout(() => {
    scheduledAuctionTimers.delete(auction.auction_id);
    concludeAuction(auction.auction_id, client);
  }, remainingMs);

  scheduledAuctionTimers.set(auction.auction_id, timer);
}

/**
 * Watchdog: loads all active auctions from Supabase on startup, schedules their expiry timers,
 * and runs a 30s heartbeat to finalize any expired auctions.
 */
export async function initActiveAuctionsWatcher(client) {
  try {
    const { data: activeAuctions } = await supabase
      .from('auctions')
      .select('*')
      .eq('is_active', true);

    if (activeAuctions && activeAuctions.length > 0) {
      for (const a of activeAuctions) {
        scheduleAuctionConclusion(a, client);
      }
    }
  } catch (err) {
    console.warn('[AUCTION WATCHER ERROR]:', err.message);
  }

  // Periodic heartbeat every 30s
  setInterval(async () => {
    try {
      const now = new Date().toISOString();
      const { data: expiredAuctions } = await supabase
        .from('auctions')
        .select('*')
        .eq('is_active', true)
        .lte('end_time', now);

      if (expiredAuctions && expiredAuctions.length > 0) {
        for (const a of expiredAuctions) {
          await concludeAuction(a.auction_id, client);
        }
      }
    } catch (e) {
      console.warn('[AUCTION HEARTBEAT WARN]:', e.message);
    }
  }, 30 * 1000);
}
