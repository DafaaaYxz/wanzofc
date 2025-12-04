const chalk = require("chalk");
const fs = require("fs");
const path = require('path');
const util = require("util");
const { exec } = require('child_process');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require("@skyzopedia/baileys-mod");
const User = require('./models/user');

const dbPath = "./collection/database.json";
if (!fs.existsSync(dbPath)) {
    if (!fs.existsSync("./collection")) fs.mkdirSync("./collection");
    fs.writeFileSync(dbPath, JSON.stringify({ welcome: true, pconly: false, grouponly: false, antilink: [], list: {} }));
}
global.db = JSON.parse(fs.readFileSync(dbPath));

global.public = true;
global.owner = "6289526346592";
global.botname = "Fiona Bot";
global.telegram = "https://t.me/maverick_dar";
global.audioUrl = "https://files.catbox.moe/j2l430.mp3";

const fakeQuoted = {
    key: { fromMe: false, participant: "0@s.whatsapp.net", remoteJid: "status@broadcast" },
    message: { conversation: "Fiona Bot Dashboard v2.0" }
};

module.exports = async (fio, m, store) => {
    try {
        let body = (m.mtype === 'conversation') ? m.message.conversation :
                   (m.mtype === 'imageMessage') ? m.message.imageMessage.caption :
                   (m.mtype === 'videoMessage') ? m.message.videoMessage.caption :
                   (m.mtype === 'extendedTextMessage') ? m.message.extendedTextMessage.text :
                   (m.mtype === 'buttonsResponseMessage') ? m.message.buttonsResponseMessage.selectedButtonId :
                   (m.mtype === 'listResponseMessage') ? m.message.listResponseMessage.singleSelectReply.selectedRowId :
                   (m.mtype === 'templateButtonReplyMessage') ? m.message.templateButtonReplyMessage.selectedId :
                   (m.mtype === 'interactiveResponseMessage') ? JSON.parse(m.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson).id : "";

        if (!body) return;

        const isCmd = body.startsWith(m.prefix);
        const command = isCmd ? body.slice(m.prefix.length).trim().split(' ').shift().toLowerCase() : '';
        const args = body.trim().split(/ +/).slice(1);
        const text = args.join(" ");
        
        const botNumber = fio.user.id.split(":")[0] + "@s.whatsapp.net";
        const quoted = m.quoted ? m.quoted : m;
        const mime = (quoted.msg || quoted).mimetype || '';
        
        let customCode = "";
        let sessionConfig = {};

        try {
            const user = await User.findOne({ "sessions.phoneNumber": botNumber });
            if (user) {
                const session = user.sessions.find(s => s.phoneNumber === botNumber);
                if (session) {
                    sessionConfig = session.config || {};
                    global.owner = sessionConfig.owner || global.owner;
                    global.botname = sessionConfig.botname || global.botname;
                    global.telegram = sessionConfig.telegram || global.telegram;
                    customCode = session.customCode || "";
                }
            }
        } catch (e) {
            console.error("Database fetch error:", e);
        }
        
        const isOwner = (global.owner + '@s.whatsapp.net') === m.sender || m.sender === botNumber;

        if (m.isGroup) {
            if (!global.groupMetadataCache) global.groupMetadataCache = new Map();
            let meta = global.groupMetadataCache.get(m.chat) || await fio.groupMetadata(m.chat).catch(() => {});
            if (meta) global.groupMetadataCache.set(m.chat, meta);
            m.metadata = meta || {};
            m.isAdmin = !!m.metadata.participants?.find(p => p.id === m.sender)?.admin;
            m.isBotAdmin = !!m.metadata.participants?.find(p => p.id === botNumber)?.admin;
        }

        if (isCmd) {
            console.log(chalk.black(chalk.bgWhite('[ CMD ]')), chalk.magenta(command), 'from', chalk.cyan(m.sender.split('@')[0]));
        }

        if (!global.public && !isOwner) return;

        if (global.db.antilink.includes(m.chat)) {
            if (body.match(/(chat.whatsapp.com)/gi) && !isOwner && !m.isAdmin && m.isBotAdmin) {
                await fio.sendMessage(m.chat, { delete: m.key });
            }
        }

        switch (command) {
            case "menu": {
                let img;
                try {
                    img = JSON.parse(fs.readFileSync("./collection/thumbnail.json"));
                } catch {
                    img = { imageMessage: { url: "https://files.catbox.moe/k3612t2.jpg" } };
                }

                let statusMode = global.public ? "PUBLIC" : "SELF (PRIVATE)";
                let teks = `
Hii @${m.sender.split("@")[0]} 🕊️
I'am Based WhatsApp Bot Latest Baileys Version!

Bot Mode: *${statusMode}*
Prefix: *[ ${m.prefix} ]*
`;
                let buttons = [
                    { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: "Contact Owner", url: global.telegram, merchant_url: global.telegram }) },
                    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: "👑 OWNER MENU", id: `${m.prefix}ownermenu` }) }
                ];

                let msg = await generateWAMessageFromContent(m.chat, {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                header: { ...img, hasMediaAttachment: true },
                                body: { text: teks },
                                nativeFlowMessage: { buttons: buttons },
                                contextInfo: {
                                    mentionedJid: [m.sender],
                                    externalAdReply: {
                                        title: global.botname, body: "Web Panel Control v2.0",
                                        thumbnailUrl: "https://files.catbox.moe/k3612t2.jpg",
                                        sourceUrl: global.telegram, mediaType: 1, renderLargerThumbnail: true
                                    }
                                }
                            }
                        }
                    }
                }, { userJid: m.sender, quoted: fakeQuoted });

                await fio.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
            }
            break;

            case "ownermenu": {
                if (!isOwner) return m.reply("Owner Only");
                let msg = await generateWAMessageFromContent(m.chat, {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                header: { title: "OWNER PANEL", hasMediaAttachment: false },
                                body: { text: "Select Mode:" },
                                nativeFlowMessage: {
                                    buttons: [
                                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: "🔒 SELF MODE", id: `${m.prefix}self` }) },
                                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: "🔓 PUBLIC MODE", id: `${m.prefix}public` }) },
                                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: "📷 SET THUMBNAIL", id: `${m.prefix}setthumb` }) }
                                    ]
                                }
                            }
                        }
                    }
                }, { quoted: m });
                await fio.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
            }
            break;

            case "jpm": {
                if (!isOwner) return m.reply("Owner Only");
                if (!text) return m.reply(`Gunakan: ${m.prefix}jpm <teks> | reply gambar`);
                
                const delay = sessionConfig.jedaJpm || 4000;
                
                try {
                    const contacts = Object.values(store.contacts)
                        .filter(c => c.id.endsWith('@s.whatsapp.net'))
                        .map(c => c.id);

                    if (contacts.length === 0) return m.reply("Tidak ada kontak yang ditemukan.");
                    
                    m.reply(`Memulai JPM ke ${contacts.length} kontak...`);

                    let messageData = {};
                    if (/image/.test(mime)) {
                        let media = await quoted.download();
                        messageData = { image: media, caption: text };
                    } else {
                        messageData = { text: text };
                    }

                    for (const contact of contacts) {
                        await fio.sendMessage(contact, messageData);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                    m.reply("JPM Selesai.");
                } catch (e) {
                    m.reply("Gagal mengirim JPM: " + e.message);
                }
            }
            break;

            case "self":
                if (!isOwner) return m.reply("Owner Only");
                global.public = false;
                m.reply("Mode Self Active");
                break;

            case "public":
                if (!isOwner) return m.reply("Owner Only");
                global.public = true;
                m.reply("Mode Public Active");
                break;

            case "setthumb":
                if (!isOwner) return m.reply("Owner Only");
                if (!/image/.test(mime)) return m.reply("Reply image");
                let media = await m.download();
                let upload = await prepareWAMessageMedia({ image: media }, { upload: fio.waUploadToServer });
                fs.writeFileSync("./collection/thumbnail.json", JSON.stringify(upload));
                m.reply("Thumbnail Updated Successfully");
                break;

            default:
                let isCustomCommand = false;
                if (customCode) {
                    try {
                        isCustomCommand = await eval(`
                            (async () => {
                                switch(command) {
                                    ${customCode}
                                    default: return false;
                                }
                                return true;
                            })()
                        `);
                    } catch (e) {
                        console.error("Custom Code Execution Error:", e);
                        m.reply(`Error in injected code: ${e.message}`);
                    }
                }

                if (!isCustomCommand) {
                    if (body.startsWith("> ") && isOwner) {
                        try {
                            let evaled = await eval(body.slice(2));
                            if (typeof evaled !== 'string') evaled = require('util').inspect(evaled);
                            m.reply(evaled);
                        } catch (err) {
                            m.reply(String(err));
                        }
                    }
                    if (body.startsWith("$ ") && isOwner) {
                        exec(body.slice(2), (e, out) => m.reply(e || out));
                    }
                }
        }
    } catch (err) {
        console.log("Error in message handler:", err);
    }
};

let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log(chalk.red(`Update ${__filename}`));
    delete require.cache[file];
    require(file);
});
