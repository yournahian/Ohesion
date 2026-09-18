import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';

/**
 * Builds the visual Discord Embed and Action Buttons for a live Auction card.
 */
export function buildAuctionPayload(auction) {
  const isExpired = new Date(auction.end_time).getTime() < Date.now();
  const endTimestamp = Math.floor(new Date(auction.end_time).getTime() / 1000);

  const highestBid = Number(auction.current_highest_bid || 0);
  const minNextBid = highestBid > 0 ? highestBid + Number(auction.min_increment) : Number(auction.starting_bid);

  const embed = new EmbedBuilder()
    .setColor(isExpired || !auction.is_active ? 0x6c757d : 0xffd166) // Gold if active, gray if ended
    .setTitle(`🔨 Community Auction: ${auction.item_title}`)
    .setDescription(
      `${auction.description ? `${auction.description}\n\n` : ''}` +
      `**Current Highest Bid**: **${highestBid > 0 ? `${highestBid.toLocaleString()} QP` : 'No bids yet'}**\n` +
      `**Highest Bidder**: ${auction.highest_bidder_id ? `<@${auction.highest_bidder_id}>` : '*None*'}\n` +
      `**Minimum Next Bid**: **${minNextBid.toLocaleString()} QP**\n` +
      `**Min Increment**: **+${auction.min_increment} QP**\n` +
      `**Status**: ${!auction.is_active || isExpired ? '🛑 **Auction Ended**' : `⏳ Ends <t:${endTimestamp}:R>`}`
    )
    .setFooter({ text: `Auction ID: ${auction.auction_id} • Questify Escrow Protected` })
    .setTimestamp();

  const actionRow = new ActionRowBuilder();

  if (auction.is_active && !isExpired) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`auction_bid_${auction.auction_id}`)
        .setLabel('Place Bid')
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

  const currentHighest = Number(auction.current_highest_bid || 0);
  const minRequired = currentHighest > 0 ? currentHighest + Number(auction.min_increment) : Number(auction.starting_bid);

  if (bidAmount < minRequired) {
    return {
      success: false,
      message: `Your bid of **${bidAmount} QP** is too low! Minimum required bid is **${minRequired} QP**.`,
    };
  }

  // 2. Check bidder's QP balance
  const { data: bidderRecord } = await supabase
    .from('users')
    .select('total_points')
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .maybeSingle();

  const bidderBalance = Number(bidderRecord?.total_points || 0);
  if (bidderBalance < bidAmount) {
    return {
      success: false,
      message: `Insufficient Quest Points! You have **${bidderBalance} QP**, but bid requires **${bidAmount} QP**.`,
    };
  }

  // 3. Deduct bid amount from new bidder
  await supabase
    .from('users')
    .update({ total_points: bidderBalance - bidAmount })
    .eq('guild_id', guildId)
    .eq('discord_id', discordId);

  // 4. Automatic Escrow Refund: Refund previous highest bidder
  const previousBidderId = auction.highest_bidder_id;
  const previousBidAmount = Number(auction.current_highest_bid || 0);

  if (previousBidderId && previousBidAmount > 0) {
    const { data: prevRecord } = await supabase
      .from('users')
      .select('total_points')
      .eq('guild_id', guildId)
      .eq('discord_id', previousBidderId)
      .maybeSingle();

    const prevBalance = Number(prevRecord?.total_points || 0);
    await supabase
      .from('users')
      .update({ total_points: prevBalance + previousBidAmount })
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
    message: `✅ **Bid Placed!** You are now the highest bidder with **${bidAmount.toLocaleString()} QP**!\n(Remaining balance: ${(bidderBalance - bidAmount).toLocaleString()} QP)`,
  };
}
