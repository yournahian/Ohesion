import { Events, ActivityType } from 'discord.js';
import { initActivePollsWatcher } from '../utils/pollManager.js';
import { initActiveAuctionsWatcher } from '../utils/auctionManager.js';
import { initInflationScheduler } from '../workers/inflationWorker.js';
import { initTwitterPoller } from '../workers/tweetPoller.js';
import { loadStatsFromSupabase } from '../utils/messageTracker.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`[COHESION READY] Logged in as ${client.user.tag}`);
    console.log(`[CONNECTED SERVERS (${client.guilds.cache.size})]:`);
    client.guilds.cache.forEach((g) => console.log(` - ${g.name} (ID: ${g.id})`));
    client.user.setActivity('Cohesion Quests & Hub 🌀', { type: ActivityType.Watching });

    // Preload message stats from Supabase
    loadStatsFromSupabase().catch((err) =>
      console.warn('[READY MESSAGE STATS PRELOAD ERROR]:', err.message)
    );

    // Initialize watchers for active polls and auctions
    initActivePollsWatcher(client).catch((err) =>
      console.warn('[READY POLL WATCHER ERROR]:', err.message)
    );
    initActiveAuctionsWatcher(client).catch((err) =>
      console.warn('[READY AUCTION WATCHER ERROR]:', err.message)
    );

    // Initialize Weekly Inflation & Decay deflationary engine
    try {
      initInflationScheduler(client);
    } catch (err) {
      console.warn('[READY INFLATION SCHEDULER ERROR]:', err.message);
    }

    // Initialize Auto-Track Twitter Poller feed engine
    try {
      initTwitterPoller(client);
    } catch (err) {
      console.warn('[READY TWITTER POLLER ERROR]:', err.message);
    }
  },
};
