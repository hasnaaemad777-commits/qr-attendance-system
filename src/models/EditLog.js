const mongoose = require('mongoose');

const EditLogSchema = new mongoose.Schema({
  attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance' },
  editorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  oldStatus: String,
  newStatus: String,
  reason: String,
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('EditLog', EditLogSchema);
