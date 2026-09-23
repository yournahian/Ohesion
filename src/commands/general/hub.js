import { SlashCommandBuilder } from 'discord.js';
import { buildHubPayload } from '../../utils/hubView.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hub')
    .setDescription('Open the visual Cohesion Community Hub to view stats, claim daily CP, and browse raffles.'),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      if (err.code === 10062 || err.rawError?.code === 10062) {
        console.warn(`[HUB TIMEOUT 10062]: Interaction timed out (>3s). Discord token expired.`);
        return;
      }
      throw err;
    }

    const guildId = interaction.guildId;
    const guild =
      interaction.guild ||
      (guildId ? await interaction.client.guilds.fetch(guildId).catch(() => null) : null);

    if (!guild) {
      const botId = interaction.client.user?.id || '1550544108349554799';
      return interaction.editReply({
        content: `⚠️ Cohesion is not added to this server as a bot. Please invite Cohesion to this server using this link:\nhttps://discord.com/oauth2/authorize?client_id=${botId}&permissions=8&scope=bot%20applications.commands`,
      }).catch(() => null);
    }

    const payload = await buildHubPayload(guild, interaction.user, interaction.member);
    return interaction.editReply(payload).catch(() => null);
  },
};
