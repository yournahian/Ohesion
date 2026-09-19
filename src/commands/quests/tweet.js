import postTweet from './postTweet.js';
import { SlashCommandBuilder } from 'discord.js';

// Re-export /tweet with identical options as /post-tweet
const tweetCommand = {
  ...postTweet,
  data: new SlashCommandBuilder()
    .setName('tweet')
    .setDescription('Publish a tracked Twitter/X quest card with Like, Retweet & Comment verification buttons.')
    .addStringOption(option =>
      option.setName('url').setDescription('The URL of the Tweet / X post').setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('points').setDescription('Points awarded per verified action (default: 25)').setRequired(false).setMinValue(1)
    )
    .addStringOption(option =>
      option.setName('duration').setDescription('Duration of quest: e.g. "30m", "45m", "2h", "24h", "3d" (default: 24h)').setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('expire_hours').setDescription('Hours until engagement quest expires (alternative: use duration)').setRequired(false).setMinValue(1).setMaxValue(168)
    )
    .addStringOption(option =>
      option.setName('buttons').setDescription('Buttons to include (e.g. "like, rt, comment" or "like, rt" or "none")').setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('show_image').setDescription('Show tweet media thumbnail & image display? (default: true)').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('tag').setDescription('Server role or member tag to ping (e.g. @Socials, @everyone, or role name)').setRequired(false)
    )
    .addChannelOption(option =>
      option.setName('channel').setDescription('Channel to broadcast the tweet quest').setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role_mention').setDescription('Role to ping (alternative to tag)').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('custom_text').setDescription('Custom description / requirements list for the post').setRequired(false)
    ),
};

export default tweetCommand;
