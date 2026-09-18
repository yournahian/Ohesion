import { SlashCommandBuilder } from 'discord.js';
import { buildHubPayload } from '../../utils/hubView.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hub')
    .setDescription('Open the visual Questify Community Hub to view stats, claim daily QP, and browse raffles.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const payload = await buildHubPayload(interaction.guild, interaction.user);
    return interaction.editReply(payload);
  },
};
