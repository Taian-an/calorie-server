// 常見泰式料理的營養對照表（每 100g 估計值，非實驗室量測，僅供參考）
// USDA 資料庫對泰式家常菜/街邊小吃覆蓋度很差，這份表在查 USDA 之前優先比對
const THAI_FOODS = [
  { name: 'Pad Thai', energy: 181, protein: 6, carbs: 27, fat: 5.4,
    aliases: ['pad thai', 'phad thai', 'thai fried noodles'] },
  { name: 'Tom Yum Goong', energy: 50, protein: 5, carbs: 3, fat: 1.5,
    aliases: ['tom yum', 'tom yum goong', 'tom yum soup', 'spicy shrimp soup'] },
  { name: 'Som Tam (Papaya Salad)', energy: 65, protein: 2, carbs: 13, fat: 1,
    aliases: ['som tam', 'som tum', 'papaya salad', 'green papaya salad'] },
  { name: 'Pad Kra Pao', energy: 150, protein: 12, carbs: 8, fat: 8,
    aliases: ['pad kra pao', 'pad krapow', 'krapow', 'thai basil stir fry', 'holy basil stir fry'] },
  { name: 'Khao Pad (Thai Fried Rice)', energy: 163, protein: 4, carbs: 25, fat: 5,
    aliases: ['khao pad', 'thai fried rice'] },
  { name: 'Massaman Curry', energy: 140, protein: 8, carbs: 8, fat: 9,
    aliases: ['massaman curry', 'massaman'] },
  { name: 'Green Curry', energy: 125, protein: 7, carbs: 6, fat: 8.5,
    aliases: ['green curry', 'kaeng khiao wan', 'thai green curry'] },
  { name: 'Red Curry', energy: 120, protein: 7, carbs: 6, fat: 8,
    aliases: ['red curry', 'kaeng phed', 'thai red curry'] },
  { name: 'Tom Kha Gai', energy: 95, protein: 6, carbs: 5, fat: 6,
    aliases: ['tom kha gai', 'tom kha', 'coconut chicken soup'] },
  { name: 'Larb', energy: 149, protein: 15, carbs: 5, fat: 8,
    aliases: ['larb', 'laab', 'larb moo', 'laab gai'] },
  { name: 'Khao Man Gai', energy: 190, protein: 10, carbs: 22, fat: 6,
    aliases: ['khao man gai', 'hainanese chicken rice', 'thai chicken rice'] },
  { name: 'Pad See Ew', energy: 175, protein: 8, carbs: 24, fat: 5.5,
    aliases: ['pad see ew', 'pad si ew'] },
  { name: 'Pad Woon Sen', energy: 110, protein: 6, carbs: 18, fat: 2,
    aliases: ['pad woon sen', 'glass noodle stir fry'] },
  { name: 'Mango Sticky Rice', energy: 190, protein: 3, carbs: 36, fat: 4,
    aliases: ['mango sticky rice', 'khao niew mamuang'] },
  { name: 'Satay', energy: 240, protein: 20, carbs: 5, fat: 15,
    aliases: ['satay', 'chicken satay', 'moo satay'] },
  { name: 'Thai Iced Tea', energy: 120, protein: 1, carbs: 22, fat: 3,
    aliases: ['thai iced tea', 'cha yen', 'thai tea'] },
  { name: 'Khao Soi', energy: 190, protein: 9, carbs: 20, fat: 9,
    aliases: ['khao soi', 'khao soi gai'] },
  { name: 'Panang Curry', energy: 145, protein: 9, carbs: 6, fat: 10,
    aliases: ['panang curry', 'phanaeng', 'phanaeng curry'] },
  { name: 'Yam Woon Sen', energy: 95, protein: 7, carbs: 12, fat: 2,
    aliases: ['yam woon sen', 'glass noodle salad'] },
  { name: 'Gai Yang (Grilled Chicken)', energy: 195, protein: 25, carbs: 0, fat: 10,
    aliases: ['gai yang', 'thai grilled chicken'] },
];

// candidate 描述跟表裡的 alias 互相比對（雙向 includes），抓出最可能對到的泰式料理
function findThaiFood(description) {
  const normalized = description.toLowerCase().trim();
  if (normalized.length < 3) return null;

  for (const entry of THAI_FOODS) {
    const matched = entry.aliases.some(alias =>
      normalized.includes(alias) || (normalized.length >= 4 && alias.includes(normalized))
    );
    if (matched) return entry;
  }
  return null;
}

module.exports = { findThaiFood, THAI_FOODS };
