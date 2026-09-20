import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { logActivity } from '../../utils/activityLogger.js';

const INVITE_REWARD_INVITER = 75; // CP for inviter
const INVITE_REWARD_INVITEE = 25; // CP for newcomer entering code

export default {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Manage your referral code and claim points by inviting members to the server.')
    .addSubcommand((sub) =>
      sub
        .setName('mycode')
        .setDescription('View or generate your personal referral code and invite stats.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('enter')
        .setDescription('Enter a friend\'s referral code to claim bonus Cohesion Points.')
        .addStringOption((opt) =>
          opt
            .setName('code')
            .setDescription('The 6-character referral code')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const discordId = interaction.user.id;
    const guildId = interaction.guildId;

    await interaction.deferReply({ ephemeral: true });

    if (subcommand === 'mycode') {
      // 1. Check if user already has a referral code
      const { data: userRecord } = await supabase
        .from('users')
        .select('referral_code, invited_count')
        .eq('guild_id', guildId)
        .eq('discord_id', discordId)
        .maybeSingle();

      let code = userRecord?.referral_code;
      if (!code) {
        // Generate a random 6-character alphanumeric code
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
        await supabase.from('users').upsert(
          {
            guild_id: guildId,
            discord_id: discordId,
            referral_code: code,
          },
          { onConflict: 'guild_id,discord_id' }
        );
      }

      const count = Number(userRecord?.invited_count || 0);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('👥 Your Personal Referral Code')
        .setDescription(
          `Share your unique referral code with friends when they join **${interaction.guild?.name || 'this server'}**!\n\n` +
          `🎟️ **Your Referral Code:** \`${code}\`\n\n` +
          `• **How it works:** When a friend types \`/invite enter code:${code}\` or enters it in the Cohesion Hub, you both earn bonus points!\n` +
          `• **Inviter Reward:** **+${INVITE_REWARD_INVITER} CP** per confirmed friend\n` +
          `• **Friend Reward:** **+${INVITE_REWARD_INVITEE} CP** welcome bonus\n\n` +
          `📊 **Confirmed Referrals:** **${count} Member${count === 1 ? '' : 's'}**`
        )
        .setFooter({ text: 'Cohesion Viral Referral System • Anti-Alt Protected' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'enter') {
      const enteredCode = interaction.options.getString('code').trim().toUpperCase();

      // Find user who owns this code
      const { data: inviterRecord } = await supabase
        .from('users')
        .select('*')
        .eq('guild_id', guildId)
        .eq('referral_code', enteredCode)
        .maybeSingle();

      if (!inviterRecord) {
        return interaction.editReply({
          content: '❌ **Invalid Code**: That referral code does not exist in this server. Please check the spelling.',
        });
      }

      if (inviterRecord.discord_id === discordId) {
        return interaction.editReply({
          content: '⚠️ You cannot redeem your own referral code!',
        });
      }

      // Check if user already redeemed a referral
      const { data: currentUser } = await supabase
        .from('users')
        .select('referred_by, total_points')
        .eq('guild_id', guildId)
        .eq('discord_id', discordId)
        .maybeSingle();

      if (currentUser?.referred_by) {
        return interaction.editReply({
          content: `⚠️ You have already redeemed a referral code from <@${currentUser.referred_by}>! Only 1 referral code can be redeemed per account.`,
        });
      }

      // Award points to inviter
      const inviterPoints = Number(inviterRecord.total_points || 0) + INVITE_REWARD_INVITER;
      const inviterCount = Number(inviterRecord.invited_count || 0) + 1;
      await supabase.from('users').update({
        total_points: inviterPoints,
        invited_count: inviterCount,
      }).eq('guild_id', guildId).eq('discord_id', inviterRecord.discord_id);

      // Award points to invitee
      const currentPoints = Number(currentUser?.total_points || 0);
      const newPoints = currentPoints + INVITE_REWARD_INVITEE;
      await supabase.from('users').upsert(
        {
          guild_id: guildId,
          discord_id: discordId,
          total_points: newPoints,
          referred_by: inviterRecord.discord_id,
        },
        { onConflict: 'guild_id,discord_id' }
      );

      // Log receipt
      await logActivity(interaction.guild, {
        title: '👥 Referral Code Redeemed',
        description: `<@${discordId}> joined via <@${inviterRecord.discord_id}>'s code (\`${enteredCode}\`). Awarded **+${INVITE_REWARD_INVITER} CP** to inviter and **+${INVITE_REWARD_INVITEE} CP** to member.`,
        color: 0x06d6a0,
        userId: discordId,
      });

      const embed = new EmbedBuilder()
        .setColor(0x06d6a0)
        .setTitle('✅ Referral Code Redeemed Successfully!')
        .setDescription(
          `You redeemed referral code \`${enteredCode}\` from <@${inviterRecord.discord_id}>!\n\n` +
          `🪙 **Welcome Bonus:** **+${INVITE_REWARD_INVITEE} Cohesion Points (CP)** added to your balance!\n` +
          `💰 **Your Total Balance:** **${newPoints.toLocaleString()} CP**`
        )
        .setFooter({ text: 'Cohesion Referral Engine' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
