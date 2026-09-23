import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';
import { initTelegramBot } from './telegram/telegramBot.js';

import { startKeepAlive } from './utils/keepAlive.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// HTTP server for Render health checks and large recording downloads (>25MB)
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      // Serve recording downloads: /download/:sessionId/:filename
      if (parsedUrl.pathname.startsWith('/download/')) {
        const segments = parsedUrl.pathname.split('/').filter(Boolean);
        if (segments.length >= 3) {
          const sessionId = segments[1].replace(/[^a-zA-Z0-9_-]/g, '');
          const rawFilename = decodeURIComponent(segments.slice(2).join('/'));
          const safeFilename = path.basename(rawFilename);
          const recordingsDir = path.join(__dirname, 'data', 'recordings');
          const targetPath = path.join(recordingsDir, sessionId, safeFilename);

          if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
            const ext = path.extname(safeFilename).toLowerCase();
            const mimeTypes = {
              '.mp3': 'audio/mpeg',
              '.wav': 'audio/wav',
              '.zip': 'application/zip',
              '.md': 'text/markdown; charset=utf-8',
              '.txt': 'text/plain; charset=utf-8',
            };
            const contentType = mimeTypes[ext] || 'application/octet-stream';
            const stat = fs.statSync(targetPath);

            res.writeHead(200, {
              'Content-Type': contentType,
              'Content-Length': stat.size,
              'Content-Disposition': `attachment; filename="${safeFilename}"`,
            });
            return fs.createReadStream(targetPath).pipe(res);
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('404: Recording file not found or expired.\n');
          }
        }
      }

      // Serve interactive documentation portal: /docs or /
      if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/docs') {
        const docsPath = path.resolve('docs/index.html');
        if (fs.existsSync(docsPath)) {
          const html = fs.readFileSync(docsPath, 'utf-8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(html, 'utf-8'),
          });
          return res.end(html);
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Cohesion Bot is active and healthy!\n');
    } catch (err) {
      console.error('[HTTP SERVER ERROR]:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error\n');
    }
  })
  .listen(PORT, () => {
    console.log(`[HEALTH] Health check & Download server listening on port ${PORT}`);
    // Start self-pinging keep-alive worker to prevent Render sleep
    startKeepAlive();
  });

// Initialize Discord Client with required Intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

// Collection to hold slash commands
client.commands = new Collection();

async function main() {
  console.log('--- Initializing Cohesion Bot ---');

  // Load slash commands
  const commandsPath = path.join(__dirname, 'commands');
  await loadCommands(client, commandsPath);

  // Load gateway event listeners
  const eventsPath = path.join(__dirname, 'events');
  await loadEvents(client, eventsPath);

  // Guild join listener
  client.on('guildCreate', (guild) => {
    console.log(`[NEW SERVER JOINED] ${guild.name} (ID: ${guild.id}) - Members: ${guild.memberCount}`);
  });

  // Connect to Discord
  if (!config.discordToken) {
    console.error('CRITICAL: DISCORD_TOKEN is not defined in .env. Please set it before starting.');
    process.exit(1);
  }

  await client.login(config.discordToken);

  // Initialize and start Telegram Bot concurrently
  try {
    await initTelegramBot(client);
  } catch (tgErr) {
    console.error('[TELEGRAM INIT ERROR]:', tgErr.message);
  }
}

// Global process safety handlers to prevent crashes from network blips or cold start timeouts
process.on('unhandledRejection', (error) => {
  if (error?.code === 10062 || error?.rawError?.code === 10062 || error?.code === 40060) {
    console.warn(`[DISCORD 10062/40060 SUPPRESSED]: Interaction expired or already acknowledged.`);
    return;
  }
  console.error('[UNHANDLED REJECTION]:', error);
});

process.on('uncaughtException', (error) => {
  if (error?.code === 10062 || error?.rawError?.code === 10062 || error?.code === 40060) {
    console.warn(`[DISCORD 10062/40060 SUPPRESSED]: Interaction expired or already acknowledged.`);
    return;
  }
  console.error('[UNCAUGHT EXCEPTION]:', error);
});

main().catch((err) => {
  console.error('Fatal error during startup:', err);
});
