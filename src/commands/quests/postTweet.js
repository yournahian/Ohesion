import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { parseTweetUrl, fetchTweetOEmbed } from '../../utils/twitter.js';

export default {
  data: new SlashCommandBuilder()
    .setName('post-tweet')
    .setDescription('Publish a tracked Twitter/X quest card with Like & Retweet verification buttons.')
    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('The URL of the Tweet / X post')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('points')
        .setDescription('Points awarded per verified action (default: 25)')
        .setRequired(false)
        .setMinValue(1)
    )
    .addIntegerOption(option =>
      option
        .setName('expire_hours')
        .setDescription('Hours until engagement quest expires (default: 24)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(168) // up to 7 days
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to broadcast the tweet quest (default: current channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role_mention')
        .setDescription('Role to ping (e.g. @Socials)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('custom_text')
        .setDescription('Custom description or snippet of the tweet')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Require Manage Messages or Manage Server
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages) &&
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      return interaction.reply({
        content: '⛔ You need `Manage Messages` or `Manage Server` permissions to post engagement quests.',
        ephemeral: true,
      });
    }

    const rawUrl = interaction.options.getString('url');
    const parsed = parseTweetUrl(rawUrl);

    if (!parsed) {
      return interaction.reply({
        content: '❌ Invalid Twitter/X URL. Please format like: `https://x.com/username/status/123456789...`',
        ephemeral: true,
      });
    }

    const { username, tweetId, cleanUrl } = parsed;
    const points = interaction.options.getInteger('points') || 25;
    const expireHours = interaction.options.getInteger('expire_hours') || 24;
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const roleMention = interaction.options.getRole('role_mention');
    const customText = interaction.options.getString('custom_text');

    await interaction.deferReply({ ephemeral: true });

    // Try fetching metadata via oEmbed
    const oembedData = await fetchTweetOEmbed(cleanUrl);
    const authorDisplayName = oembedData?.authorName || `@${username}`;
    const tweetBody = customText || oembedData?.text || 'Engage with this post on X to earn points!';

    // Calculate expiration timestamp
    const expiresAtDate = new Date(Date.now() + expireHours * 60 * 60 * 1000);
    const expireTimestampSec = Math.floor(expiresAtDate.getTime() / 1000);

    // 1. Construct Message Header (matching Engage.io layout)
    let messageHeader = `**${authorDisplayName}** just posted :\n${cleanUrl}\n\n` +
      `**Engage to collect your points**\n` +
      `Expires <t:${expireTimestampSec}:R>`;

    if (roleMention) {
      messageHeader += `\n\n<@&${roleMention.id}>`;
    }

    // 2. Build Twitter Card Embed
    const tweetEmbed = new EmbedBuilder()
      .setColor(0x1da1f2) // Twitter Sky Blue
      .setAuthor({
        name: `${authorDisplayName} (@${username})`,
        iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
        url: cleanUrl,
      })
      .setTitle(`@${username} tweeted !`)
      .setURL(cleanUrl)
      .setDescription(tweetBody)
      .setFooter({
        text: 'Powered by Engage.io Gamification',
        iconURL: interaction.client.user.displayAvatarURL(),
      })
      .setTimestamp();

    // 3. Construct Interactive Action Row with Buttons
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verify_like_${tweetId}`)
        .setLabel('Like')
        .setEmoji('❤️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`verify_rt_${tweetId}`)
        .setLabel('Retweet')
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`verify_comment_${tweetId}`)
        .setLabel('Comment')
        .setEmoji('💬')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setLabel('View on X')
        .setStyle(ButtonStyle.Link)
        .setURL(cleanUrl)
    );

    try {
      // 4. Send the message to the target broadcast channel
      const sentMessage = await targetChannel.send({
        content: messageHeader,
        embeds: [tweetEmbed],
        components: [actionRow],
      });

      // 5. Store Quest details in Supabase
      const { error: dbError } = await supabase.from('tweet_quests').upsert(
        {
          tweet_id: tweetId,
          guild_id: interaction.guildId,
          url: cleanUrl,
          content: tweetBody,
          author_name: authorDisplayName,
          author_username: username,
          points_per_action: points,
          expires_at: expiresAtDate.toISOString(),
          channel_id: targetChannel.id,
          message_id: sentMessage.id,
        },
        { onConflict: 'tweet_id' }
      );

      if (dbError) {
        console.error('[DB ERROR] Failed to record tweet quest:', dbError);
      }

      return interaction.editReply({
        content: `✅ Successfully broadcasted tweet engagement card to <#${targetChannel.id}>! (Tweet ID: \`${tweetId}\`)`,
      });
    } catch (err) {
      console.error('[POST TWEET ERROR]:', err);
      return interaction.editReply({
        content: `❌ Failed to send message to <#${targetChannel.id}>. Make sure the bot has permissions in that channel.`,
      });
    }
  },
};
