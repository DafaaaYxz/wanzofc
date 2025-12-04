require("./settings.js");
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore, 
    makeCacheableSignalKeyStore,
    Browsers
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
const User = require('./models/user');
const Transaction = require('./models/transaction');
const { serialize } = require("./lib/serialize.js");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const PORT = process.env.PORT || 3000;
const MONGO_URI = 'mongodb+srv://maverickuniverse405:1m8MIgmKfK2QwBNe@cluster0.il8d4jx.mongodb.net/digi?appName=Cluster0';
const PAKASIR_SLUG = 'wanzofc'; 

global.groupMetadataCache = new Map();

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
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg.message || undefined;
            }
            return { conversation: "Hello World" };
        }
    });

    store.bind(fio.ev);

    if (phoneNumber && !fio.authState.creds.registered) {
        const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
        setTimeout(async () => {
            try {
                let code = await fio.requestPairingCode(cleanPhone);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                if(socketToEmit) socketToEmit.emit('pairing-code', { sessionId, code });
            } catch (err) {}
        }, 3000);
    }

    fio.ev.on("creds.update", saveCreds);

    fio.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            await User.findOneAndUpdate(
                { _id: userId, "sessions.sessionId": sessionId },
                { "$set": { "sessions.$.status": "connected" } }
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
            if (!msg.message) return;
            if (msg.key.remoteJid === "status@broadcast") return;
            
            const m = await serialize(fio, msg, store);
            const messageHandler = require('./message.js');
            if (typeof messageHandler === 'function') await messageHandler(fio, m);
        } catch (e) {
            // Suppress error agar server tidak mati
        }
    });

    activeConnections.set(`${userId}_${sessionId}`, fio);
};

// --- ROUTES ---

app.get('/', (req, res) => res.render('landing'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/register', (req, res) => res.render('register'));

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    res.render('dashboard', { user });
});

app.get('/profile', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    res.render('profile', { user });
});

app.get('/settings', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
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
app.post('/session/save-code', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { sessionId, customCode } = req.body;
    
    // Simpan kode ke database
    await User.updateOne(
        { _id: req.session.userId, "sessions.sessionId": sessionId },
        { $set: { "sessions.$.customCode": customCode } }
    );
   
    res.redirect('/dashboard');
});
app.post('/profile/update', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    await User.findByIdAndUpdate(req.session.userId, req.body);
    res.redirect('/profile');
});

app.post('/session/update-config', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { sessionId, ...config } = req.body;
    await User.updateOne(
        { _id: req.session.userId, "sessions.sessionId": sessionId },
        { 
            $set: {
                "sessions.$.config.botname": config.botname,
                "sessions.$.config.owner": config.owner,
                "sessions.$.config.telegram": config.telegram,
                "sessions.$.config.linkgroup": config.linkgroup,
                "sessions.$.config.jedaPushkontak": config.jedaPushkontak,
                "sessions.$.config.jedaJpm": config.jedaJpm
            }
        }
    );
    res.redirect('/dashboard');
});

app.post('/settings/change-password', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) return res.redirect('/settings?error=Mismatch');
    const user = await User.findById(req.session.userId);
    if (!await bcrypt.compare(currentPassword, user.password)) return res.redirect('/settings?error=WrongPass');
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.session.userId, { password: hashedPassword });
    res.redirect('/settings?success=Changed');
});

app.post('/settings/2fa/generate', async (req, res) => {
    if (!req.session.userId) return res.status(401);
    const user = await User.findById(req.session.userId);
    const secret = authenticator.generateSecret();
    req.session.tempSecret = secret;
    const otpauth = authenticator.keyuri(user.email, 'FionaBot', secret);
    qrcode.toDataURL(otpauth, (err, imageUrl) => {
        if (err) return res.status(500);
        res.json({ qrCode: imageUrl, secret });
    });
});

app.post('/settings/2fa/enable', async (req, res) => {
    if (!req.session.userId) return res.status(401);
    const { token } = req.body;
    if (authenticator.verify({ token, secret: req.session.tempSecret })) {
        await User.findByIdAndUpdate(req.session.userId, { twoFactorSecret: req.session.tempSecret, twoFactorEnabled: true });
        delete req.session.tempSecret;
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post('/settings/2fa/disable', async (req, res) => {
    if (!req.session.userId) return res.status(401);
    await User.findByIdAndUpdate(req.session.userId, { twoFactorSecret: null, twoFactorEnabled: false });
    res.json({ success: true });
});

app.post('/payment/upgrade', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const orderId = 'UPG-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const amount = 5000;
    await Transaction.create({ orderId, userId: req.session.userId, type: 'upgrade', amount });
    res.redirect(`https://app.pakasir.com/pay/${PAKASIR_SLUG}/${amount}?order_id=${orderId}`);
});

app.post('/payment/donate', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    let { amount } = req.body;
    amount = parseInt(amount);
    if (!amount || amount < 1000) return res.redirect('/dashboard?error=Min1000');
    const orderId = 'DON-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await Transaction.create({ orderId, userId: req.session.userId, type: 'donation', amount });
    res.redirect(`https://app.pakasir.com/pay/${PAKASIR_SLUG}/${amount}?order_id=${orderId}`);
});

app.post('/webhook/pakasir', async (req, res) => {
    const { order_id, status } = req.body;
    if (!order_id || !status) return res.json({ status: 'ignored' });
    if (status === 'completed') {
        const trx = await Transaction.findOne({ orderId: order_id });
        if (trx && trx.status === 'pending') {
            trx.status = 'completed';
            await trx.save();
            if (trx.type === 'upgrade') {
                await User.findByIdAndUpdate(trx.userId, { isPremium: true, maxSessions: 10 });
            }
            return res.json({ status: 'success' });
        }
    }
    res.json({ status: 'ok' });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

io.on('connection', (socket) => {
    socket.on('create-session', async (data) => {
        const { userId, phoneNumber } = data;
        const user = await User.findById(userId);
        const limit = user.isPremium ? 10 : 2;
        if(user.sessions.length >= limit) { socket.emit('error', 'Limit Reached'); return; }
        const newSessionId = 'sess_' + Date.now();
        user.sessions.push({ sessionId: newSessionId, phoneNumber, status: 'connecting' });
        await user.save();
        startBaileys(userId, newSessionId, socket, phoneNumber);
    });

    socket.on('delete-session', async (data) => {
        const { userId, sessionId } = data;
        const sock = activeConnections.get(`${userId}_${sessionId}`);
        if(sock) sock.end(undefined);
        rimraf.sync(path.join(__dirname, 'sessions', `${userId}_${sessionId}`));
        await User.updateOne({ _id: userId }, { $pull: { sessions: { sessionId } } });
        socket.emit('session-deleted', sessionId);
    });
});

const restoreSessions = async () => {
    const users = await User.find({});
    users.forEach(user => {
        user.sessions.forEach(sess => {
            if(sess.status === 'connected' || sess.status === 'connecting') {
                startBaileys(user._id, sess.sessionId);
            }
        });
    });
};

const startServer = async () => {
    try {
        await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 5000 });
        console.log('✅ MongoDB Connected');
        server.listen(PORT, async () => {
            console.log(`🚀 Server running on port ${PORT}`);
            try {
                await restoreSessions();
                console.log('✅ Sessions Restored');
            } catch (err) {}
        });
    } catch (err) {
        console.log('❌ DB Error');
    }
};

startServer();