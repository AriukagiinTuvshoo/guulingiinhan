import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeMongolianZodiac,
  getMotherGloryMedal,
  toMongolianGenitive,
  toTraditionalMongolianScript,
} from '../lib/mongolian-zodiac.ts';

test('computes 1985-03-14 male lunar zodiac and 8-trigram suudal in 2026 accurately', () => {
  const res = computeMongolianZodiac('1985-03-14', 'male', 2026);
  assert.ok(res);
  assert.equal(res.birthYear, 1985);
  assert.equal(res.lunarAge, 42);
  assert.equal(res.zodiacFull, 'Хөхөгчин үхэр жил');
  assert.equal(res.currentYearZodiac, 'Улаан морин жил');
  assert.equal(res.suudal, 'Шороо');
  assert.equal(res.nextSuudal, 'Төмөр');
});

test('computes female suudal counter-clockwise from Ус', () => {
  // Age 1 female = Ус, age 2 = Огторгуй, age 3 = Төмөр
  const res = computeMongolianZodiac('2024-05-01', 'female', 2026);
  assert.ok(res);
  assert.equal(res.lunarAge, 3);
  assert.equal(res.suudal, 'Төмөр');
  assert.equal(res.nextSuudal, 'Шороо');
});

test('awards Эхийн алдар I & II medals for mothers with 4+ and 6+ children', () => {
  assert.equal(getMotherGloryMedal('male', 6), null);
  assert.equal(getMotherGloryMedal('female', 3), null);
  assert.equal(getMotherGloryMedal('female', 4)?.degree, 2);
  assert.equal(getMotherGloryMedal('female', 6)?.degree, 1);
});

test('inflects Mongolian genitive case and transliterates to Traditional Mongolian Script', () => {
  assert.equal(toMongolianGenitive('Дамдин'), 'Дамдины');
  assert.equal(toMongolianGenitive('Баавай'), 'Баавайн');
  const script = toTraditionalMongolianScript('Тэмүүжин');
  assert.ok(script.length >= 6);
  assert.ok(/[\u1820-\u1842]/.test(script));
});
