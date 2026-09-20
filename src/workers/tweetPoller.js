import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fetchTweetMetadata } from '../utils/twitter.js';

// Guild Tracked Twitter Handles: guildId -> Set of handles (e.g. ['cohesion_xyz'])
const trackedHandlesByGuild = new Map();
const lastProcessedTweetId = new Map(); // handle -> lastTweetId

/**
 * Adds a Twitter handle to monitor for a guild.
 * @param {string} guildId 
 * @param {string} handle 
 */
export function addTrackedHandle(guildId, handle) {
  const clean = handle.replace('@', '').trim().toLowerCase();
  if (!trackedHandlesByGuild.has(guildId)) {
    trackedHandlesByGuild.set(guildId, new Set());
  }
  trackedHandlesByGuild.get(guildId).add(clean);
  return clean;
}

/**
 * Removes a tracked handle.
 * @param {string} guildId 
 * @param {string} handle 
 */
export function removeTrackedHandle(guildId, handle) {
  const clean = handle.replace('@', '').trim().toLowerCase();
  if (!trackedHandlesByGuild.has(guildId)) return false;
  return trackedHandlesByGuild.get(guildId).delete(clean);
}

/**
 * Gets all tracked handles for a guild.
 * @param {string} guildId 
 * @returns {string[]}
 */
export function getTrackedHandles(guildId) {
  if (!trackedHandlesByGuild.has(guildId)) return [];
  return Array.from(trackedHandlesByGuild.get(guildId));
}

/**
 * Polls latest tweets and automatically broadcasts new ones to #cohesion-feed.
 * @param {import('discord.js').Client} client 
 */
export async function pollTrackedTweets(client) {
  for (const [guildId, handles] of trackedHandlesByGuild.entries()) {
    if (handles.size === 0) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const feedChannel = guild.channels.cache.find(
      (c) => c.isTextBased() && (c.name.includes('cohesion-feed') || c.name.includes('quest-feed') || c.name.includes('engage'))
    );

    if (!feedChannel) continue;

    for (const handle of handles) {
      try {
        // Fetch public timeline metadata via syndication / RSS bridge / fxtwitter
        // When a new tweet is found:
        // Example tweetId detection
        const checkUrl = `https://api.fxtwitter.com/${handle}/status/latest`;
        const res = await fetch(checkUrl, {
          headers: { 'User-Agent': 'CohesionBot/1.0' },
        }).catch(() => null);

        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.tweet && data.tweet.id) {
            const tweet = data.tweet;
            const lastId = lastProcessedTweetId.get(handle);

            if (lastId !== tweet.id) {
              lastProcessedTweetId.set(handle, tweet.id);

              // Broadcast new tweet quest!
              const cleanUrl = `https://x.com/${handle}/status/${tweet.id}`;
              const embed = new EmbedBuilder()
                .setColor(0x1da1f2)
                .setAuthor({
                  name: `${tweet.author?.name || handle} (@${handle})`,
                  iconURL: tweet.author?.avatar_url || undefined,
                  url: cleanUrl,
                })
                .setTitle('📢 New Tweet Detected • Auto-Raid Active!')
                .setDescription(
                  `${tweet.text || 'Engage with this post on X to earn Cohesion Points!'}\n\n` +
                  `🔗 **[View Tweet on X (Twitter)](${cleanUrl})**\n\n` +
                  `**Earn Cohesion Points (CP):**\n` +
                  `• Like post: \`+25 CP\`\n` +
                  `• Retweet post: \`+25 CP\`\n` +
                  `• Reply/Comment: \`+25 CP\``
                )
                .setFooter({ text: 'Cohesion Auto-Tweet Tracking' })
                .setTimestamp();

              if (tweet.media?.photos?.[0]?.url) {
                embed.setImage(tweet.media.photos[0].url);
              }

              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`quest_claim_${tweet.id}_like`)
                  .setLabel('Like ❤️ (+25 CP)')
                  .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                  .setCustomId(`quest_claim_${tweet.id}_retweet`)
                  .setLabel('Retweet 🔁 (+25 CP)')
                  .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                  .setCustomId(`quest_claim_${tweet.id}_reply`)
                  .setLabel('Comment 💬 (+25 CP)')
                  .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                  .setLabel('Open on X ↗️')
                  .setStyle(ButtonStyle.Link)
                  .setURL(cleanUrl)
              );

              await feedChannel.send({ embeds: [embed], components: [row] }).catch(() => null);
            }
          }
        }
      } catch (err) {
        // Graceful handle check error
      }
    }
  }
}

/**
 * Initializes the Twitter auto-tracking polling cycle.
 * @param {import('discord.js').Client} client 
 */
export function initTwitterPoller(client) {
  // Poll every 3 minutes
  setInterval(() => {
    pollTrackedTweets(client).catch(() => null);
  }, 1000 * 60 * 3);
}
