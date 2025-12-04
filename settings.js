const chalk = require("chalk");
const fs = require("fs");

global.pairingNumber = "15489195889"

global.owner = "15489195889"
global.botname = "RICKV1"
global.telegram = "https://t.me/maverick_dar"
global.linkgroup = "https://t.me/maverick_dar"

global.jedaPushkontak = 5000
global.jedaJpm = 4000

global.dana = "088801074059"
global.ovo = "Tidak tersedia"
global.gopay = "Tidak tersedia"
global.qris = "Tidak tersedia"

let file = require.resolve(__filename) 
fs.watchFile(file, () => {
fs.unwatchFile(file)
console.log(chalk.white("• Update"), chalk.white(`${__filename}\n`))
delete require.cache[file]
require(file)
})