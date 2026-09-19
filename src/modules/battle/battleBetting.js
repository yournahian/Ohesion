import { supabase } from '../../lib/supabase.js';

// In-memory store for active match bets: matchId => Array<{ bettorId, bettorName, targetId, targetName, amount }>
const matchBets = new Map();

/**
 * Retrieves all bets placed on a match.
 */
export function getMatchBets(matchId) {
  return matchBets.get(matchId) || [];
}

/**
 * Places a spectator bet on an active fighter in a match.
 */
export async function placeBet({ matchId, guildId, bettorId, bettorName, targetId, targetName, amount }) {
  const betAmount = parseInt(amount, 10);
  if (isNaN(betAmount) || betAmount <= 0) {
    return { success: false, message: '❌ Invalid bet amount. Please enter a positive number of QP.' };
  }

  // Fetch bettor balance
  const { data: userRecord } = await supabase
    .from('users')
    .select('total_points')
    .eq('guild_id', guildId)
    .eq('discord_id', bettorId)
    .maybeSingle();

  const currentPoints = Number(userRecord?.total_points || 0);
  if (currentPoints < betAmount) {
    return {
      success: false,
      message: `🪙 **Insufficient Quest Points:** You only have **${currentPoints} QP**, but tried to bet **${betAmount} QP**.`,
    };
  }

  // Deduct bet amount from bettor's balance immediately
  const newPoints = currentPoints - betAmount;
  await supabase
    .from('users')
    .update({ total_points: newPoints })
    .eq('guild_id', guildId)
    .eq('discord_id', bettorId)
    .catch((err) => console.warn('[BETTING DB] Deduct points error:', err.message));

  if (!matchBets.has(matchId)) {
    matchBets.set(matchId, []);
  }

  const bets = matchBets.get(matchId);
  bets.push({
    bettorId,
    bettorName,
    targetId,
    targetName,
    amount: betAmount,
    placedAt: Date.now(),
  });

  return {
    success: true,
    betAmount,
    targetName,
    remainingPoints: newPoints,
    totalBets: bets.length,
    totalPot: bets.reduce((sum, b) => sum + b.amount, 0),
  };
}

/**
 * Settles all bets when the match ends and returns payout summary.
 */
export async function settleMatchBets({ matchId, guildId, winnerId, winnerName }) {
  const bets = matchBets.get(matchId) || [];
  if (bets.length === 0) {
    return { hasBets: false, totalPot: 0, payouts: [] };
  }

  const totalPot = bets.reduce((sum, b) => sum + b.amount, 0);
  const winningBets = bets.filter((b) => b.targetId === winnerId);

  // If no one bet on the winner, the pot is retained by the server/house or refunded
  if (winningBets.length === 0) {
    matchBets.delete(matchId);
    return {
      hasBets: true,
      totalPot,
      winningBetsCount: 0,
      payouts: [],
      message: `🪙 No spectators placed bets on **${winnerName}**. The ${totalPot.toLocaleString()} QP prize pool rolled over to the house!`,
    };
  }

  const totalWinningStake = winningBets.reduce((sum, b) => sum + b.amount, 0);
  const payouts = [];

  for (const bet of winningBets) {
    // Proportional share of the total pot
    const shareRatio = bet.amount / totalWinningStake;
    const payoutAmount = Math.round(shareRatio * totalPot);

    // Credit payout to bettor
    const { data: bettorUser } = await supabase
      .from('users')
      .select('total_points')
      .eq('guild_id', guildId)
      .eq('discord_id', bet.bettorId)
      .maybeSingle();

    const curPoints = Number(bettorUser?.total_points || 0);
    const updatedPoints = curPoints + payoutAmount;

    await supabase
      .from('users')
      .update({ total_points: updatedPoints })
      .eq('guild_id', guildId)
      .eq('discord_id', bet.bettorId)
      .catch((err) => console.warn('[BETTING PAYOUT ERROR]:', err.message));

    payouts.push({
      bettorId: bet.bettorId,
      bettorName: bet.bettorName,
      stake: bet.amount,
      payout: payoutAmount,
      profit: payoutAmount - bet.amount,
    });
  }

  // Clear bets from memory
  matchBets.delete(matchId);

  return {
    hasBets: true,
    totalPot,
    winningBetsCount: winningBets.length,
    payouts,
  };
}
