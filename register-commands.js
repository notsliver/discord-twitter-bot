require('dotenv').config();
const { REST, Routes } = require('discord.js');
const path = require('path');
const { loadSlashCommands } = require('./commandLoader');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CLIENT_ID = process.env.CLIENT_ID || '';
const GUILD_ID = process.env.GUILD_ID || '';
const isGlobal = process.argv.includes('--global');
const isGlobalRemove = process.argv.includes('--globalremove');

async function main() {
  if (!DISCORD_BOT_TOKEN || !CLIENT_ID) {
    console.error('Missing DISCORD_BOT_TOKEN or CLIENT_ID.');
    process.exit(1);
  }

  const { jsonData } = loadSlashCommands(path.join(__dirname, 'commands'));
  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

  try {
    if (isGlobalRemove) {
      console.log('Removing ALL GLOBAL slash commands ...');
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
      console.log('All global slash commands removed.');
    } else if (isGlobal) {
      console.log(`Registering ${jsonData.length} GLOBAL slash command(s) ...`);
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: jsonData });
      console.log('Global slash commands registered. Note: Can take up to 1 hour to propagate.');
    } else {
      if (!GUILD_ID) {
        console.error('GUILD_ID missing. Provide --global for global registration or set GUILD_ID for guild-only.');
        process.exit(1);
      }
      console.log(`Registering ${jsonData.length} GUILD slash command(s) for guild ${GUILD_ID} ...`);
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: jsonData });
      console.log('Guild slash commands registered.');
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
    process.exit(1);
  }
}

main();


