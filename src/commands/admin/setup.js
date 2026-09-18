import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { buildHubPayload } from '../../utils/hubView.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('One-click setup for Questify: creates the category, #quest-feed, and a live #questify-hub.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      return interaction.reply({
        content: '⛔ You need `Administrator` or `Manage Server` permissions to run the setup wizard.',
        ephemeral: true,
      });
    }

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

    try {
      // 1. Check or create "QUESTIFY" category
      let category = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'questify'
      );

      if (!category) {
        category = await guild.channels.create({
          name: 'QUESTIFY',
          type: ChannelType.GuildCategory,
        });
      }

      // 2. Check or create #quest-feed channel
      let questChannel = guild.channels.cache.find(
        c => c.name === 'quest-feed' && c.parentId === category.id
      );

      if (!questChannel) {
        questChannel = await guild.channels.create({
          name: 'quest-feed',
          type: ChannelType.GuildText,
          parent: category.id,
          topic: 'Live Twitter / X engagement quests and announcements powered by Questify.',
        });
      }

      // 3. Check or create #questify-hub channel
      let hubChannel = guild.channels.cache.find(
        c => c.name === 'questify-hub' && c.parentId === category.id
      );

      if (!hubChannel) {
        hubChannel = await guild.channels.create({
          name: 'questify-hub',
          type: ChannelType.GuildText,
          parent: category.id,
          topic: 'Click buttons below to view stats, claim daily rewards, and enter raffles.',
        });

        // Send a persistent, clickable Hub interface right in the channel!
        const hubPayload = await buildHubPayload(guild, interaction.user);
        await hubChannel.send(hubPayload);
      }

      // Update guild record in Supabase
      await supabase.from('guilds').upsert(
        {
          guild_id: guild.id,
          name: guild.name,
        },
        { onConflict: 'guild_id' }
      );

      const embed = new EmbedBuilder()
        .setColor(0x06d6a0)
        .setTitle('✅ Questify Setup Complete!')
        .setDescription(
          `Your server is now fully configured for Questify engagement!\n\n` +
          `📁 **Category:** \`QUESTIFY\`\n` +
          `📢 **Quests Channel:** <#${questChannel.id}>\n` +
          `⚡ **Community Hub Channel:** <#${hubChannel.id}>\n\n` +
          `**What to do next:**\n` +
          `• Run \`/admin\` to create your first tweet quest or raffle.\n` +
          `• Members can use the buttons in <#${hubChannel.id}> or type \`/hub\` anytime!`
        )
        .setFooter({ text: 'Questify Automated Setup' });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[SETUP ERROR]:', err);
      return interaction.editReply({
        content: `❌ Setup failed: ${err.message}. Make sure Questify has Administrator permissions to create channels.`,
      });
    }
  },
};
