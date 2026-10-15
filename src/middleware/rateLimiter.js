const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { success:false, code: 'RATE_LIMITED', message: 'Too many login attempts, try again later.' }
});

const checkinLimiter = rateLimit({
  windowMs: 15 * 1000, // 15 seconds
  max: 10,
  message: { success:false, code: 'RATE_LIMITED', message: 'Too many check-in attempts, try again later.' }
});

module.exports = { loginLimiter, checkinLimiter };
