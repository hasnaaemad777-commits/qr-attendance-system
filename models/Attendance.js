const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, required: true },
  lat: Number,
  lng: Number,
  accuracy: Number,
  distanceMeters: Number,
  deviceFingerprint: String,
  ip: String,
  timestamp: { type: Date, default: Date.now },
  status: { type: String, enum: ['present', 'excused', 'manual'], default: 'present' }
}, { timestamps: true });

// Prevent duplicate attendance for same session+student
AttendanceSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);
