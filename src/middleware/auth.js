const jwt = require('jsonwebtoken');
const User = require('../models/User');

const jwtSecret = process.env.JWT_SECRET || 'change-me';
const jwtExpiresIn = '8h';

function signJwtForUser(user) {
  const payload = { role: user.role };
  return jwt.sign(payload, jwtSecret, { subject: String(user._id), expiresIn: jwtExpiresIn });
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success:false, code:'AUTH_REQUIRED', message: 'Authentication required' });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, jwtSecret);
    const userId = payload.sub;
    const user = await User.findById(userId).exec();
    if (!user || !user.isActive) {
      return res.status(401).json({ success:false, code:'AUTH_REQUIRED', message: 'Invalid or inactive user' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success:false, code:'AUTH_INVALID', message: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success:false, code:'AUTH_REQUIRED', message: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success:false, code:'FORBIDDEN', message: 'Insufficient role' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, signJwtForUser };
