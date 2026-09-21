import {
  SlashCommandBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { buildPublicPortalPayload } from '../../utils/hubView.js';

export default {
  data: new SlashCommandBuilder()
    .setName('post-hub')
    .setDescription('Post the clean Community Ecosystem Portal with [View My Profile / Hub] button.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      return interaction.reply({
        content: '⛔ You need `Administrator` or `Manage Server` permissions to post the community portal.',
        ephemeral: true,
      });
    }

    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({
        content: '⚠️ This command can only be run inside a Discord server.',
        ephemeral: true,
      });
    }

    // Clean up previous bot messages in this channel to prevent duplicates
    try {
      const oldMessages = await interaction.channel.messages.fetch({ limit: 15 }).catch(() => null);
      if (oldMessages && oldMessages.size > 0) {
        const botMsgs = oldMessages.filter((m) => m.author.id === interaction.client.user?.id);
        for (const [, msg] of botMsgs) {
          await msg.delete().catch(() => null);
        }
      }
    } catch (_) {}

    const payload = buildPublicPortalPayload(guild);
    await interaction.channel.send(payload);

    return interaction.reply({
      content: '✅ **Community Hub Portal successfully posted!** Members can now click **[ 🔄 View My Profile / Hub ]** to open their private interactive card.',
      ephemeral: true,
    });
  },
};
