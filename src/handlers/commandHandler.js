import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadCommands(client, commandsDir) {
  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
    return;
  }

  const entries = fs.readdirSync(commandsDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(commandsDir, entry.name);

    if (entry.isDirectory()) {
      await loadCommands(client, fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const commandModule = await import(pathToFileURL(fullPath).href);
      const command = commandModule.default || commandModule;

      if (command && 'data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`[COMMAND] Loaded /${command.data.name}`);
      } else {
        console.warn(`[WARNING] The command at ${fullPath} is missing a required "data" or "execute" property.`);
      }
    }
  }
}
