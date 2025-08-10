const fs = require('fs');
const path = require('path');

function loadSlashCommands(commandsDir) {
  const commands = new Map();
  const jsonData = [];
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const commandPath = path.join(commandsDir, file);
    const command = require(commandPath);
    if (!command?.data || !command?.execute) continue;
    commands.set(command.data.name, command);
    jsonData.push(command.data.toJSON());
  }

  return { commands, jsonData };
}

module.exports = { loadSlashCommands };


