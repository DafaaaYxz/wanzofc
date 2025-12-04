const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    phoneNumber: { type: String, default: '' },
    status: { type: String, default: 'disconnected' },
    lastActive: { type: Date, default: Date.now },
    customCode: { type: String, default: '' }, 
    config: {
        owner: { type: String, default: '6289526346592' },
        botname: { type: String, default: 'FIONA BOT' },
        telegram: { type: String, default: 'https://t.me/maverick_dar' },
        linkgroup: { type: String, default: 'https://chat.whatsapp.com/...' },
        jedaPushkontak: { type: Number, default: 5000 },
        jedaJpm: { type: Number, default: 4000 },
        dana: { type: String, default: '0888xxx' },
        ovo: { type: String, default: 'Tidak tersedia' },
        gopay: { type: String, default: 'Tidak tersedia' }
    }
});

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    profilePic: { type: String, default: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' },
    isPremium: { type: Boolean, default: false },
    maxSessions: { type: Number, default: 2 },
    twoFactorSecret: { type: String, default: null },
    twoFactorEnabled: { type: Boolean, default: false },
    sessions: [SessionSchema]
});

module.exports = mongoose.model('User', UserSchema);