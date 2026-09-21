import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { buildPublicPortalPayload } from '../../utils/hubView.js';
import { setLevelUpChannel } from '../../utils/guildSettings.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('One-click setup for Cohesion: creates category, hub, quest feed, levels, and activity logs.')
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

    const botId = interaction.client.user?.id || '1550544108349554799';

    if (!guild) {
      return interaction.editReply({
        content: `⚠️ Cohesion is not added to this server as a bot. Please invite Cohesion to this server with Administrator permissions.`,
      });
    }

    // Verify bot's own permissions in this server
    const botMember = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    const hasManageChannels = botMember?.permissions?.has(PermissionFlagsBits.ManageChannels);
    const hasAdmin = botMember?.permissions?.has(PermissionFlagsBits.Administrator);

    if (!hasAdmin && !hasManageChannels) {
      return interaction.editReply({
        content:
          `⚠️ **Cohesion lacks permission to create channels in this server!**\n\n` +
          `**How to fix:**\n` +
          `1. Go to **Server Settings** ⚙️ > **Roles**\n` +
          `2. Click on the **Cohesion** role\n` +
          `3. Go to the **Permissions** tab and turn ON **Manage Channels** (or **Administrator**)\n` +
          `4. Click **Save Changes** and run \`/setup\` again!`,
      });
    }

    try {
      // 1. Check or create "COHESION ECOSYSTEM" category
      let category = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && (c.name.toLowerCase().includes('cohesion') || c.name.toLowerCase() === 'questify')
      );

      if (!category) {
        category = await guild.channels.create({
          name: '🌀 COHESION ECOSYSTEM',
          type: ChannelType.GuildCategory,
        });
      }

      // 2. Check or create #cohesion-hub channel
      let hubChannel = guild.channels.cache.find(
        (c) => (c.name === 'cohesion-hub' || c.name === 'questify-hub') && c.parentId === category.id
      );

      if (!hubChannel) {
        hubChannel = await guild.channels.create({
          name: 'cohesion-hub',
          type: ChannelType.GuildText,
          parent: category.id,
          topic: 'Click button below to open your personal dashboard, claim daily rewards, and enter raffles.',
        });
      }

      // Send the clean public Community Portal interface with single [View My Profile / Hub] button
      const hubPayload = buildPublicPortalPayload(guild);
      await hubChannel.send(hubPayload);

      // 3. Check or create #cohesion-feed channel
      let questChannel = guild.channels.cache.find(
        (c) => (c.name === 'cohesion-feed' || c.name === 'quest-feed') && c.parentId === category.id
      );

      if (!questChannel) {
        questChannel = await guild.channels.create({
          name: 'cohesion-feed',
          type: ChannelType.GuildText,
          parent: category.id,
          topic: 'Live Twitter/X, CoinMarketCap, and video quests powered by Cohesion.',
        });
      }

      // 4. Check or create #cohesion-levels channel
      let levelChannel = guild.channels.cache.find(
        (c) => (c.name === 'cohesion-levels' || c.name === 'level-up' || c.name === 'levels') && c.parentId === category.id
      );

      if (!levelChannel) {
        levelChannel = await guild.channels.create({
          name: 'cohesion-levels',
          type: ChannelType.GuildText,
          parent: category.id,
          topic: 'Official Level-Up celebrations, tier role unlocks, and XP rank achievements.',
        });

        const welcomeEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🎉 Cohesion Level-Up & Achievements Feed')
          .setDescription(
            'Welcome to the dedicated Level-Up feed!\n\n' +
            'Chat actively in community channels to earn XP, reach new levels, and unlock exclusive role tiers.\n' +
            'All level achievements and reward drops will be celebrated right here!'
          )
          .setFooter({ text: 'Cohesion Gamification System' });

        await levelChannel.send({ embeds: [welcomeEmbed] }).catch(() => null);
      }

      // Automatically configure this channel as the designated Level-Up channel!
      setLevelUpChannel(guild.id, levelChannel.id);

      // 5. Check or create #cohesion-logs channel
      let logChannel = guild.channels.cache.find(
        (c) => (c.name === 'cohesion-logs' || c.name === 'activity-logs' || c.name === 'engage-logs') && c.parentId === category.id
      );

      if (!logChannel) {
        logChannel = await guild.channels.create({
          name: 'cohesion-logs',
          type: ChannelType.GuildText,
          parent: category.id,
          topic: 'Activity audit logs for quest claims, raffle winners, and marketplace purchases.',
        });
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
        .setTitle('✅ Cohesion Setup Complete!')
        .setDescription(
          `Your server is now fully configured for Cohesion community gamification!\n\n` +
          `📁 **Category:** \`🌀 COHESION ECOSYSTEM\`\n` +
          `⚡ **Community Hub:** <#${hubChannel.id}>\n` +
          `📢 **Quest Feed:** <#${questChannel.id}>\n` +
          `🎉 **Level-Up Feed:** <#${levelChannel.id}>\n` +
          `📜 **Activity Logs:** <#${logChannel.id}>\n\n` +
          `**What to do next:**\n` +
          `• All Level-Up cards will now automatically arrive in <#${levelChannel.id}>!\n` +
          `• Run \`/admin\` to customize settings, quests, and economy.\n` +
          `• Members can use the 1-click buttons in <#${hubChannel.id}> or run \`/hub\`!`
        )
        .setFooter({ text: 'Cohesion Automated Setup' });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[SETUP ERROR]:', err);
      return interaction.editReply({
        content: `❌ Setup failed: ${err.message}. Make sure Cohesion has Administrator permissions to create channels.`,
      });
    }
  },
};
