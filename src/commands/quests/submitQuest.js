import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { supabase } from '../../lib/supabase.js';

const QUEST_POINTS_REWARD = 25;

export default {
  data: new SlashCommandBuilder()
    .setName('submit-quest')
    .setDescription('Submit a Twitter/X engagement link to earn points.')
    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('The URL of your post, like, or retweet (e.g. https://x.com/...)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const url = interaction.options.getString('url').trim();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // Validate URL
    const isValidUrl = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+$/i.test(url);
    if (!isValidUrl) {
      return interaction.reply({
        content: '❌ Invalid link! Please provide a valid Twitter/X URL (e.g. `https://x.com/username/status/...`).',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // 1. Record the quest submission
      const { data: submission, error: submissionError } = await supabase
        .from('quest_submissions')
        .insert({
          guild_id: guildId,
          discord_id: userId,
          url,
          status: 'pending',
          points_awarded: QUEST_POINTS_REWARD,
        })
        .select()
        .single();

      if (submissionError) {
        console.error('[SUBMIT QUEST ERROR]:', submissionError);
        return interaction.editReply({ content: '❌ Failed to submit quest. Please try again later.' });
      }

      // 2. Fetch or create user record to award points
      const { data: userRecord } = await supabase
        .from('users')
        .select('total_points')
        .eq('guild_id', guildId)
        .eq('discord_id', userId)
        .maybeSingle();

      const currentPoints = Number(userRecord?.total_points || 0);
      const updatedPoints = currentPoints + QUEST_POINTS_REWARD;

      await supabase
        .from('users')
        .upsert(
          {
            guild_id: guildId,
            discord_id: userId,
            total_points: updatedPoints,
          },
          { onConflict: 'guild_id,discord_id' }
        );

      const embed = new EmbedBuilder()
        .setColor(0x06d6a0)
        .setTitle('✅ Quest Submitted Successfully!')
        .setDescription(
          `Your post has been submitted for verification:\n🔗 **[View Submission](${url})**\n\n` +
          `🪙 **+${QUEST_POINTS_REWARD} Cohesion Points (CP)** have been credited to your account (pending admin review).\n` +
          `Total Balance: **${updatedPoints.toLocaleString()} CP**`
        )
        .setFooter({ text: `Submission ID: ${submission.submission_id} • Cohesion Quests` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[QUEST ERROR]:', err);
      return interaction.editReply({ content: '❌ An error occurred while processing your quest.' });
    }
  },
};
