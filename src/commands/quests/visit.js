import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';

export default {
  data: new SlashCommandBuilder()
    .setName('visit')
    .setDescription('Publish a timed website visit quest where members must visit an external link to earn points.')
    .addStringOption((opt) =>
      opt.setName('url').setDescription('The destination website URL (https://...)').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Title or project name of the destination website').setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt.setName('points').setDescription('Cohesion Points (CP) awarded for visiting (default: 35)').setRequired(false).setMinValue(5)
    )
    .addIntegerOption((opt) =>
      opt.setName('seconds').setDescription('Seconds member must stay on site before claim unlocks (default: 10s)').setRequired(false).setMinValue(5).setMaxValue(300)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const rawUrl = interaction.options.getString('url').trim();
    const title = interaction.options.getString('title')?.trim() || 'Partner Website';
    const points = interaction.options.getInteger('points') || 35;
    const requiredSeconds = interaction.options.getInteger('seconds') || 10;
    const guildId = interaction.guildId;

    if (!/^https?:\/\/.+/i.test(rawUrl)) {
      return interaction.reply({
        content: '❌ Invalid URL! Please provide a valid web link starting with `http://` or `https://`.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const questId = 'visit_' + Date.now().toString(36);

    const embed = new EmbedBuilder()
      .setColor(0x06d6a0)
      .setTitle(`🌐 Website Visit Quest: ${title}`)
      .setDescription(
        `Visit our official site / partner page to explore our latest updates and earn **+${points} Cohesion Points (CP)**!\n\n` +
        `🔗 **Destination Link:** [Click here to visit ${title}](${rawUrl})\n` +
        `⏱️ **Requirement:** Browse the website for at least **${requiredSeconds} seconds** before clicking Claim below.\n\n` +
        `*Click **Visit Website ↗️** first, then click **Claim Reward ✅**!*`
      )
      .setFooter({ text: `Visit Quest ID: ${questId} • Anti-Cheat Timed Engine` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(`Visit Website ↗️`)
        .setStyle(ButtonStyle.Link)
        .setURL(rawUrl),
      new ButtonBuilder()
        .setCustomId(`claim_visit_${questId}_${points}_${requiredSeconds}`)
        .setLabel(`Claim Reward ✅ (+${points} CP)`)
        .setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });

    return interaction.editReply({
      content: `✅ Successfully published timed website visit quest for **${title}** with **+${points} CP** reward!`,
    });
  },
};
