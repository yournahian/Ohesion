import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';

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
    .setDescription('Create, enter, and view community raffles with multi-chain & role rewards.')
    // Subcommand: create (Admin only)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Create a new raffle (Admin only)')
        .addStringOption((option) =>
          option.setName('prize').setDescription('The prize or reward being raffled').setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('cost')
            .setDescription('Ticket cost in Cohesion Points (0 for free entry)')
            .setRequired(true)
            .setMinValue(0)
        )
        .addStringOption((option) =>
          option
            .setName('duration')
            .setDescription('Duration of the raffle (e.g. 30m, 2h, 1d)')
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('winners')
            .setDescription('Number of winners (1 to 999, default: 1)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(999)
        )
        .addStringOption((option) =>
          option
            .setName('chain')
            .setDescription('Chain of reward: ETH, SOL, BTC, SUI, AVAX, BSC, SEI, ADA, RONIN, or No Chain')
            .setRequired(false)
            .addChoices(
              { name: 'Ethereum (ETH)', value: 'ETH' },
              { name: 'Solana (SOL)', value: 'SOL' },
              { name: 'Bitcoin (BTC)', value: 'BTC' },
              { name: 'Sui (SUI)', value: 'SUI' },
              { name: 'Avalanche (AVAX)', value: 'AVAX' },
              { name: 'BNB Chain (BSC)', value: 'BSC' },
              { name: 'Sei (SEI)', value: 'SEI' },
              { name: 'Cardano (ADA)', value: 'ADA' },
              { name: 'Ronin (RONIN)', value: 'RONIN' },
              { name: 'No Chain', value: 'None' }
            )
        )
        .addRoleOption((option) =>
          option
            .setName('role_gate')
            .setDescription('Only members with this role can enter')
            .setRequired(false)
        )
        .addRoleOption((option) =>
          option
            .setName('role_reward')
            .setDescription('Award this role to all winners')
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option
            .setName('limited_entry')
            .setDescription('Limit to 1 ticket per user? (default: false)')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option.setName('image').setDescription('Custom banner image URL for the raffle embed').setRequired(false)
        )
        .addStringOption((option) =>
          option.setName('twitter').setDescription('Official project Twitter link').setRequired(false)
        )
        .addStringOption((option) =>
          option.setName('note').setDescription('Custom note appended to the raffle embed').setRequired(false)
        )
    )
    // Subcommand: list
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('List all active raffles in this server')
    )
    // Subcommand: enter
    .addSubcommand((subcommand) =>
      subcommand
        .setName('enter')
        .setDescription('Enter an active raffle by purchasing tickets with Cohesion Points')
        .addStringOption((option) =>
          option.setName('raffle_id').setDescription('The UUID of the raffle').setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('tickets')
            .setDescription('Number of tickets to purchase (default: 1)')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    // Subcommand: draw (Admin only)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('draw')
        .setDescription('End a raffle and pick random winner(s) (Admin only)')
        .addStringOption((option) =>
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

      const winnersCount = interaction.options.getInteger('winners') || 1;
      const chain = interaction.options.getString('chain') || 'None';
      const roleGate = interaction.options.getRole('role_gate');
      const roleReward = interaction.options.getRole('role_reward');
      const limitedEntry = interaction.options.getBoolean('limited_entry') || false;
      const imageUrl = interaction.options.getString('image');
      const twitterLink = interaction.options.getString('twitter');
      const customNote = interaction.options.getString('note');

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
        .setTitle(`🎟️ New Giveaway • ${prize}`)
        .setDescription(
          `**Prize:** ${prize}\n` +
          `**Ticket Cost:** ${cost === 0 ? '🆓 Free Entry' : `${cost} 🪙 Cohesion Points (CP)`}\n` +
          `**Winners:** 🏆 **${winnersCount} Winner${winnersCount > 1 ? 's' : ''}**\n` +
          `**Chain:** \`${chain}\`\n` +
          `**Ends:** <t:${Math.floor(new Date(endTime).getTime() / 1000)}:R>`
        )
        .addFields({
          name: 'How to Enter',
          value: `Click **Active Raffles** in <#${interaction.channelId}> or run \`/raffle enter raffle_id:${raffle.raffle_id}\``,
        })
        .setFooter({ text: `Raffle ID: ${raffle.raffle_id} • Cohesion Rewards` })
        .setTimestamp();

      if (roleGate) {
        embed.addFields({ name: '🔒 Role Gate', value: `<@&${roleGate.id}> required to enter.` });
      }
      if (roleReward) {
        embed.addFields({ name: '🎖️ Winner Role', value: `<@&${roleReward.id}> will be awarded to winners.` });
      }
      if (limitedEntry) {
        embed.addFields({ name: '⚡ Restriction', value: 'Limited to **1 ticket per member**.' });
      }
      if (twitterLink) {
        embed.addFields({ name: '🔗 Project Twitter', value: `[Follow on X](${twitterLink})` });
      }
      if (customNote) {
        embed.addFields({ name: '📌 Note', value: customNote });
      }
      if (imageUrl) {
        embed.setImage(imageUrl);
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // --- 2. RAFFLE LIST ---
    if (subcommand === 'list') {
      await interaction.deferReply();
      const now = new Date();

      const { data: rawRaffles, error } = await supabase
        .from('raffles')
        .select('*')
        .eq('guild_id', guildId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) {
        return interaction.editReply({ content: '❌ Failed to fetch raffles.' });
      }

      const raffles = (rawRaffles || []).filter((r) => new Date(r.end_time) > now);

      if (!raffles || raffles.length === 0) {
        return interaction.editReply({ content: '🎁 There are no active raffles right now. Stay tuned!' });
      }

      const embed = new EmbedBuilder()
        .setColor(0x06d6a0)
        .setTitle('🎉 Active Community Raffles')
        .setDescription(
          raffles
            .map(
              (r) =>
                `• **Prize**: **${r.prize}**\n` +
                `  **Cost**: ${r.cost} CP | **Ends**: <t:${Math.floor(new Date(r.end_time).getTime() / 1000)}:R>\n` +
                `  **ID**: \`${r.raffle_id}\`\n`
            )
            .join('\n')
        )
        .setFooter({ text: 'Use the Hub Raffles button to enter with 1 click!' });

      return interaction.editReply({ embeds: [embed] });
    }

    // --- 3. RAFFLE ENTER ---
    if (subcommand === 'enter') {
      const raffleId = interaction.options.getString('raffle_id');
      const ticketsCount = interaction.options.getInteger('tickets') || 1;

      await interaction.deferReply({ ephemeral: true });

      const { data: raffle, error: raffleError } = await supabase
        .from('raffles')
        .select('*')
        .eq('raffle_id', raffleId)
        .maybeSingle();

      if (raffleError || !raffle) {
        return interaction.editReply({ content: '❌ Raffle not found or invalid ID.' });
      }

      if (!raffle.is_active || new Date(raffle.end_time) < new Date()) {
        return interaction.editReply({ content: '❌ This raffle has already ended.' });
      }

      const totalCost = Number(raffle.cost) * ticketsCount;

      const { data: userRec } = await supabase
        .from('users')
        .select('total_points')
        .eq('guild_id', guildId)
        .eq('discord_id', userId)
        .maybeSingle();

      const userPoints = Number(userRec?.total_points || 0);

      if (userPoints < totalCost) {
        return interaction.editReply({
          content: `❌ Insufficient Cohesion Points! You need **${totalCost} CP** for **${ticketsCount}** ticket(s), but you have **${userPoints} CP**.`,
        });
      }

      // Deduct points
      if (totalCost > 0) {
        await supabase
          .from('users')
          .update({ total_points: userPoints - totalCost })
          .eq('guild_id', guildId)
          .eq('discord_id', userId);
      }

      // Insert entries
      const entries = Array.from({ length: ticketsCount }, () => ({
        raffle_id: raffleId,
        discord_id: userId,
      }));

      await supabase.from('raffle_entries').insert(entries);

      return interaction.editReply({
        content: `🎟️ **Success!** You purchased **${ticketsCount}** ticket(s) for **${raffle.prize}** for **${totalCost}** Cohesion Points (CP).\nRemaining Balance: **${userPoints - totalCost}** 🪙. Good luck!`,
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

      const { data: entries, error } = await supabase
        .from('raffle_entries')
        .select('discord_id')
        .eq('raffle_id', raffleId);

      if (error || !entries || entries.length === 0) {
        return interaction.editReply({ content: '❌ No tickets were purchased for this raffle.' });
      }

      // Pick winner
      const randomWinner = entries[Math.floor(Math.random() * entries.length)].discord_id;

      await supabase
        .from('raffles')
        .update({ is_active: false })
        .eq('raffle_id', raffleId);

      const embed = new EmbedBuilder()
        .setColor(0xffd166)
        .setTitle('🎉 Raffle Winner Selected!')
        .setDescription(`Congratulations <@${randomWinner}>! You won the raffle! 🏆`)
        .setFooter({ text: 'Cohesion Provable Winner Draw' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
