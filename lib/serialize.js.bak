const { proto, getContentType, jidDecode, downloadContentFromMessage } = require("@skyzopedia/baileys-mod");
const fs = require('fs');

const downloadMedia = async (message, pathFile) => {
	const type = Object.keys(message)[0];
	const mime = message[type].mimetype;
	const stream = await downloadContentFromMessage(message[type], type.replace('Message', ''));
	let buffer = Buffer.from([]);
	for await (const chunk of stream) {
		buffer = Buffer.concat([buffer, chunk]);
	}
	if (pathFile) await fs.promises.writeFile(pathFile, buffer);
	return buffer;
}

const decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {};
        return decode.user && decode.server ? `${decode.user}@${decode.server}` : jid;
    }
    return jid;
};

exports.serialize = async (conn, m, store) => {
    if (!m) return m;
    let M = proto.WebMessageInfo;
    m = M.fromObject(m);
    if (m.key) {
        m.id = m.key.id;
        m.isBaileys = m.id.startsWith("BAE5") && m.id.length === 16;
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat.endsWith("@g.us");
        m.sender = m.fromMe ? (conn.user.id.split(":")[0] + "@s.whatsapp.net" || conn.user.id) : (m.key.participant || m.key.remoteJid);
        m.sender = decodeJid(m.sender);
    }
    if (m.message) {
        m.mtype = getContentType(m.message);
        m.msg = (m.mtype == 'viewOnceMessage' ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)] : m.message[m.mtype]);
        
        // Membaca text dari berbagai tipe pesan (conversation, image, extended, dll)
        m.body = m.message.conversation || m.msg.caption || m.msg.text || (m.mtype == 'listResponseMessage') && m.msg.singleSelectReply.selectedRowId || (m.mtype == 'buttonsResponseMessage') && m.msg.selectedButtonId || (m.mtype == 'viewOnceMessage') && m.msg.caption || m.text;
        
        // Prefix otomatis
        m.prefix = /^[°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©^]/gi.test(m.body) ? m.body.match(/^[°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©^]/gi)[0] : '';
        
        m.text = m.msg.text || m.msg.caption || m.message.conversation || m.msg.contentText || m.msg.selectedDisplayText || m.msg.title || "";
        
        m.reply = (text, chatId = m.chat, options = {}) => Buffer.isBuffer(text) ? conn.sendFile(chatId, text, 'file', '', m, { ...options }) : conn.sendMessage(chatId, { text: text }, { quoted: m, ...options });
        
        m.download = () => downloadMedia(m.message);
    }
    return m;
};