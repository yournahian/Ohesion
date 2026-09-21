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
import { getGuildDrafts } from '../../utils/questDrafts.js';

export default {
  data: new SlashCommandBuilder()
    .setName('post-tweet')
    .setDescription('Publish a tracked Twitter/X quest card with Like, Retweet & Reply verification.')
    .addStringOption((option) =>
      option
        .setName('url')
        .setDescription('The URL of the Tweet / X post')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('draft')
        .setDescription('Load pre-configured quest preset (e.g. standard_raid, high_priority, verified_only)')
        .setRequired(false)
        .addChoices(
          { name: 'Standard Raid (50 CP, 24h)', value: 'standard_raid' },
          { name: 'High Priority (100 CP, 6h, 2x Lead)', value: 'high_priority' },
          { name: 'Verified Only (150 CP, 12h, Twitter Blue)', value: 'verified_only' }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName('points')
        .setDescription('Cohesion Points (CP) awarded per verified action (default: 25)')
        .setRequired(false)
        .setMinValue(1)
    )
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('Duration of quest: e.g. "30m", "45m", "2h", "24h", "3d" (default: 24h)')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('buttons')
        .setDescription('Buttons to include: e.g. "like, rt, comment", or "like, rt", or "none"')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('lead_bonus')
        .setDescription('Lead Engagers bonus: Extra CP awarded within first 15 minutes of posting')
        .setRequired(false)
        .setMinValue(1)
    )
    .addBooleanOption((option) =>
      option
        .setName('verified_only')
        .setDescription('Only Twitter Blue / X Premium verified accounts can claim points? (default: false)')
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName('require_follow')
        .setDescription('Require members to follow the tweet author to claim? (default: false)')
        .setRequired(false)
    )
    .addRoleOption((option) =>
      option
        .setName('role_gate')
        .setDescription('Only members with this Discord role can participate in the quest')
        .setRequired(false)
    )
    .addRoleOption((option) =>
      option
        .setName('assign_role')
        .setDescription('Automatically award this role to members who engage with this tweet')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('min_chars')
        .setDescription('Minimum character length required for comments/replies')
        .setRequired(false)
        .setMinValue(1)
    )
    .addStringOption((option) =>
      option
        .setName('keyword')
        .setDescription('Require a specific keyword/hashtag in reply (e.g. #Cohesion)')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('total_bundle')
        .setDescription('Extra bonus point bundle for completing all required actions')
        .setRequired(false)
        .setMinValue(1)
    )
    .addBooleanOption((option) =>
      option
        .setName('show_image')
        .setDescription('Show tweet media thumbnail & image display? (default: true)')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('tag')
        .setDescription('Server role or member tag to ping (e.g. @Socials, @everyone)')
        .setRequired(false)
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to broadcast the tweet quest (default: current channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('custom_text')
        .setDescription('Custom description / requirements list for the post')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages) &&
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      return interaction.reply({
        content: '⛔ You need `Manage Messages` or `Manage Server` permissions to post quests.',
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

    const draftName = interaction.options.getString('draft');
    const drafts = getGuildDrafts(interaction.guildId);
    const draftConfig = draftName ? drafts.find((d) => d.name === draftName) : null;

    const points = interaction.options.getInteger('points') || draftConfig?.points || 25;
    const rawDuration = interaction.options.getString('duration') || draftConfig?.duration;
    const buttonsOption = interaction.options.getString('buttons') || draftConfig?.buttons || 'all';
    const showImage = interaction.options.getBoolean('show_image') ?? true;
    const rawTag = interaction.options.getString('tag');
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const customText = interaction.options.getString('custom_text');

    const leadBonus = interaction.options.getInteger('lead_bonus') || draftConfig?.leadEngagersBonus || 0;
    const verifiedOnly = interaction.options.getBoolean('verified_only') ?? draftConfig?.verifiedOnly ?? false;
    const requireFollow = interaction.options.getBoolean('require_follow') ?? draftConfig?.requireFollow ?? false;
    const roleGate = interaction.options.getRole('role_gate');
    const assignRole = interaction.options.getRole('assign_role');
    const minChars = interaction.options.getInteger('min_chars') || draftConfig?.minCharacters || 0;
    const keyword = interaction.options.getString('keyword') || draftConfig?.keyword || '';
    const totalBundle = interaction.options.getInteger('total_bundle') || 0;

    await interaction.deferReply({ ephemeral: true });

    // Fetch tweet metadata
    const tweetMeta = await fetchTweetMetadata(cleanUrl, username, tweetId);
    const authorDisplayName = tweetMeta?.authorName || `@${username}`;
    const tweetBody = tweetMeta?.text || 'Engage with this post on X to earn Cohesion Points (CP)!';

    // Parse duration (optional)
    let expiresAtDate = null;
    let hasExpiration = false;
    let expireTimestampSec = null;

    if (rawDuration) {
      const lowerDur = rawDuration.trim().toLowerCase();
      if (!['never', 'none', 'no', '0', 'permanent', 'inf'].includes(lowerDur)) {
        const match = lowerDur.match(/^(\d+)\s*(m|h|d)$/);
        let durationMs = 0;
        if (match) {
          const val = parseInt(match[1], 10);
          const unit = match[2];
          if (unit === 'm') durationMs = val * 60 * 1000;
          if (unit === 'h') durationMs = val * 60 * 60 * 1000;
          if (unit === 'd') durationMs = val * 24 * 60 * 60 * 1000;
        } else {
          const num = parseInt(lowerDur, 10);
          if (!isNaN(num) && num > 0) {
            durationMs = num * 60 * 60 * 1000;
          }
        }
        if (durationMs > 0) {
          expiresAtDate = new Date(Date.now() + durationMs);
          hasExpiration = true;
          expireTimestampSec = Math.floor(expiresAtDate.getTime() / 1000);
        }
      }
    }

    const btnFilter = buttonsOption.toLowerCase().trim();
    const isNone = btnFilter === 'none';
    const isAll = btnFilter === 'all' || (!btnFilter.includes('like') && !btnFilter.includes('rt') && !btnFilter.includes('retweet') && !btnFilter.includes('comment') && !btnFilter.includes('reply'));

    const includeLike = !isNone && (isAll || btnFilter.includes('like'));
    const includeRt = !isNone && (isAll || btnFilter.includes('rt') || btnFilter.includes('retweet') || btnFilter.includes('repost'));
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

    actionRow.addComponents(
      new ButtonBuilder()
        .setLabel('View on X ↗️')
        .setStyle(ButtonStyle.Link)
        .setURL(cleanUrl)
    );

    let requirementsList = [];
    if (leadBonus > 0) requirementsList.push(`⚡ **Lead Engagers:** +${leadBonus} CP bonus for first 15 mins!`);
    if (verifiedOnly) requirementsList.push(`🔷 **Verified Only:** Requires Twitter Blue / X Premium.`);
    if (requireFollow) requirementsList.push(`👤 **Require Follow:** Must follow @${username}.`);
    if (roleGate) requirementsList.push(`🔒 **Role Gate:** <@&${roleGate.id}> required to claim.`);
    if (assignRole) requirementsList.push(`🎖️ **Reward Role:** Awards <@&${assignRole.id}> on claim.`);
    if (keyword) requirementsList.push(`💬 **Keyword Required:** \`${keyword}\` in comment.`);
    if (minChars > 0) requirementsList.push(`📏 **Min Reply Length:** ${minChars} chars.`);
    if (totalBundle > 0) requirementsList.push(`🎁 **Completion Bundle:** +${totalBundle} CP when all actions done.`);

    let messageContent = `**${authorDisplayName}** just posted on X:\n${cleanUrl}\n\n` +
      `**Engage to collect your Cohesion Points (CP)**`;
    if (hasExpiration && expireTimestampSec) {
      messageContent += `\nExpires <t:${expireTimestampSec}:R>`;
    }

    if (requirementsList.length > 0) {
      messageContent += `\n\n${requirementsList.join('\n')}`;
    }

    if (customText) {
      messageContent += `\n\n📌 *Note: ${customText}*`;
    }

    if (rawTag) {
      messageContent += `\n${rawTag}`;
    }

    const embeds = [];
    if (showImage) {
      const tweetEmbed = new EmbedBuilder()
        .setColor(0x1da1f2)
        .setAuthor({
          name: `${authorDisplayName} (@${username})`,
          iconURL: tweetMeta?.authorAvatar || 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
          url: cleanUrl,
        })
        .setTitle(`@${username} tweeted!`)
        .setURL(cleanUrl)
        .setDescription(tweetBody)
        .setFooter({
          text: 'Powered by Cohesion Ecosystem',
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
      const sentMessage = await targetChannel.send({
        content: messageContent,
        embeds,
        components,
        flags: showImage ? undefined : MessageFlags.SuppressEmbeds,
        allowedMentions: { parse: ['roles', 'users', 'everyone'] },
      });

      await supabase.from('tweet_quests').upsert(
        {
          tweet_id: tweetId,
          guild_id: interaction.guildId,
          url: cleanUrl,
          content: tweetBody,
          author_name: authorDisplayName,
          author_username: username,
          points_per_action: points,
          expires_at: expiresAtDate ? expiresAtDate.toISOString() : null,
          channel_id: targetChannel.id,
          message_id: sentMessage.id,
        },
        { onConflict: 'tweet_id' }
      );

      return interaction.editReply({
        content: `✅ Successfully broadcasted tweet quest card to <#${targetChannel.id}>! (Tweet ID: \`${tweetId}\`)`,
      });
    } catch (err) {
      console.error('[POST TWEET ERROR]:', err);
      return interaction.editReply({
        content: `❌ Failed to broadcast to <#${targetChannel.id}>: ${err.message}`,
      });
    }
  },
};
