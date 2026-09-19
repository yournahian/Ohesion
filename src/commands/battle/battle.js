import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import {
  createBattleMatch,
  buildLobbyPayload,
  startBattleSimulation,
  getActiveMatch,
} from '../../modules/battle/battleEngine.js';

export default {
  data: new SlashCommandBuilder()
    .setName('battle')
    .setDescription('Launch a Chaos Clash Battle Royale simulation in this channel.')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Choose between Interactive (tactical builds & QTEs) or Classic (100% pure luck RNG giveaway)')
        .setRequired(false)
        .addChoices(
          { name: 'Interactive Mode (Engagement & Strategy)', value: 'interactive' },
          { name: 'Classic Mode (100% RNG Giveaway)', value: 'classic' }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName('signup_seconds')
        .setDescription('Sign-up window countdown duration in seconds (default: 45)')
        .setRequired(false)
        .setMinValue(15)
        .setMaxValue(300)
    )
    .addIntegerOption((option) =>
      option
        .setName('prize')
        .setDescription('Winner Quest Points reward pool (default: 500 QP)')
        .setRequired(false)
        .setMinValue(50)
    )
    .addIntegerOption((option) =>
      option
        .setName('entry_fee')
        .setDescription('Optional QP fee required to join the battle lobby (default: 0)')
        .setRequired(false)
        .setMinValue(0)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;

    const existingMatch = getActiveMatch(guildId);
    if (existingMatch && existingMatch.status !== 'finished') {
      return interaction.reply({
        content: `⚠️ An active Chaos Clash match (\`${existingMatch.matchId}\`) is already ongoing in this server! Wait for it to finish before starting another.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: false });

    const mode = interaction.options.getString('mode') || 'interactive';
    const signupDurationSec = interaction.options.getInteger('signup_seconds') || 45;
    const prizePool = interaction.options.getInteger('prize') || 500;
    const entryFee = interaction.options.getInteger('entry_fee') || 0;

    const match = createBattleMatch({
      guildId,
      channelId,
      createdBy: interaction.user.id,
      mode,
      signupDurationSec,
      entryFee,
      prizePool,
      prizeXp: Math.round(prizePool / 2),
    });

    const lobbyPayload = buildLobbyPayload(match);
    const lobbyMsg = await interaction.editReply(lobbyPayload);
    match.messageId = lobbyMsg.id;

    // Start countdown timer to automatically launch the battle simulation
    setTimeout(() => {
      startBattleSimulation(match, interaction.client);
    }, signupDurationSec * 1000);
  },
};
