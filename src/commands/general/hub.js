import { SlashCommandBuilder } from 'discord.js';
import { buildHubPayload } from '../../utils/hubView.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hub')
    .setDescription('Open the visual Questify Community Hub to view stats, claim daily QP, and browse raffles.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const guild =
      interaction.guild ||
      (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);

    if (!guild) {
      return interaction.editReply({
        content:
          '⚠️ Questify is not added to this server as a bot. Please invite Questify to this server using this link:\nhttps://discord.com/oauth2/authorize?client_id=1550543145840934942&permissions=8&scope=bot%20applications.commands',
      });
    }

    const payload = await buildHubPayload(guild, interaction.user);
    return interaction.editReply(payload);
  },
};
