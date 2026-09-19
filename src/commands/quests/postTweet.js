import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { parseTweetUrl, fetchTweetMetadata } from '../../utils/twitter.js';

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
    .addStringOption(option =>
      option
        .setName('duration')
        .setDescription('Duration of quest: e.g. "30m", "45m", "2h", "24h", "3d" (default: 24h)')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName('expire_hours')
        .setDescription('Hours until engagement quest expires (alternative: use duration)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(168)
    )
    .addStringOption(option =>
      option
        .setName('buttons')
        .setDescription('Buttons to include: e.g. "like, rt, comment", or "like, rt", or "none"')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('show_image')
        .setDescription('Show tweet media thumbnail & image display? (default: true)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('tag')
        .setDescription('Server role or member tag to ping (e.g. @Socials, @everyone, or role name)')
        .setRequired(false)
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
        .setDescription('Role to ping (alternative to tag)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('custom_text')
        .setDescription('Custom description / requirements list for the post')
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
    const rawDuration = interaction.options.getString('duration');
    const expireHours = interaction.options.getInteger('expire_hours') || 24;
    const buttonsOption = interaction.options.getString('buttons') || 'all';
    const showImage = interaction.options.getBoolean('show_image') ?? true;
    const rawTag = interaction.options.getString('tag');
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const roleMention = interaction.options.getRole('role_mention');
    const customText = interaction.options.getString('custom_text');

    await interaction.deferReply({ ephemeral: true });

    // Fetch tweet metadata with media thumbnail & author avatar
    const tweetMeta = await fetchTweetMetadata(cleanUrl, username, tweetId);
    const authorDisplayName = tweetMeta?.authorName || `@${username}`;
    const tweetBody = tweetMeta?.text || 'Engage with this post on X to earn points!';

    // Calculate expiration timestamp (supporting minutes like 30m, 45m, 1h, 24h, 3d)
    let durationMs = 24 * 60 * 60 * 1000;
    if (rawDuration) {
      const match = rawDuration.trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
      if (match) {
        const val = parseInt(match[1], 10);
        if (match[2] === 'm') durationMs = val * 60 * 1000;
        else if (match[2] === 'h') durationMs = val * 60 * 60 * 1000;
        else if (match[2] === 'd') durationMs = val * 24 * 60 * 60 * 1000;
      } else {
        const num = parseInt(rawDuration, 10);
        if (!isNaN(num) && num > 0) durationMs = num * 60 * 60 * 1000;
      }
    } else {
      durationMs = expireHours * 60 * 60 * 1000;
    }

    const expiresAtDate = new Date(Date.now() + durationMs);
    const expireTimestampSec = Math.floor(expiresAtDate.getTime() / 1000);

    // Resolve tag mention (e.g. @Socials, @everyone, @here, or role ID / name)
    let tagMention = '';
    if (roleMention) {
      tagMention = `<@&${roleMention.id}>`;
    } else if (rawTag && rawTag.trim()) {
      const t = rawTag.trim();
      if (t === '@everyone' || t === '@here') {
        tagMention = t;
      } else if (/^<@&?\d+>$/.test(t)) {
        tagMention = t;
      } else if (/^\d{17,20}$/.test(t)) {
        tagMention = `<@&${t}>`;
      } else {
        const cleanName = t.replace(/^@/, '').toLowerCase();
        const role = interaction.guild?.roles?.cache?.find(
          (r) => r.name.toLowerCase() === cleanName
        );
        if (role) {
          tagMention = `<@&${role.id}>`;
        } else {
          tagMention = t.startsWith('@') ? t : `@${t}`;
        }
      }
    }

    // Format custom snippet with bullet points
    let formattedSnippet = '';
    if (customText && customText.trim()) {
      formattedSnippet = customText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => (/^[•\-\*]\s+/.test(line) ? line : `• ${line}`))
        .join('\n');
    }

    // 3. Construct Interactive Action Row with Filtered Buttons
    const btnFilter = buttonsOption.toLowerCase().trim();
    const isNone =
      btnFilter === 'none' ||
      btnFilter === 'no' ||
      btnFilter === 'off' ||
      btnFilter === '0' ||
      btnFilter === 'false' ||
      btnFilter === 'remove' ||
      btnFilter === 'remove all' ||
      btnFilter === 'hide';

    const isAll =
      !isNone &&
      (btnFilter === 'all' ||
        btnFilter === '' ||
        (!btnFilter.includes('like') &&
          !btnFilter.includes('rt') &&
          !btnFilter.includes('retweet') &&
          !btnFilter.includes('repost') &&
          !btnFilter.includes('comment') &&
          !btnFilter.includes('reply')));

    const includeLike = !isNone && (isAll || btnFilter.includes('like'));
    const includeRt =
      !isNone &&
      (isAll || btnFilter.includes('rt') || btnFilter.includes('retweet') || btnFilter.includes('repost'));
    const includeComment = !isNone && (isAll || btnFilter.includes('comment') || btnFilter.includes('reply'));

    const actionRow = new ActionRowBuilder();

    if (includeLike) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`verify_like_${tweetId}`)
          .setLabel('Like')
          .setEmoji('❤️')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (includeRt) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`verify_rt_${tweetId}`)
          .setLabel('Retweet')
          .setEmoji('🔁')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (includeComment) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`verify_comment_${tweetId}`)
          .setLabel('Comment')
          .setEmoji('💬')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (btnFilter !== 'hide all' && btnFilter !== 'no buttons') {
      actionRow.addComponents(
        new ButtonBuilder()
          .setLabel('View on X')
          .setStyle(ButtonStyle.Link)
          .setURL(cleanUrl)
      );
    }

    const hasAnyAction = includeLike || includeRt || includeComment;

    // Construct Message Content
    let messageContent = hasAnyAction
      ? `**${authorDisplayName}** just posted :\n${cleanUrl}\n\n` +
        `**Engage to collect your points**\n` +
        `Expires <t:${expireTimestampSec}:R>`
      : `**${authorDisplayName}** just posted :\n${cleanUrl}`;

    if (formattedSnippet) {
      messageContent += `\n\n${formattedSnippet}`;
    }

    if (tagMention) {
      messageContent += `\n${tagMention}`;
    }

    // Build optional Twitter Card Embed
    const embeds = [];
    if (showImage) {
      const tweetEmbed = new EmbedBuilder()
        .setColor(0x1da1f2) // Twitter Sky Blue
        .setAuthor({
          name: `${authorDisplayName} (@${username})`,
          iconURL: tweetMeta?.authorAvatar || 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
          url: cleanUrl,
        })
        .setTitle(`@${username} tweeted !`)
        .setURL(cleanUrl)
        .setDescription(tweetBody)
        .setFooter({
          text: 'Powered by Questify Gamification',
          iconURL: interaction.client.user.displayAvatarURL(),
        })
        .setTimestamp();

      if (tweetMeta?.mediaUrl) {
        tweetEmbed.setImage(tweetMeta.mediaUrl);
      } else if (tweetMeta?.authorAvatar) {
        tweetEmbed.setThumbnail(tweetMeta.authorAvatar);
      }

      embeds.push(tweetEmbed);
    }

    const components = actionRow.components.length > 0 ? [actionRow] : [];

    try {
      // 4. Send the message to the target broadcast channel
      const sentMessage = await targetChannel.send({
        content: messageContent,
        embeds,
        components,
        flags: showImage ? undefined : MessageFlags.SuppressEmbeds,
        allowedMentions: { parse: ['roles', 'users', 'everyone'] },
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
