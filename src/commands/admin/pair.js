import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { verifyAndPair } from '../../utils/tgBridgeManager.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pair')
    .setDescription('Connect this Discord server with a Telegram group using a handshake code.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((opt) =>
      opt
        .setName('code')
        .setDescription('The 6-character pairing code (e.g. DC-12345 or TG-12345)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const code = interaction.options.getString('code');
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({ content: '❌ This command can only be used in a Discord server.', ephemeral: true });
    }

    const res = await verifyAndPair(code, guild.id, guild.name, interaction.user.id);
    if (!res.success) {
      return interaction.reply({ content: res.message, ephemeral: true });
    }

    return interaction.reply({
      content:
        `🎉 **Connection Successful!**\n\n` +
        `This Discord server is now actively linked to Telegram group **"${res.bridge.chatTitle}"**!\n\n` +
        `• **Operating Mode:** **${res.bridge.syncMode.toUpperCase()}**\n` +
        `• You can manage synchronization, broadcast announcements, or change modes from \`/admin\` ➔ **✈️ Telegram Settings**.`,
      ephemeral: true,
    });
  },
};
