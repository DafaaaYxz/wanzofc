const fs = require('fs')
const path = require('path');

module.exports = async (directory) => {
  let plugins = [];
  const folders = fs.readdirSync(directory);

  for (const file of folders) {
    const filePath = path.join(directory, file);

    if (!filePath.endsWith(".js")) continue;

    try {
      const resolvedPath = require.resolve(filePath);
      if (require.cache[resolvedPath]) {
        delete require.cache[resolvedPath];
      }

      const plugin = require(filePath);
      plugins.push(plugin);

    } catch (error) {
      console.log(`Error loading plugin at ${filePath}:`, error);
      return plugins
    }
  }

  return plugins;
};