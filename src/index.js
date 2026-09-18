import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lightweight HTTP server for Render / hosting platform health checks
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Questify Bot is active and healthy!\n');
  })
  .listen(PORT, () => {
    console.log(`[HEALTH] Health check server listening on port ${PORT}`);
  });

// Initialize Discord Client with required Intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Collection to hold slash commands
client.commands = new Collection();

async function main() {
  console.log('--- Initializing Discord Engagement Bot ---');

  // Load slash commands
  const commandsPath = path.join(__dirname, 'commands');
  await loadCommands(client, commandsPath);

  // Load gateway event listeners
  const eventsPath = path.join(__dirname, 'events');
  await loadEvents(client, eventsPath);

  // Connect to Discord
  if (!config.discordToken) {
    console.error('CRITICAL: DISCORD_TOKEN is not defined in .env. Please set it before starting.');
    process.exit(1);
  }

  await client.login(config.discordToken);
}

// Global process safety handlers to prevent crashes from network blips
process.on('unhandledRejection', (error) => {
  console.error('[UNHANDLED REJECTION]:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]:', error);
});

main().catch((err) => {
  console.error('Fatal error during startup:', err);
});
