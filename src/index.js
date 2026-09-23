import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';
import { initTelegramBot } from './telegram/telegramBot.js';

// Force Node.js to prioritize IPv4 over IPv6 on hosting environments like Render
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// HTTP server for Render health checks and large recording downloads (>25MB)
const PORT = process.env.PORT || 3000;
http
  .createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      // Diagnostic endpoint to check Discord API & network connectivity directly from Render
      if (parsedUrl.pathname === '/diagnose') {
        const results = {
          timestamp: new Date().toISOString(),
          nodeVersion: process.version,
          clientReady: client.isReady(),
          botTag: client.user?.tag || null,
          guildsCount: client.guilds?.cache?.size || 0,
        };

        // 1. DNS lookups
        try {
          results.dnsDiscord = await dns.promises.lookup('discord.com', { all: true });
        } catch (e) {
          results.dnsDiscordError = e.message;
        }

        try {
          results.dnsGateway = await dns.promises.lookup('gateway.discord.gg', { all: true });
        } catch (e) {
          results.dnsGatewayError = e.message;
        }

        // 2. Outbound Public IP
        try {
          const ipRes = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
          results.publicIp = await ipRes.json();
        } catch (e) {
          results.publicIpError = e.message;
        }

        // 3. Direct Discord REST API check (gateway/bot)
        try {
          const start = Date.now();
          const cleanTok = (config.discordToken || '').trim().replace(/^["']|["']$/g, '');
          const restRes = await fetch('https://discord.com/api/v10/gateway/bot', {
            headers: { Authorization: `Bot ${cleanTok}` },
            signal: AbortSignal.timeout(8000),
          });
          results.discordRest = {
            status: restRes.status,
            statusText: restRes.statusText,
            timeMs: Date.now() - start,
            data: await restRes.json().catch(() => null),
          };
        } catch (e) {
          results.discordRestError = e.message;
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(results, null, 2));
      }

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
  const rawToken = config.discordToken || '';
  const cleanToken = rawToken.trim().replace(/^["']|["']$/g, '');

  if (!cleanToken) {
    console.error('CRITICAL: DISCORD_TOKEN is not defined in .env or Render environment. Please set it before starting.');
    process.exit(1);
  }

  // Shard & Gateway connectivity monitoring
  client.on('shardReady', (shardId) => {
    console.log(`[GATEWAY] Shard ${shardId} connected & ready!`);
  });
  client.on('shardError', (error, shardId) => {
    console.error(`[GATEWAY ERROR] Shard ${shardId} error:`, error);
  });
  client.on('shardDisconnect', (event, shardId) => {
    console.warn(`[GATEWAY DISCONNECT] Shard ${shardId} disconnected:`, event);
  });
  client.on('shardReconnecting', (shardId) => {
    console.log(`[GATEWAY] Shard ${shardId} reconnecting...`);
  });
  client.on('error', (err) => {
    console.error('[CLIENT ERROR]:', err);
  });

  try {
    console.log(`[LOGIN] Connecting to Discord Gateway (Token Length: ${cleanToken.length}, Prefix: ${cleanToken.substring(0, 10)}...)...`);
    await client.login(cleanToken);
    console.log(`[LOGIN] Gateway handshake succeeded! Logged in as: ${client.user?.tag || 'Discord Client'}`);
  } catch (loginErr) {
    console.error('[CRITICAL LOGIN ERROR]: Failed to login to Discord:', loginErr);
  }

  // Initialize and start Telegram Bot concurrently
  try {
    await initTelegramBot(client);
  } catch (tgErr) {
    console.error('[TELEGRAM INIT ERROR]:', tgErr.message);
  }
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
