// One-off seed script: creates usertest1@gmail.com with a week of diet logs for local testing.
// Run from server/ so relative model requires resolve, with the server's own env loaded.
const path = require('path');
const SERVER_DIR = '/Users/chentaian/Documents/SP/server';
require('dotenv').config({ path: path.join(SERVER_DIR, '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require(path.join(SERVER_DIR, 'models/User'));
const DailyLog = require(path.join(SERVER_DIR, 'models/DailyLog'));
const Counter = require(path.join(SERVER_DIR, 'models/Counter'));
const { nextUserId } = require(path.join(SERVER_DIR, 'services/userIds'));

const EMAIL = 'usertest1@gmail.com';
const PASSWORD = 'usertest1';

const SAMPLE_DAYS = [
  {
    offsetDays: 0,
    weight: 68.5,
    target: 2000,
    meals: [
      { name: '奶茶吐司', energy: 320, protein: 8, carbs: 45, fat: 12, mealType: 'breakfast', time: 8 * 60 + 15 },
      { name: 'Pad Thai', energy: 181, protein: 6, carbs: 27, fat: 5.4, mealType: 'lunch', time: 12 * 60 + 30 },
      { name: '滷肉飯', energy: 560, protein: 22, carbs: 70, fat: 18, mealType: 'dinner', time: 19 * 60 },
      { name: '香蕉', energy: 105, protein: 1.3, carbs: 27, fat: 0.4, mealType: 'snacks', time: 15 * 60 },
    ],
  },
  {
    offsetDays: 1,
    weight: 68.3,
    target: 2000,
    meals: [
      { name: '燕麥粥', energy: 250, protein: 9, carbs: 40, fat: 6, mealType: 'breakfast', time: 7 * 60 + 45 },
      { name: 'Margherita pizza', energy: 720, protein: 28, carbs: 85, fat: 30, mealType: 'lunch', time: 13 * 60 },
      { name: '牛肉麵', energy: 610, protein: 30, carbs: 65, fat: 20, mealType: 'dinner', time: 19 * 60 + 30 },
    ],
  },
  {
    offsetDays: 2,
    weight: 68.4,
    target: 2000,
    meals: [
      { name: '茶葉蛋', energy: 78, protein: 6.5, carbs: 0.6, fat: 5.3, mealType: 'breakfast', time: 8 * 60 },
      { name: '雞胸肉沙拉', energy: 350, protein: 35, carbs: 15, fat: 14, mealType: 'lunch', time: 12 * 60 + 15 },
      { name: '壽司拼盤', energy: 480, protein: 20, carbs: 75, fat: 8, mealType: 'dinner', time: 18 * 60 + 50 },
      { name: '優格', energy: 120, protein: 10, carbs: 14, fat: 3, mealType: 'snacks', time: 16 * 60 },
    ],
  },
];

function toDateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/calorieDB');
  console.log('MongoDB connected');

  let user = await User.findOne({ email: EMAIL });
  if (!user) {
    user = await User.create({
      userId: await nextUserId(Counter.collection, User.collection),
      email: EMAIL,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      gender: 'female',
      age: 27,
      height: 165,
      weight: 68.5,
      activity: 'moderate',
      goal: 'cut',
      bmr: 1450,
      tdee: 2000,
      target: 2000,
      status: 'Active',
    });
    console.log('Created user:', user.userId, user.email);
  } else {
    user.passwordHash = await bcrypt.hash(PASSWORD, 10);
    await user.save();
    console.log('User already existed, reset password:', user.userId, user.email);
  }

  for (const day of SAMPLE_DAYS) {
    const date = toDateStr(day.offsetDays);
    await DailyLog.updateOne(
      { userId: user._id, date },
      { $set: { weight: day.weight, target: day.target, meals: day.meals } },
      { upsert: true }
    );
    console.log('Seeded log for', date, '-', day.meals.length, 'meals');
  }

  console.log('\nDone. Login with:', EMAIL, '/', PASSWORD);
  console.log('Admin panel: search this email on the Users page to jump to Records.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
