import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import {
  createBattleMatch,
  buildLobbyPayload,
  startBattleSimulation,
  scheduleCountdowns,
  getActiveMatch,
  parseBattleDuration,
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
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('Sign-up window countdown duration: e.g. 45s, 5m, 30m, 1h, 1d (default: 5m)')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('prize')
        .setDescription('Winner Cohesion Points (CP) reward pool (default: 500 CP)')
        .setRequired(false)
        .setMinValue(50)
    )
    .addIntegerOption((option) =>
      option
        .setName('entry_fee')
        .setDescription('Optional CP fee required to join the battle lobby (default: 0)')
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
    const durationInput = interaction.options.getString('duration') || '5m';
    const signupDurationSec = parseBattleDuration(durationInput);
    const prizePool = interaction.options.getInteger('prize') || 500;
    const entryFee = interaction.options.getInteger('entry_fee') || 0;

    const match = createBattleMatch({
      guildId,
      channelId,
      createdBy: interaction.user.id,
      hostName: interaction.user.displayName || interaction.user.username,
      mode,
      signupDurationSec,
      entryFee,
      prizePool,
      prizeXp: Math.round(prizePool / 2),
    });

    const lobbyPayload = buildLobbyPayload(match);
    const lobbyMsg = await interaction.editReply(lobbyPayload);
    match.messageId = lobbyMsg.id;

    // Schedule countdown alerts (60s, 30s, 15s)
    scheduleCountdowns(match, interaction.client);

    // Start countdown timer to automatically launch the battle simulation
    setTimeout(() => {
      startBattleSimulation(match, interaction.client);
    }, signupDurationSec * 1000);
  },
};
