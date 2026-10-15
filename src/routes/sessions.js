const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Session = require('../models/Session');
const QrToken = require('../models/QrToken');
const Attendance = require('../models/Attendance');
const Course = require('../models/Course');
const EditLog = require('../models/EditLog');
const { requireAuth, requireRole } = require('../middleware/auth');

// POST /sessions/start
router.post('/start', requireAuth, requireRole('lecturer'), async (req, res) => {
  const user = req.user;
  const { courseId, hallLat, hallLng, allowedRadiusMeters } = req.body;
  if (!courseId || hallLat === undefined || hallLng === undefined) {
    return res.status(400).json({ success:false, message: 'Missing fields' });
  }
  // Ensure lecturer owns the course
  const course = await Course.findById(courseId).exec();
  if (!course) return res.status(404).json({ success:false, message: 'Course not found' });
  if (String(course.lecturerId) !== String(user._id)) {
    return res.status(403).json({ success:false, code:'FORBIDDEN', message:'You are not the lecturer of this course' });
  }

  const session = await Session.create({
    courseId, lecturerId: user._id, hallLat, hallLng, allowedRadiusMeters
  });
  return res.status(201).json({ success:true, sessionId: session._id });
});

// GET /sessions/:id/qr
router.get('/:id/qr', requireAuth, requireRole('lecturer'), async (req, res) => {
  const user = req.user;
  const sessionId = req.params.id;
  const session = await Session.findById(sessionId).exec();
  if (!session) return res.status(404).json({ success:false, message: 'Session not found' });
  if (String(session.lecturerId) !== String(user._id)) return res.status(403).json({ success:false, code:'FORBIDDEN', message:'Only lecturer can get QR' });
  if (!session.isActive) return res.status(400).json({ success:false, code:'SESSION_NOT_ACTIVE', message: 'Session is not active' });

  // Generate token with 30s expiry
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 30_000);
  await QrToken.create({ token, sessionId: session._id, expiresAt });
  return res.json({ token, expiresAt });
});

// GET /sessions/:id/attendees (lecturer can see attendees of own session)
router.get('/:id/attendees', requireAuth, requireRole('lecturer'), async (req, res) => {
  const user = req.user;
  const sessionId = req.params.id;
  const session = await Session.findById(sessionId).exec();
  if (!session) return res.status(404).json({ success:false, message: 'Session not found' });
  if (String(session.lecturerId) !== String(user._id)) return res.status(403).json({ success:false, code:'FORBIDDEN', message:'Only lecturer can view attendees' });

  const attendees = await Attendance.find({ sessionId }).sort({ timestamp: 1 }).lean();
  return res.json({ success:true, attendees });
});

// POST /sessions/:id/end
router.post('/:id/end', requireAuth, requireRole('lecturer'), async (req, res) => {
  const user = req.user;
  const sessionId = req.params.id;
  const session = await Session.findById(sessionId).exec();
  if (!session) return res.status(404).json({ success:false, message: 'Session not found' });
  if (String(session.lecturerId) !== String(user._id)) return res.status(403).json({ success:false, code:'FORBIDDEN', message:'Only lecturer can end session' });

  session.isActive = false;
  session.endedAt = new Date();
  await session.save();
  return res.json({ success:true, message: 'Session ended' });
});

// PATCH /sessions/:id/attendees/:attendanceId/edit
router.patch('/:id/attendees/:attendanceId/edit', requireAuth, requireRole('lecturer'), async (req, res) => {
  const user = req.user;
  const sessionId = req.params.id;
  const attendanceId = req.params.attendanceId;
  const { newStatus, reason } = req.body;

  const session = await Session.findById(sessionId).exec();
  if (!session) return res.status(404).json({ success:false, message: 'Session not found' });
  if (String(session.lecturerId) !== String(user._id)) return res.status(403).json({ success:false, code:'FORBIDDEN', message:'Only lecturer can edit attendance' });

  const attendance = await Attendance.findById(attendanceId).exec();
  if (!attendance) return res.status(404).json({ success:false, message: 'Attendance not found' });

  const oldStatus = attendance.status;
  attendance.status = newStatus;
  await attendance.save();

  await EditLog.create({
    attendanceId: attendance._id,
    editorId: user._id,
    oldStatus, newStatus, reason
  });

  return res.json({ success:true, message: 'Attendance updated' });
});

module.exports = router;
