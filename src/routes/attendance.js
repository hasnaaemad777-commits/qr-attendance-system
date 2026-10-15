const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const QrToken = require('../models/QrToken');
const SessionModel = require('../models/Session');
const Course = require('../models/Course');
const Attendance = require('../models/Attendance');
const AttemptLog = require('../models/AttemptLog');
const { distanceMeters } = require('../utils/haversine');
const { requireAuth, requireRole } = require('../middleware/auth');
const { checkinLimiter } = require('../middleware/rateLimiter');

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || null;
}

// Helper to log an attempt (async, don't block response)
async function logAttempt(data) {
  try {
    await AttemptLog.create(data);
  } catch (err) {
    console.error('AttemptLog error', err);
  }
}

// POST /attendance/check-in
router.post('/check-in', requireAuth, requireRole('student'), checkinLimiter, async (req, res) => {
  const user = req.user;
  const { token, lat, lng, accuracy, deviceFingerprint, isMock } = req.body;
  const ip = getIp(req);

  const now = new Date();

  // 1. TOKEN_INVALID_OR_EXPIRED
  if (!token) {
    await logAttempt({ studentId: user._id, studentName: user.name, errorCode: 'TOKEN_INVALID_OR_EXPIRED', ip, deviceFingerprint, timestamp: now });
    return res.status(400).json({ success:false, code:'TOKEN_INVALID_OR_EXPIRED', message: 'Token missing' });
  }

  const tokenDoc = await QrToken.findOne({ token }).exec();
  if (!tokenDoc || tokenDoc.expiresAt <= now || tokenDoc.usedBy) {
    await logAttempt({ studentId: user._id, studentName: user.name, errorCode: 'TOKEN_INVALID_OR_EXPIRED', ip, deviceFingerprint, timestamp: now });
    return res.status(400).json({ success:false, code:'TOKEN_INVALID_OR_EXPIRED', message: 'Token invalid, expired, or used' });
  }

  // 2. SESSION_NOT_ACTIVE
  const session = await SessionModel.findById(tokenDoc.sessionId).exec();
  if (!session || !session.isActive) {
    await logAttempt({ sessionId: tokenDoc.sessionId, studentId: user._id, studentName: user.name, errorCode: 'SESSION_NOT_ACTIVE', ip, deviceFingerprint, timestamp: now });
    return res.status(400).json({ success:false, code:'SESSION_NOT_ACTIVE', message: 'Session not active' });
  }

  // 3. NOT_ENROLLED
  const course = await Course.findById(session.courseId).lean().exec();
  if (!course) {
    await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: 'NOT_ENROLLED', ip, deviceFingerprint, timestamp: now });
    return res.status(400).json({ success:false, code:'NOT_ENROLLED', message: 'Course not found' });
  }
  if (!course.enrolledStudentIds.map(String).includes(String(user._id))) {
    await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: 'NOT_ENROLLED', ip, deviceFingerprint, timestamp: now });
    return res.status(403).json({ success:false, code:'NOT_ENROLLED', message: 'Student not enrolled in course' });
  }

  // 4. ALREADY_REGISTERED
  const existing = await Attendance.findOne({ sessionId: session._id, studentId: user._id }).lean().exec();
  if (existing) {
    await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: 'ALREADY_REGISTERED', ip, deviceFingerprint, timestamp: now });
    return res.status(400).json({ success:false, code:'ALREADY_REGISTERED', message: 'Already registered' });
  }

  // 5. LOCATION_MISSING
  if (lat === undefined || lng === undefined) {
    await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: 'LOCATION_MISSING', ip, deviceFingerprint, timestamp: now });
    return res.status(400).json({ success:false, code:'LOCATION_MISSING', message: 'Location required' });
  }

  // 6. LOCATION_SUSPICIOUS
  if (typeof accuracy !== 'number' || accuracy > 100 || accuracy <= 0 || isMock === true) {
    await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: 'LOCATION_SUSPICIOUS', lat, lng, accuracy, ip, deviceFingerprint, timestamp: now });
    return res.status(400).json({ success:false, code:'LOCATION_SUSPICIOUS', message: 'Location accuracy unacceptable or mock detected' });
  }

  // 7. OUT_OF_RANGE
  const dist = distanceMeters(session.hallLat, session.hallLng, lat, lng);
  if (dist > (session.allowedRadiusMeters || 75)) {
    await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: 'OUT_OF_RANGE', lat, lng, accuracy, ip, deviceFingerprint, timestamp: now });
    return res.status(400).json({ success:false, code:'OUT_OF_RANGE', message: 'Out of allowed range', distanceMeters: dist });
  }

  // 8. DEVICE_ALREADY_USED
  if (deviceFingerprint) {
    const dupe = await Attendance.findOne({ sessionId: session._id, deviceFingerprint, studentId: { $ne: user._id } }).lean().exec();
    if (dupe) {
      await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: 'DEVICE_ALREADY_USED', lat, lng, accuracy, ip, deviceFingerprint, timestamp: now });
      return res.status(400).json({ success:false, code:'DEVICE_ALREADY_USED', message: 'Device already used by another student' });
    }
  }

  // All checks passed. Atomically mark token used and insert attendance.
  const mongoSession = await mongoose.startSession();
  mongoSession.startTransaction();
  try {
    // Try to mark token used
    const updatedToken = await QrToken.findOneAndUpdate(
      { _id: tokenDoc._id, usedBy: null, expiresAt: { $gt: new Date() } },
      { $set: { usedBy: user._id } },
      { new: true, session: mongoSession }
    ).exec();

    if (!updatedToken) {
      await mongoSession.abortTransaction();
      mongoSession.endSession();
      await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: 'TOKEN_INVALID_OR_EXPIRED', lat, lng, accuracy, ip, deviceFingerprint, timestamp: now });
      return res.status(400).json({ success:false, code:'TOKEN_INVALID_OR_EXPIRED', message: 'Token invalid or used concurrently' });
    }

    // Create attendance
    const attendanceDoc = await Attendance.create([{
      sessionId: session._id,
      studentId: user._id,
      studentName: user.name,
      lat, lng, accuracy, distanceMeters: Math.round(dist),
      deviceFingerprint: deviceFingerprint || null,
      ip,
      status: 'present'
    }], { session: mongoSession });

    await mongoSession.commitTransaction();
    mongoSession.endSession();

    // Log successful attempt
    await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: null, lat, lng, accuracy, ip, deviceFingerprint, timestamp: now });

    return res.json({ success:true, message: 'Attendance registered successfully', courseName: course.name, timestamp: attendanceDoc[0].timestamp });
  } catch (err) {
    await mongoSession.abortTransaction();
    mongoSession.endSession();

    // Handle duplicate key for unique attendance index
    if (err && err.code === 11000) {
      await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: 'ALREADY_REGISTERED', lat, lng, accuracy, ip, deviceFingerprint, timestamp: now });
      return res.status(400).json({ success:false, code:'ALREADY_REGISTERED', message: 'Already registered (race prevented duplicate)' });
    }

    console.error('check-in error', err);
    await logAttempt({ sessionId: session._id, studentId: user._id, studentName: user.name, errorCode: 'SERVER_ERROR', lat, lng, accuracy, ip, deviceFingerprint, timestamp: now });
    return res.status(500).json({ success:false, code:'SERVER_ERROR', message: 'Internal error' });
  }
});

module.exports = router;
