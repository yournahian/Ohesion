import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';

/**
 * Helper to parse duration string like "10m", "2h", "1d" into milliseconds
 */
function parseDuration(str) {
  const match = str.trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  return null;
}

export default {
  data: new SlashCommandBuilder()
    .setName('raffle')
    .setDescription('Create, enter, and view community raffles.')
    // Subcommand: create (Admin only)
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new raffle (Admin only)')
        .addStringOption(option =>
          option.setName('prize').setDescription('The prize being raffled').setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('cost')
            .setDescription('Ticket cost in Engage Points')
            .setRequired(true)
            .setMinValue(0)
        )
        .addStringOption(option =>
          option
            .setName('duration')
            .setDescription('Duration of the raffle (e.g. 30m, 2h, 1d)')
            .setRequired(true)
        )
    )
    // Subcommand: list
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('List all active raffles in this server')
    )
    // Subcommand: enter
    .addSubcommand(subcommand =>
      subcommand
        .setName('enter')
        .setDescription('Enter an active raffle by purchasing tickets with Engage Points')
        .addStringOption(option =>
          option.setName('raffle_id').setDescription('The UUID of the raffle').setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('tickets')
            .setDescription('Number of tickets to purchase (default: 1)')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    // Subcommand: draw (Admin only)
    .addSubcommand(subcommand =>
      subcommand
        .setName('draw')
        .setDescription('End a raffle and pick a random winner (Admin only)')
        .addStringOption(option =>
          option.setName('raffle_id').setDescription('The UUID of the raffle to draw').setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // --- 1. RAFFLE CREATE (ADMIN ONLY) ---
    if (subcommand === 'create') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: '⛔ You need `Manage Server` permissions to create a raffle.',
          ephemeral: true,
        });
      }

      const prize = interaction.options.getString('prize');
      const cost = interaction.options.getInteger('cost');
      const durationStr = interaction.options.getString('duration');
      const durationMs = parseDuration(durationStr);

      if (!durationMs) {
        return interaction.reply({
          content: '❌ Invalid duration format. Please use format like `30m` (minutes), `2h` (hours), or `1d` (days).',
          ephemeral: true,
        });
      }

      await interaction.deferReply();
      const endTime = new Date(Date.now() + durationMs).toISOString();

      const { data: raffle, error } = await supabase
        .from('raffles')
        .insert({
          guild_id: guildId,
          prize,
          cost,
          end_time: endTime,
          is_active: true,
          created_by: userId,
        })
        .select()
        .single();

      if (error) {
        console.error('[RAFFLE CREATE ERROR]:', error);
        return interaction.editReply({ content: '❌ Failed to create raffle in the database.' });
      }

      const embed = new EmbedBuilder()
        .setColor(0x06d6a0)
        .setTitle('🎟️ New Raffle Created!')
        .setDescription(`**Prize**: ${prize}\n**Cost per Ticket**: ${cost} 🪙 Engage Points\n**Ends**: <t:${Math.floor(new Date(endTime).getTime() / 1000)}:R>`)
        .addFields({
          name: 'How to Enter',
          value: `Use \`/raffle enter raffle_id:${raffle.raffle_id} tickets:1\``,
        })
        .setFooter({ text: `Raffle ID: ${raffle.raffle_id}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // --- 2. RAFFLE LIST ---
    if (subcommand === 'list') {
      await interaction.deferReply();

      const { data: rawRaffles, error } = await supabase
        .from('raffles')
        .select('*')
        .eq('guild_id', guildId)
        .eq('is_active', true)
        .order('end_time', { ascending: true });

      if (error) {
        console.error('[RAFFLE LIST ERROR]:', error);
        return interaction.editReply({ content: '❌ Failed to fetch raffles.' });
      }

      const now = new Date();
      const raffles = (rawRaffles || []).filter(r => new Date(r.end_time) > now);

      if (!raffles || raffles.length === 0) {
        return interaction.editReply({ content: '🎁 There are no active raffles right now. Stay tuned!' });
      }

      const embed = new EmbedBuilder()
        .setColor(0x118ab2)
        .setTitle('🎉 Active Community Raffles')
        .setDescription(
          raffles
            .map(
              (r, idx) =>
                `**${idx + 1}. ${r.prize}**\n` +
                `• **Cost**: ${r.cost} 🪙 Points\n` +
                `• **Ends**: <t:${Math.floor(new Date(r.end_time).getTime() / 1000)}:R>\n` +
                `• **ID**: \`${r.raffle_id}\`\n` +
                `• **Enter**: \`/raffle enter raffle_id:${r.raffle_id}\``
            )
            .join('\n\n')
        )
        .setFooter({ text: 'Use /raffle enter with the Raffle ID to participate' });

      return interaction.editReply({ embeds: [embed] });
    }

    // --- 3. RAFFLE ENTER ---
    if (subcommand === 'enter') {
      const raffleId = interaction.options.getString('raffle_id');
      const ticketsCount = interaction.options.getInteger('tickets') || 1;

      await interaction.deferReply({ ephemeral: true });

      // Fetch the raffle
      const { data: raffle, error: raffleError } = await supabase
        .from('raffles')
        .select('*')
        .eq('raffle_id', raffleId)
        .eq('guild_id', guildId)
        .maybeSingle();

      if (raffleError || !raffle) {
        return interaction.editReply({ content: '❌ Raffle not found or invalid Raffle ID.' });
      }

      if (!raffle.is_active || new Date(raffle.end_time) < new Date()) {
        return interaction.editReply({ content: '❌ This raffle has already ended or is inactive.' });
      }

      const totalCost = Number(raffle.cost) * ticketsCount;

      // Fetch user balance
      const { data: userRecord, error: userError } = await supabase
        .from('users')
        .select('total_points')
        .eq('guild_id', guildId)
        .eq('discord_id', userId)
        .maybeSingle();

      if (userError || !userRecord) {
        return interaction.editReply({
          content: '❌ Could not retrieve your profile. Gain some XP by chatting first!',
        });
      }

      const userPoints = Number(userRecord.total_points || 0);

      if (userPoints < totalCost) {
        return interaction.editReply({
          content: `❌ Insufficient Engage Points! You need **${totalCost}** points for **${ticketsCount}** ticket(s), but you currently have **${userPoints}** points.`,
        });
      }

      // Deduct user points
      const { error: deductError } = await supabase
        .from('users')
        .update({ total_points: userPoints - totalCost })
        .eq('guild_id', guildId)
        .eq('discord_id', userId);

      if (deductError) {
        console.error('[RAFFLE DEDUCT ERROR]:', deductError);
        return interaction.editReply({ content: '❌ Failed to process points deduction.' });
      }

      // Fetch existing entries or insert new one safely (consolidating any duplicate rows)
      const { data: existingEntries } = await supabase
        .from('raffle_entries')
        .select('*')
        .eq('raffle_id', raffleId)
        .eq('discord_id', userId);

      const currentOwned = (existingEntries || []).reduce((sum, e) => sum + (e.tickets_bought || 0), 0);
      const totalTicketsOwned = currentOwned + ticketsCount;

      if (existingEntries && existingEntries.length > 0) {
        await supabase
          .from('raffle_entries')
          .update({ tickets_bought: totalTicketsOwned })
          .eq('entry_id', existingEntries[0].entry_id);

        if (existingEntries.length > 1) {
          const extraIds = existingEntries.slice(1).map(e => e.entry_id);
          await supabase.from('raffle_entries').delete().in('entry_id', extraIds);
        }
      } else {
        await supabase.from('raffle_entries').insert({
          raffle_id: raffleId,
          discord_id: userId,
          tickets_bought: ticketsCount,
        });
      }

      return interaction.editReply({
        content: `🎟️ **Success!** You purchased **${ticketsCount}** ticket(s) for **${raffle.prize}** for **${totalCost}** Engage Points.\nRemaining Points: **${userPoints - totalCost}** 🪙. Good luck!`,
      });
    }

    // --- 4. RAFFLE DRAW (ADMIN ONLY) ---
    if (subcommand === 'draw') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: '⛔ You need `Manage Server` permissions to draw a raffle.',
          ephemeral: true,
        });
      }

      const raffleId = interaction.options.getString('raffle_id');
      await interaction.deferReply();

      const { data: raffle, error: raffleError } = await supabase
        .from('raffles')
        .select('*')
        .eq('raffle_id', raffleId)
        .eq('guild_id', guildId)
        .maybeSingle();

      if (raffleError || !raffle) {
        return interaction.editReply({ content: '❌ Raffle not found.' });
      }

      if (!raffle.is_active) {
        return interaction.editReply({ content: '⚠️ This raffle has already been drawn.' });
      }

      // Fetch all entries
      const { data: entries, error: entriesError } = await supabase
        .from('raffle_entries')
        .select('discord_id, tickets_bought')
        .eq('raffle_id', raffleId);

      if (entriesError) {
        console.error('[RAFFLE DRAW ERROR]:', entriesError);
        return interaction.editReply({ content: '❌ Failed to fetch raffle entries.' });
      }

      if (!entries || entries.length === 0) {
        await supabase.from('raffles').update({ is_active: false }).eq('raffle_id', raffleId);
        return interaction.editReply({
          content: `⚠️ No members entered the raffle for **${raffle.prize}**. The raffle has ended with no winner.`,
        });
      }

      // Aggregate tickets per member to prevent duplicate counts
      const userTicketMap = new Map();
      for (const entry of entries) {
        const current = userTicketMap.get(entry.discord_id) || 0;
        userTicketMap.set(entry.discord_id, current + (entry.tickets_bought || 0));
      }

      const pool = [];
      for (const [memberId, tickets] of userTicketMap.entries()) {
        for (let i = 0; i < tickets; i++) {
          pool.push(memberId);
        }
      }

      if (pool.length === 0) {
        await supabase.from('raffles').update({ is_active: false }).eq('raffle_id', raffleId);
        return interaction.editReply({
          content: `⚠️ No members entered the raffle for **${raffle.prize}**. The raffle has ended with no winner.`,
        });
      }

      // Pick random winner
      const winnerId = pool[Math.floor(Math.random() * pool.length)];

      // Mark raffle inactive and set winner
      await supabase
        .from('raffles')
        .update({ is_active: false, winner_id: winnerId })
        .eq('raffle_id', raffleId);

      // Automated payout detection if prize specifies QP/points or XP
      let prizePayoutText = '';
      const prizeLower = (raffle.prize || '').toLowerCase();
      const pointsMatch = prizeLower.match(/(\d+)\s*(?:qp|points?|quest\s*points?)/i);
      const xpMatch = prizeLower.match(/(\d+)\s*xp/i);

      const wonPoints = pointsMatch ? parseInt(pointsMatch[1], 10) : 0;
      const wonXp = xpMatch ? parseInt(xpMatch[1], 10) : 0;

      if (wonPoints > 0 || wonXp > 0) {
        const { data: winnerRec } = await supabase
          .from('users')
          .select('*')
          .eq('guild_id', guildId)
          .eq('discord_id', winnerId)
          .maybeSingle();

        const curPoints = Number(winnerRec?.total_points || 0);
        const curXp = Number(winnerRec?.xp || 0);
        const newPoints = curPoints + wonPoints;
        const newXp = curXp + wonXp;

        await supabase.from('users').upsert(
          {
            guild_id: guildId,
            discord_id: winnerId,
            total_points: newPoints,
            xp: newXp,
          },
          { onConflict: 'guild_id,discord_id' }
        );

        const payouts = [];
        if (wonPoints > 0) payouts.push(`+${wonPoints.toLocaleString()} QP`);
        if (wonXp > 0) payouts.push(`+${wonXp.toLocaleString()} XP`);
        prizePayoutText = `\n\n⚡ **Automated Payout:** ${payouts.join(' and ')} has been automatically credited to <@${winnerId}>!`;
      }

      const embed = new EmbedBuilder()
        .setColor(0xffd166)
        .setTitle('🎊 Raffle Winner Announced!')
        .setDescription(
          `The raffle for **${raffle.prize}** has officially ended!\n\n` +
          `👑 **Winner:** <@${winnerId}>\n` +
          `🎟️ **Total Tickets In Pool:** ${pool.length}` +
          prizePayoutText
        )
        .setFooter({ text: `Raffle ID: ${raffle.raffle_id}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
