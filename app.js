require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const authRoutes = require('./routes/auth');

const User = require('./models/User');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Connect to MongoDB - set MONGO_URI in env
const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/qr-attendance';
mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async ()=> {
    console.log('Mongo connected');
    await seedAdmin();
  })
  .catch(err => {
    console.error('Mongo connect error', err);
    process.exit(1);
  });

app.use('/auth', authRoutes);

app.get('/', (req,res) => res.json({ ok:true }));

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log(`Server started on port ${port}`));

// Seed admin from env on first run
async function seedAdmin() {
  try {
    const adminUniversityId = process.env.ADMIN_UNIVERSITY_ID;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminUniversityId || !adminPassword) {
      console.log('Admin credentials not provided in env; skipping admin seed.');
      return;
    }
    const existing = await User.findOne({ universityId: adminUniversityId }).exec();
    if (existing) {
      console.log('Admin user already exists; skipping seed.');
      return;
    }
    const bcrypt = require('bcrypt');
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(adminPassword, saltRounds);
    const admin = await User.create({
      name: 'Administrator',
      universityId: adminUniversityId,
      passwordHash,
      role: 'admin',
      department: 'Administration',
      isActive: true
    });
    console.log('Admin user created:', admin.universityId);
  } catch (err) {
    console.error('seedAdmin error', err);
  }
}
