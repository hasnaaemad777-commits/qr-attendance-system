const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  lecturerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hallLat: { type: Number, required: true },
  hallLng: { type: Number, required: true },
  allowedRadiusMeters: { type: Number, default: 75 },
  isActive: { type: Boolean, default: true },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Session', SessionSchema);
