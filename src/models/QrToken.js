const mongoose = require('mongoose');

const QrTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now }
});

// TTL index: Mongo will remove expired tokens
QrTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('QrToken', QrTokenSchema);
