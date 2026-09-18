import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');

async function getCommandFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const UI_COMMANDS = new Set(['hub', 'admin', 'setup']);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await getCommandFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const commandModule = await import(pathToFileURL(fullPath).href);
      const command = commandModule.default || commandModule;
      if (command && 'data' in command && 'execute' in command) {
        if (UI_COMMANDS.has(command.data.name)) {
          commands.push(command.data.toJSON());
        }
      }
    }
  }
}

async function deploy() {
  await getCommandFiles(commandsPath);

  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
    console.error('Error: DISCORD_TOKEN and CLIENT_ID are required in your .env file.');
    process.exit(1);
  }

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);

  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    // Global registration (or specify Routes.applicationGuildCommands(clientId, guildId) for instant dev guild registration)
    const data = await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );

    console.log(`Successfully reloaded ${data.length} application (/) commands.`);
  } catch (error) {
    console.error(error);
  }
}

deploy();
