import { Events, ActivityType } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`[QUESTIFY READY] Logged in as ${client.user.tag}`);
    client.user.setActivity('Questify Quests & Rewards ⚡', { type: ActivityType.Watching });
  },
};
