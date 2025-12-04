require("./settings.js");
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore, 
    makeCacheableSignalKeyStore
} = require("@skyzopedia/baileys-mod");
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const socketIO = require('socket.io');
const http = require('http');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const rimraf = require('rimraf');
const bcrypt = require('bcryptjs');
const qrcode = require('qrcode');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const multer = require('multer');
const User = require('./models/user');
const Transaction = require('./models/transaction');
const { serialize } = require("./lib/serialize.js");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const PORT = process.env.PORT || 8080;
const MONGO_URI = 'mongodb+srv://maverickuniverse405:1m8MIgmKfK2QwBNe@cluster0.il8d4jx.mongodb.net/digi?appName=Cluster0';
const PAKASIR_SLUG = 'wanzofc'; 

global.groupMetadataCache = new Map();

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'fiona-secret-key-secure',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const activeConnections = new Map();
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

const startBaileys = async (userId, sessionId, socketToEmit = null, phoneNumber = null) => {
    const sessionPath = path.join(__dirname, 'sessions', `${userId}_${sessionId}`);
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const fio = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => (store.loadMessage(key.remoteJid, key.id) || {}).message || { conversation: "Hello World" }
    });

    store.bind(fio.ev);

    if (phoneNumber && !fio.authState.creds.registered) {
        const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
        setTimeout(async () => {
            try {
                let code = await fio.requestPairingCode(cleanPhone);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                if (socketToEmit) socketToEmit.emit('pairing-code', { sessionId, code });
            } catch (err) {}
        }, 3000);
    }

    fio.ev.on("creds.update", saveCreds);

    fio.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        const user = await User.findOne({ _id: userId });
        const sessionData = user.sessions.find(s => s.sessionId === sessionId);
        if (connection === 'open') {
            const botPhoneNumber = fio.user.id.split(':')[0] + '@s.whatsapp.net';
            await User.findOneAndUpdate(
                { _id: userId, "sessions.sessionId": sessionId },
                { "$set": { "sessions.$.status": "connected", "sessions.$.phoneNumber": botPhoneNumber } }
            );
            if (socketToEmit) socketToEmit.emit('connection-status', { sessionId, status: 'connected' });
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                startBaileys(userId, sessionId, socketToEmit);
            } else {
                await User.findOneAndUpdate(
                    { _id: userId, "sessions.sessionId": sessionId },
                    { "$set": { "sessions.$.status": "disconnected" } }
                );
                rimraf.sync(sessionPath);
                activeConnections.delete(`${userId}_${sessionId}`);
            }
        }
    });

    fio.ev.on("messages.upsert", async ({ messages }) => {
        try {
            const msg = messages[0];
            if (!msg.message || msg.key.remoteJid === "status@broadcast") return;
            const m = await serialize(fio, msg, store);
            require('./message.js')(fio, m, store);
        } catch (e) {}
    });

    fio.store = store;
    activeConnections.set(`${userId}_${sessionId}`, fio);
};

app.get('/', (req, res) => res.render('landing'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/register', (req, res) => res.render('register'));
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const authMiddleware = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

app.get('/dashboard', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('dashboard', { user, success: req.query.success, error: req.query.error });
});

app.get('/profile', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profile', { user });
});

app.get('/settings', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('settings', { user });
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ username, email, password: hashedPassword });
        res.redirect('/login');
    } catch (e) { res.redirect('/register'); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (user && await bcrypt.compare(password, user.password)) {
            if (user.twoFactorEnabled) {
                req.session.tempUserId = user._id;
                return res.render('2fa-verify', { error: null });
            }
            req.session.userId = user._id;
            res.redirect('/dashboard');
        } else {
            res.render('login', { error: 'Invalid credentials' });
        }
    } catch (e) { res.redirect('/login'); }
});

app.post('/login/verify-2fa', async (req, res) => {
    const { token } = req.body;
    if (!req.session.tempUserId) return res.redirect('/login');
    const user = await User.findById(req.session.tempUserId);
    if (authenticator.check(token, user.twoFactorSecret)) {
        req.session.userId = user._id;
        delete req.session.tempUserId;
        res.redirect('/dashboard');
    } else {
        res.render('2fa-verify', { error: 'Invalid OTP' });
    }
});

app.post('/session/save-code', authMiddleware, async (req, res) => {
    const { sessionId, customCode } = req.body;
    await User.updateOne({ _id: req.session.userId, "sessions.sessionId": sessionId }, { $set: { "sessions.$.customCode": customCode } });
    res.redirect('/dashboard');
});

app.post('/profile/update', authMiddleware, async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, req.body);
    res.redirect('/profile');
});

app.post('/session/update-config', authMiddleware, async (req, res) => {
    const { sessionId, ...config } = req.body;
    await User.updateOne(
        { _id: req.session.userId, "sessions.sessionId": sessionId },
        { "$set": { "sessions.$.config": config } }
    );
    res.redirect('/dashboard');
});

app.post('/broadcast/jpm', authMiddleware, upload.single('image'), async (req, res) => {
    const { sessionId, text } = req.body;
    const userId = req.session.userId;

    const fio = activeConnections.get(`${userId}_${sessionId}`);
    if (!fio) return res.redirect('/dashboard?error=Bot tidak aktif atau tidak ditemukan.');

    const user = await User.findById(userId);
    const sessionData = user.sessions.find(s => s.sessionId === sessionId);
    const delay = sessionData.config.jedaJpm || 4000;

    try {
        const contacts = Object.values(fio.store.contacts)
            .filter(c => c.id.endsWith('@s.whatsapp.net'))
            .map(c => c.id);

        if (contacts.length === 0) return res.redirect('/dashboard?error=Tidak ada kontak yang ditemukan.');

        let messageData = {};
        if (req.file) {
            messageData = { 
                image: { url: req.file.path }, 
                caption: text,
                mimetype: req.file.mimetype 
            };
        } else {
            messageData = { text: text };
        }

        for (const contact of contacts) {
            await fio.sendMessage(contact, messageData);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        if (req.file) fs.unlinkSync(req.file.path);

        res.redirect('/dashboard?success=JPM berhasil dikirim ke ' + contacts.length + ' kontak.');
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.redirect('/dashboard?error=Gagal mengirim JPM: ' + error.message);
    }
});


app.post('/settings/change-password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) return res.redirect('/settings?error=Mismatch');
    const user = await User.findById(req.session.userId);
    if (!await bcrypt.compare(currentPassword, user.password)) return res.redirect('/settings?error=WrongPass');
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.session.userId, { password: hashedPassword });
    res.redirect('/settings?success=Changed');
});

app.post('/settings/2fa/generate', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const secret = authenticator.generateSecret();
    req.session.tempSecret = secret;
    const otpauth = authenticator.keyuri(user.email, 'FionaBot', secret);
    qrcode.toDataURL(otpauth, (err, imageUrl) => err ? res.status(500) : res.json({ qrCode: imageUrl }));
});

app.post('/settings/2fa/enable', authMiddleware, async (req, res) => {
    const { token } = req.body;
    if (authenticator.verify({ token, secret: req.session.tempSecret })) {
        await User.findByIdAndUpdate(req.session.userId, { twoFactorSecret: req.session.tempSecret, twoFactorEnabled: true });
        delete req.session.tempSecret;
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post('/settings/2fa/disable', authMiddleware, async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { twoFactorSecret: null, twoFactorEnabled: false });
    res.json({ success: true });
});

app.post('/payment/upgrade', authMiddleware, async (req, res) => {
    const orderId = 'UPG-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await Transaction.create({ orderId, userId: req.session.userId, type: 'upgrade', amount: 5000 });
    res.redirect(`https://app.pakasir.com/pay/${PAKASIR_SLUG}/5000?order_id=${orderId}`);
});

app.post('/payment/donate', authMiddleware, async (req, res) => {
    let { amount } = req.body;
    amount = parseInt(amount);
    if (!amount || amount < 1000) return res.redirect('/dashboard?error=Min1000');
    const orderId = 'DON-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await Transaction.create({ orderId, userId: req.session.userId, type: 'donation', amount });
    res.redirect(`https://app.pakasir.com/pay/${PAKASIR_SLUG}/${amount}?order_id=${orderId}`);
});

app.post('/webhook/pakasir', async (req, res) => {
    const { order_id, status } = req.body;
    if (status === 'completed') {
        const trx = await Transaction.findOneAndUpdate({ orderId: order_id, status: 'pending' }, { status: 'completed' });
        if (trx && trx.type === 'upgrade') {
            await User.findByIdAndUpdate(trx.userId, { isPremium: true, maxSessions: 10 });
        }
    }
    res.json({ status: 'ok' });
});

io.on('connection', (socket) => {
    socket.on('create-session', async ({ userId, phoneNumber }) => {
        const user = await User.findById(userId);
        if (user.sessions.length >= user.maxSessions) return socket.emit('error', 'Limit Sesi Tercapai');
        const newSessionId = 'sess_' + Date.now();
        user.sessions.push({ sessionId: newSessionId, phoneNumber, status: 'connecting' });
        await user.save();
        startBaileys(userId, newSessionId, socket, phoneNumber);
    });

    socket.on('delete-session', async ({ userId, sessionId }) => {
        const sock = activeConnections.get(`${userId}_${sessionId}`);
        if (sock) sock.end(undefined);
        rimraf.sync(path.join(__dirname, 'sessions', `${userId}_${sessionId}`));
        await User.updateOne({ _id: userId }, { $pull: { sessions: { sessionId } } });
        socket.emit('session-deleted', sessionId);
    });
});

const restoreSessions = async () => {
    const users = await User.find({});
    for (const user of users) {
        for (const sess of user.sessions) {
            const sessionFile = path.join(__dirname, 'sessions', `${user._id}_${sess.sessionId}`, 'creds.json');
            if (fs.existsSync(sessionFile)) {
                 startBaileys(user._id, sess.sessionId);
            } else {
                 await User.updateOne({ _id: user._id, "sessions.sessionId": sess.sessionId }, { "$set": { "sessions.$.status": "disconnected" } });
            }
        }
    }
};

const startServer = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB Connected');
        server.listen(PORT, async () => {
            console.log(`Server running on port ${PORT}`);
            await restoreSessions();
            console.log('Sessions Restored');
        });
    } catch (err) {
        console.error('DB Connection Error', err);
    }
};

startServer();
