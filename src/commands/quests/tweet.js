import postTweet from './postTweet.js';
import { SlashCommandBuilder } from 'discord.js';

// Re-export /tweet with identical options as /post-tweet to match Engage.io's primary command name
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
    .addIntegerOption(option =>
      option.setName('expire_hours').setDescription('Hours until engagement quest expires (default: 24)').setRequired(false).setMinValue(1).setMaxValue(168)
    )
    .addChannelOption(option =>
      option.setName('channel').setDescription('Channel to broadcast the tweet quest').setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role_mention').setDescription('Role to ping (e.g. @Socials)').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('custom_text').setDescription('Custom description or snippet of the tweet').setRequired(false)
    ),
};

export default tweetCommand;
