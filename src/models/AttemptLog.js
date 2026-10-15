const mongoose = require('mongoose');

const AttemptLogSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  studentName: { type: String, default: null },
  errorCode: { type: String, default: null }, // null for successful attempts
  lat: Number,
  lng: Number,
  accuracy: Number,
  ip: String,
  deviceFingerprint: String,
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('AttemptLog', AttemptLogSchema);
