import { Events, ActivityType } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`[QUESTIFY READY] Logged in as ${client.user.tag}`);
    console.log(`[CONNECTED SERVERS (${client.guilds.cache.size})]:`);
    client.guilds.cache.forEach((g) => console.log(` - ${g.name} (ID: ${g.id})`));
    client.user.setActivity('Questify Quests & Rewards ⚡', { type: ActivityType.Watching });
  },
};
