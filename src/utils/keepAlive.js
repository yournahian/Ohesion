import http from 'node:http';
import https from 'node:https';
import { config } from '../config.js';

/**
 * Periodically pings the bot's own Render HTTP URL to prevent the container
 * from idling / going to sleep after 15 minutes of inactivity on Render Free tier.
 */
export function startKeepAlive() {
  const url = config.baseUrl;
  if (!url || !url.startsWith('http')) {
    console.log('[KEEP-ALIVE]: No valid BASE_URL configured for self-pinging.');
    return;
  }

  // Ping every 10 minutes (600,000 ms) - safely within Render's 15-minute sleep threshold
  const PING_INTERVAL_MS = 10 * 60 * 1000;

  console.log(`[KEEP-ALIVE]: Initialized background self-ping to ${url} every 10 minutes to prevent Render cold sleep.`);

  const ping = () => {
    try {
      const client = url.startsWith('https://') ? https : http;
      const req = client.get(url, (res) => {
        // Discard response body to avoid memory leaks
        res.resume();
        console.log(`[KEEP-ALIVE PING]: Heartbeat sent to ${url} (HTTP ${res.statusCode})`);
      });

      req.on('error', (err) => {
        console.warn(`[KEEP-ALIVE WARNING]: Ping to ${url} encountered an error:`, err.message);
      });

      req.setTimeout(15000, () => {
        req.destroy();
      });
    } catch (err) {
      console.warn(`[KEEP-ALIVE ERROR]:`, err.message);
    }
  };

  // Initial ping after 30 seconds, then recurring interval
  setTimeout(ping, 30 * 1000);
  setInterval(ping, PING_INTERVAL_MS);
}
