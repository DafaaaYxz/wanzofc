const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ['upgrade', 'donation'], required: true },
    amount: { type: Number, required: true },
    status: { type: String, default: 'pending' },
   
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', TransactionSchema);