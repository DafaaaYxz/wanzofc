const chalk = require("chalk");
const fs = require("fs");
const path = require('path');
const util = require("util");
const { exec } = require('child_process');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require("@skyzopedia/baileys-mod");

const dbPath = "./collection/database.json";
if(!fs.existsSync(dbPath)) {
    if(!fs.existsSync("./collection")) fs.mkdirSync("./collection");
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

module.exports = async (fio, m) => {
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
        const cmd = isCmd ? m.prefix + command : ""; 
        
        const botNumber = fio.user.id.split(":")[0] + "@s.whatsapp.net";
        const isOwner = m.sender.split("@")[0] === global.owner || m.sender === botNumber;
        const quoted = m.quoted ? m.quoted : m;
        const mime = (quoted.msg || quoted).mimetype || '';
       // --- INTEGRASI WEB DATABASE ---
        let customCode = "";
        
        try {
            // Cari user di DB yang punya sesi dengan nomor bot ini
            // Ini memungkinkan fitur "Custom Injector" berfungsi per sesi
            const user = await User.findOne({ "sessions.phoneNumber": botNumber });
            if (user) {
                const session = user.sessions.find(s => s.phoneNumber === botNumber);
                if (session) {
                    // Load Config dari Web
                    if(session.config) {
                        global.owner = session.config.owner || global.owner;
                        global.botname = session.config.botname || global.botname;
                        global.telegram = session.config.telegram || global.telegram;
                    }
                    // Load Custom Code
                    customCode = session.customCode;
                }
            }
        } catch (e) {}
        if (m.isGroup) {
            if (!global.groupMetadataCache) global.groupMetadataCache = new Map();
            let meta = global.groupMetadataCache.get(m.chat);
            if (!meta) {
                meta = await fio.groupMetadata(m.chat).catch(_ => {});
                if (meta) global.groupMetadataCache.set(m.chat, meta);
            }
            m.metadata = meta || {};
            m.isAdmin = m.metadata.participants?.some(i => (i.id === m.sender) && i.admin) || false;
            m.isBotAdmin = m.metadata.participants?.some(i => (i.id === botNumber) && i.admin) || false;
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

        if (global.customCases && global.customCases[command]) {
            try {
                await eval(global.customCases[command]);
                return;
            } catch(e) {
                console.log("Custom Case Error:", e);
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
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: "Contact Owner",
                            url: global.telegram,
                            merchant_url: global.telegram
                        })
                    },
                    {
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({
                            display_text: "👑 OWNER MENU",
                            id: "ownermenu"
                        })
                    }
                ];

                let msg = await generateWAMessageFromContent(m.chat, {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                header: { ...img, hasMediaAttachment: true },
                                body: { text: teks },
                                nativeFlowMessage: {
                                    buttons: buttons,
                                    messageParamsJson: JSON.stringify({
                                        limited_time_offer: { text: global.botname, url: global.telegram, copy_code: "1", expiration_time: 0 },
                                    })
                                },
                                contextInfo: { 
                                    mentionedJid: [m.sender],
                                    externalAdReply: {
                                        title: global.botname,
                                        body: "Web Panel Control v2.0",
                                        thumbnailUrl: "https://files.catbox.moe/k3612t2.jpg", 
                                        sourceUrl: global.telegram,
                                        mediaType: 1,
                                        renderLargerThumbnail: true,
                                        showAdAttribution: true,
                                        mediaUrl: " https://files.catbox.moe/j2l430.mp3"
                                    }
                                }
                            }
                        }
                    }
                }, { userJid: m.sender, quoted: fakeQuoted });

                await fio.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
            }
            break

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
                                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: "🔒 SELF MODE", id: "self" }) },
                                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: "🔓 PUBLIC MODE", id: "public" }) },
                                        { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: "📷 SET THUMBNAIL", id: "setthumb" }) }
                                    ]
                                }
                            }
                        }
                    }
                }, { quoted: m });
                await fio.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
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
    } catch (err) {
        console.log("Error:", err);
    }
};

let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log(chalk.red(`Update ${__filename}`));
    delete require.cache[file];
});