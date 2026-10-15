const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { signJwtForUser } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { success:false, code: 'RATE_LIMITED', message: 'Too many login attempts, try again later.' }
});

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { universityId, password } = req.body;
    if (!universityId || !password) {
      return res.status(400).json({ success:false, message: 'universityId and password required' });
    }
    const user = await User.findOne({ universityId }).exec();
    // generic failure message (do not reveal which field)
    const invalid = { success:false, message: 'Invalid credentials' };

    if (!user) return res.status(401).json(invalid);
    if (!user.isActive) return res.status(403).json({ success:false, message: 'User inactive' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json(invalid);

    const token = signJwtForUser(user);
    return res.json({ success:true, token, role: user.role, name: user.name });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ success:false, message: 'Server error' });
  }
});

// POST /auth/register (for testing only; disabled in production)
router.post('/register', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success:false, message: 'Registration disabled in production' });
  }
  try {
    const { name, universityId, password, role = 'student', department } = req.body;
    if (!name || !universityId || !password) {
      return res.status(400).json({ success:false, message: 'name, universityId and password required' });
    }
    const existing = await User.findOne({ universityId }).exec();
    if (existing) return res.status(409).json({ success:false, message: 'universityId already exists' });

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const user = await User.create({ name, universityId, passwordHash, role, department });
    return res.status(201).json({ success:true, id: user._id });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ success:false, message: 'Server error' });
  }
});

module.exports = router;
