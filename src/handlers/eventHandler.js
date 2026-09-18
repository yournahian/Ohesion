import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadEvents(client, eventsDir) {
  if (!fs.existsSync(eventsDir)) {
    fs.mkdirSync(eventsDir, { recursive: true });
    return;
  }

  const files = fs.readdirSync(eventsDir).filter(file => file.endsWith('.js'));

  for (const file of files) {
    const fullPath = path.join(eventsDir, file);
    const eventModule = await import(pathToFileURL(fullPath).href);
    const event = eventModule.default || eventModule;

    if (!event || !event.name || !event.execute) {
      console.warn(`[WARNING] The event at ${fullPath} is missing a required "name" or "execute" property.`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }

    console.log(`[EVENT] Registered event listener: ${event.name}`);
  }
}
