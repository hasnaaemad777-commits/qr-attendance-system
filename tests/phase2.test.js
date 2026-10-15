jest.setTimeout(30000);

/**
 * Tests for Phase 2: lecturer flow and attendance check-in validations.
 * Uses mongodb-memory-server and supertest.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;
let app; // will import after setting MONGO_URI
const User = require('../models/User');
const Course = require('../models/Course');
const Session = require('../models/Session');
const QrToken = require('../models/QrToken');
const Attendance = require('../models/Attendance');
const AttemptLog = require('../models/AttemptLog');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create({ binary: { version: '6.0.4' } });
  const uri = mongod.getUri();
  process.env.MONGO_URI = uri;
  // Import app after setting env
  app = require('../app');

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  // clean DB between tests
  const collections = Object.keys(mongoose.connection.collections);
  for (const c of collections) {
    await mongoose.connection.collections[c].deleteMany({});
  }
});

function sign(userId, role) {
  return jwt.sign({ role }, JWT_SECRET, { subject: String(userId), expiresIn: '8h' });
}

test('full successful check-in flow', async () => {
  // create lecturer, student, course, session
  const salt = await bcrypt.hash('lecpass', 10);
  const lec = await User.create({ name:'Lec', universityId:'lec1', passwordHash: salt, role:'lecturer' });
  const spass = await bcrypt.hash('studpass', 10);
  const student = await User.create({ name:'Stu', universityId:'s1', passwordHash: spass, role:'student' });

  const course = await Course.create({ name:'C1', lecturerId: lec._id, enrolledStudentIds: [student._id] });
  const session = await Session.create({ courseId: course._id, lecturerId: lec._id, hallLat: 30.0, hallLng: 31.0, allowedRadiusMeters: 200 });
  // generate token
  const token = 'tok-' + Math.random().toString(36).slice(2);
  const expiresAt = new Date(Date.now() + 30_000);
  await QrToken.create({ token, sessionId: session._id, expiresAt });

  // perform check-in
  const studentToken = sign(student._id, 'student');
  const res = await request(app)
    .post('/attendance/check-in')
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ token, lat: 30.0005, lng: 31.0, accuracy: 5, deviceFingerprint: 'fp1' })
    .expect(200);

  expect(res.body.success).toBe(true);
  const atts = await Attendance.find({}).lean();
  expect(atts.length).toBe(1);
  const logs = await AttemptLog.find({}).lean();
  expect(logs.length).toBe(1);
  expect(logs[0].errorCode).toBeNull();
});

test('TOKEN_INVALID_OR_EXPIRED when token missing', async () => {
  const spass = await bcrypt.hash('p',10);
  const student = await User.create({ name:'Stu2', universityId:'s2', passwordHash: spass, role:'student' });
  const studentToken = sign(student._id, 'student');

  const res = await request(app)
    .post('/attendance/check-in')
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ lat: 0, lng:0, accuracy: 1 })
    .expect(400);

  expect(res.body.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  const log = await AttemptLog.findOne({ studentId: student._id }).lean();
  expect(log.errorCode).toBe('TOKEN_INVALID_OR_EXPIRED');
});

test('SESSION_NOT_ACTIVE when session ended', async () => {
  const lecPass = await bcrypt.hash('lp',10);
  const lec = await User.create({ name:'L', universityId:'l1', passwordHash: lecPass, role:'lecturer' });
  const spass = await bcrypt.hash('p',10);
  const student = await User.create({ name:'S', universityId:'s3', passwordHash: spass, role:'student' });
  const course = await Course.create({ name:'C2', lecturerId: lec._id, enrolledStudentIds:[student._id] });
  const session = await Session.create({ courseId: course._id, lecturerId: lec._id, hallLat: 30, hallLng:31, isActive: false });
  const token = 't-'+Math.random().toString(36).slice(2);
  await QrToken.create({ token, sessionId: session._id, expiresAt: new Date(Date.now()+30000) });

  const studentToken = sign(student._id, 'student');
  const res = await request(app).post('/attendance/check-in')
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ token, lat:30, lng:31, accuracy:5 })
    .expect(400);

  expect(res.body.code).toBe('SESSION_NOT_ACTIVE');
});

test('NOT_ENROLLED when student not enrolled', async () => {
  const lecPass = await bcrypt.hash('lp',10);
  const lec = await User.create({ name:'L', universityId:'l2', passwordHash: lecPass, role:'lecturer' });
  const spass = await bcrypt.hash('p',10);
  const student = await User.create({ name:'S2', universityId:'s4', passwordHash: spass, role:'student' });
  const otherStudent = await User.create({ name:'S3', universityId:'s5', passwordHash: spass, role:'student' });
  const course = await Course.create({ name:'C3', lecturerId: lec._id, enrolledStudentIds:[otherStudent._id] });
  const session = await Session.create({ courseId: course._id, lecturerId: lec._id, hallLat:30, hallLng:31 });
  const token = 't2-'+Math.random().toString(36).slice(2);
  await QrToken.create({ token, sessionId: session._id, expiresAt: new Date(Date.now()+30000) });

  const studentToken = sign(student._id, 'student');
  const res = await request(app).post('/attendance/check-in')
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ token, lat:30, lng:31, accuracy:5 })
    .expect(403);

  expect(res.body.code).toBe('NOT_ENROLLED');
});

test('ALREADY_REGISTERED prevents duplicate', async () => {
  const lecPass = await bcrypt.hash('lp',10);
  const lec = await User.create({ name:'L', universityId:'l3', passwordHash: lecPass, role:'lecturer' });
  const spass = await bcrypt.hash('p',10);
  const student = await User.create({ name:'Sx', universityId:'s6', passwordHash: spass, role:'student' });
  const course = await Course.create({ name:'C4', lecturerId: lec._id, enrolledStudentIds:[student._id] });
  const session = await Session.create({ courseId: course._id, lecturerId: lec._id, hallLat:30, hallLng:31 });
  const token = 't3-'+Math.random().toString(36).slice(2);
  await QrToken.create({ token, sessionId: session._id, expiresAt: new Date(Date.now()+30000) });

  // first check-in
  const studentToken = sign(student._id, 'student');
  await request(app).post('/attendance/check-in')
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ token, lat:30, lng:31, accuracy:5 })
    .expect(200);

  // second check-in attempt with same/different token should produce ALREADY_REGISTERED
  const token2 = 't3b-'+Math.random().toString(36).slice(2);
  await QrToken.create({ token: token2, sessionId: session._id, expiresAt: new Date(Date.now()+30000) });

  const res2 = await request(app).post('/attendance/check-in')
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ token: token2, lat:30, lng:31, accuracy:5 })
    .expect(400);

  expect(res2.body.code).toBe('ALREADY_REGISTERED');
});

test('LOCATION_MISSING when missing coords', async () => {
  const spass = await bcrypt.hash('p',10);
  const student = await User.create({ name:'SM', universityId:'s7', passwordHash: spass, role:'student' });
  const lecPass = await bcrypt.hash('lp',10);
  const lec = await User.create({ name:'LZ', universityId:'l4', passwordHash: lecPass, role:'lecturer' });
  const course = await Course.create({ name:'C5', lecturerId: lec._id, enrolledStudentIds:[student._id] });
  const session = await Session.create({ courseId: course._id, lecturerId: lec._id, hallLat:30, hallLng:31 });
  const token = 't4-'+Math.random().toString(36).slice(2);
  await QrToken.create({ token, sessionId: session._id, expiresAt: new Date(Date.now()+30000) });

  const studentToken = sign(student._id, 'student');
  const res = await request(app).post('/attendance/check-in')
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ token, accuracy:5 })
    .expect(400);

  expect(res.body.code).toBe('LOCATION_MISSING');
});

test('LOCATION_SUSPICIOUS when accuracy >100', async () => {
  const spass = await bcrypt.hash('p',10);
  const student = await User.create({ name:'SS', universityId:'s8', passwordHash: spass, role:'student' });
  const lecPass = await bcrypt.hash('lp',10);
  const lec = await User.create({ name:'LL', universityId:'l5', passwordHash: lecPass, role:'lecturer' });
  const course = await Course.create({ name:'C6', lecturerId: lec._id, enrolledStudentIds:[student._id] });
  const session = await Session.create({ courseId: course._id, lecturerId: lec._id, hallLat:30, hallLng:31 });
  const token = 't5-'+Math.random().toString(36).slice(2);
  await QrToken.create({ token, sessionId: session._id, expiresAt: new Date(Date.now()+30000) });

  const studentToken = sign(student._id, 'student');
  const res = await request(app).post('/attendance/check-in')
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ token, lat:30, lng:31, accuracy:150 })
    .expect(400);

  expect(res.body.code).toBe('LOCATION_SUSPICIOUS');
});

test('OUT_OF_RANGE detection', async () => {
  const spass = await bcrypt.hash('p',10);
  const student = await User.create({ name:'SO', universityId:'s9', passwordHash: spass, role:'student' });
  const lecPass = await bcrypt.hash('lp',10);
  const lec = await User.create({ name:'LQ', universityId:'l6', passwordHash: lecPass, role:'lecturer' });
  const course = await Course.create({ name:'C7', lecturerId: lec._id, enrolledStudentIds:[student._id] });
  const session = await Session.create({ courseId: course._id, lecturerId: lec._id, hallLat:30, hallLng:31, allowedRadiusMeters: 50 });
  const token = 't6-'+Math.random().toString(36).slice(2);
  await QrToken.create({ token, sessionId: session._id, expiresAt: new Date(Date.now()+30000) });

  const studentToken = sign(student._id, 'student');
  // location far away (~200m)
  const res = await request(app).post('/attendance/check-in')
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ token, lat:30.005, lng:31.0, accuracy:5 })
    .expect(400);

  expect(res.body.code).toBe('OUT_OF_RANGE');
});

test('DEVICE_ALREADY_USED prevents same device for another student', async () => {
  const spass = await bcrypt.hash('p',10);
  const studentA = await User.create({ name:'A', universityId:'sa', passwordHash: spass, role:'student' });
  const studentB = await User.create({ name:'B', universityId:'sb', passwordHash: spass, role:'student' });
  const lecPass = await bcrypt.hash('lp',10);
  const lec = await User.create({ name:'L', universityId:'l7', passwordHash: lecPass, role:'lecturer' });
  const course = await Course.create({ name:'C8', lecturerId: lec._id, enrolledStudentIds:[studentA._id, studentB._id] });
  const session = await Session.create({ courseId: course._id, lecturerId: lec._id, hallLat:30, hallLng:31 });
  const token1 = 't7-'+Math.random().toString(36).slice(2);
  const token2 = 't7b-'+Math.random().toString(36).slice(2);
  await QrToken.create({ token: token1, sessionId: session._id, expiresAt: new Date(Date.now()+30000) });
  await QrToken.create({ token: token2, sessionId: session._id, expiresAt: new Date(Date.now()+30000) });

  const tokenA = sign(studentA._id, 'student');
  const tokenB = sign(studentB._id, 'student');

  // student A uses device fpX
  await request(app).post('/attendance/check-in')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ token: token1, lat:30, lng:31, accuracy:5, deviceFingerprint:'fpX' })
    .expect(200);

  // student B tries with same deviceFingerprint
  const resB = await request(app).post('/attendance/check-in')
    .set('Authorization', `Bearer ${tokenB}`)
    .send({ token: token2, lat:30, lng:31, accuracy:5, deviceFingerprint:'fpX' })
    .expect(400);

  expect(resB.body.code).toBe('DEVICE_ALREADY_USED');
});

test('concurrent token use: only one succeeds (race)', async () => {
  const lecPass = await bcrypt.hash('lp',10);
  const lec = await User.create({ name:'LR', universityId:'lr1', passwordHash: lecPass, role:'lecturer' });
  const spass = await bcrypt.hash('p',10);
  const s1 = await User.create({ name:'R1', universityId:'r1', passwordHash: spass, role:'student' });
  const s2 = await User.create({ name:'R2', universityId:'r2', passwordHash: spass, role:'student' });
  const course = await Course.create({ name:'CR', lecturerId: lec._id, enrolledStudentIds:[s1._id, s2._id] });
  const session = await Session.create({ courseId: course._id, lecturerId: lec._id, hallLat:30, hallLng:31, allowedRadiusMeters:200 });
  const token = 'tkconcur-'+Math.random().toString(36).slice(2);
  await QrToken.create({ token, sessionId: session._id, expiresAt: new Date(Date.now()+30000) });

  const t1 = sign(s1._id, 'student');
  const t2 = sign(s2._id, 'student');

  // Fire two requests almost simultaneously
  const p1 = request(app).post('/attendance/check-in').set('Authorization', `Bearer ${t1}`)
    .send({ token, lat:30, lng:31, accuracy:5, deviceFingerprint:'fpR1' });
  const p2 = request(app).post('/attendance/check-in').set('Authorization', `Bearer ${t2}`)
    .send({ token, lat:30, lng:31, accuracy:5, deviceFingerprint:'fpR2' });

  const [r1, r2] = await Promise.all([p1, p2]);

  const successes = [r1, r2].filter(r => r.status === 200 && r.body.success);
  const failures = [r1, r2].filter(r => !(r.status === 200 && r.body.success));
  expect(successes.length).toBe(1);
  expect(failures.length).toBe(1);
  // failure should be TOKEN_INVALID_OR_EXPIRED or ALREADY_REGISTERED depending on timing
  expect(['TOKEN_INVALID_OR_EXPIRED','ALREADY_REGISTERED','DEVICE_ALREADY_USED','OUT_OF_RANGE']).toContain(failures[0].body.code);
});
