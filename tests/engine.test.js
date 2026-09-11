import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendTeams } from '../src/engine.js';

const trekker = (id, overrides = {}) => ({
  id, name: id, element: 'Ignis', role: 'Support', rarity: 4,
  damageTags: ['skill'], supportTags: [], ...overrides,
});
const disc = (id, overrides = {}) => ({
  id, name: id, element: 'Ignis', rarity: 4, tags: ['skill'], ...overrides,
});
const roster = [
  trekker('carry', { role: 'Vanguard' }),
  trekker('buffer', { supportTags: ['skill', 'buff'] }),
  trekker('healer', { supportTags: ['heal', 'energy'] }),
  trekker('debuffer', { supportTags: ['skill', 'debuff'] }),
  trekker('gatherer', { supportTags: ['gather', 'energy'] }),
  trekker('shield', { supportTags: ['shield', 'energy'] }),
  trekker('other-main', { role: 'Vanguard', element: 'Aqua', damageTags: ['basic'] }),
];
const discs = Array.from({ length: 8 }, (_, index) => disc(`disc-${index}`, {
  tags: index < 3 ? ['skill', 'buff'] : ['heal', 'energy', 'shield'],
}));
const catalog = { trekkers: roster, discs };
const explore = { mode: 'explore', lockedMain: 'carry', limit: 20 };
const supportIds = (team) => team.supports.map((member) => member.id).sort();
const assigned = (team) => [...team.discs.main, ...team.discs.support];

test('collection ownership applies to all Trekker, disc, and alternative results', () => {
  const ownedTrekkers = ['carry', 'buffer', 'healer', 'carry', 'unknown'];
  const ownedDiscs = ['disc-0', 'disc-1', 'disc-3', 'disc-4', 'disc-5', 'disc-6', 'disc-7', 'unknown'];
  const teams = recommendTeams({ mode: 'collection', ownedTrekkers, ownedDiscs, limit: 10 }, catalog);
  assert.ok(teams.length > 0);
  for (const team of teams) {
    assert.ok([team.main, ...team.supports].every((member) => ownedTrekkers.includes(member.id)));
    assert.ok([...assigned(team), ...team.alternatives].every(({ disc: item }) => ownedDiscs.includes(item.id)));
    assert.equal(assigned(team).length, 6);
    assert.equal(team.alternatives.length, 1);
  }
});

test('exploration considers the catalog without owned inventory', () => {
  const teams = recommendTeams({ mode: 'explore', ownedTrekkers: [], ownedDiscs: [] }, catalog);
  assert.equal(teams.length, 3);
  assert.equal(assigned(teams[0]).length, 6);
  assert.deepEqual(recommendTeams({ mode: 'collection' }, catalog), []);
});

test('unavailable or element-incompatible locked main never silently switches', () => {
  assert.deepEqual(recommendTeams({ ...explore, lockedMain: 'missing' }, catalog), []);
  assert.deepEqual(recommendTeams({ ...explore, element: 'Aqua' }, catalog), []);
  assert.deepEqual(recommendTeams({ mode: 'collection', ownedTrekkers: ['buffer', 'healer', 'debuffer'], lockedMain: 'carry' }, catalog), []);
});

test('element filters the main and leaves cross-element supports available with a warning', () => {
  const mixed = { trekkers: [roster[0], roster[1], trekker('aqua-heal', { element: 'Aqua', supportTags: ['heal'] })], discs: [] };
  const [team] = recommendTeams({ ...explore, element: 'Ignis' }, mixed);
  assert.equal(team.main.element, 'Ignis');
  assert.ok(team.supports.some((member) => member.element === 'Aqua'));
  assert.ok(team.warnings.some((warning) => warning.includes('beberapa elemen')));
});

test('insufficient roster, zero limit, and duplicate-only roster return no teams', () => {
  assert.deepEqual(recommendTeams(explore, { trekkers: roster.slice(0, 2), discs }), []);
  assert.deepEqual(recommendTeams({ ...explore, limit: 0 }, catalog), []);
  assert.deepEqual(recommendTeams(explore, { trekkers: [roster[0], roster[0], roster[1]], discs }), []);
});

test('duplicate catalog entries never create duplicate characters or disc assignments', () => {
  const [team] = recommendTeams(explore, {
    trekkers: [roster[0], roster[1], roster[2], roster[0], roster[1]],
    discs: [...discs, discs[0], discs[1]],
  });
  assert.equal(new Set([team.main, ...team.supports].map((member) => member.id)).size, 3);
  assert.equal(team.discs.main.length, 3);
  assert.equal(team.discs.support.length, 3);
  const ids = [...assigned(team), ...team.alternatives].map(({ disc: item }) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('zero discs still gives a usable team with an explicit gap and zero disc points', () => {
  const [team] = recommendTeams(explore, { trekkers: roster, discs: [] });
  assert.deepEqual(team.discs, { main: [], support: [] });
  assert.deepEqual(team.alternatives, []);
  assert.equal(team.breakdown.find((entry) => entry.label === 'Kecocokan disc').value, 0);
  assert.ok(team.warnings.some((warning) => warning.includes('Belum ada disc')));
});

test('partial inventories fill main slots first and never repeat a disc', () => {
  for (let count = 1; count <= 5; count += 1) {
    const [team] = recommendTeams(explore, { trekkers: roster.slice(0, 3), discs: discs.slice(0, count) });
    assert.equal(team.discs.main.length, Math.min(3, count));
    assert.equal(team.discs.support.length, Math.max(0, count - 3));
    assert.equal(new Set(assigned(team).map(({ disc: item }) => item.id)).size, count);
    assert.ok(team.warnings.some((warning) => warning.includes('slot disc belum terisi')));
  }
});

test('disc assignment preserves attack-focused main slots and complementary support slots', () => {
  const [team] = recommendTeams(explore, { trekkers: roster.slice(0, 3), discs: discs.slice(0, 6) });
  assert.deepEqual(team.discs.main.map(({ disc: item }) => item.id).sort(), ['disc-0', 'disc-1', 'disc-2']);
  assert.deepEqual(team.discs.support.map(({ disc: item }) => item.id).sort(), ['disc-3', 'disc-4', 'disc-5']);
  const changedRarity = recommendTeams(explore, {
    trekkers: roster.slice(0, 3),
    discs: discs.slice(0, 6).map((item) => ({ ...item, rarity: item.rarity + 99 })),
  })[0];
  assert.equal(changedRarity.score, team.score);
  assert.deepEqual(assigned(changedRarity).map((item) => [item.disc.id, item.score]), assigned(team).map((item) => [item.disc.id, item.score]));
});

test('a deliberately locked Support main is respected and clearly qualified', () => {
  const [team] = recommendTeams({ ...explore, lockedMain: 'healer' }, catalog);
  assert.equal(team.main.id, 'healer');
  assert.ok(team.warnings.some((warning) => warning.includes('Main berperan Support')));
});

test('matching support damage tags improve team fit without rewarding rarity', () => {
  const units = [
    roster[0], trekker('fixed', { supportTags: ['heal'] }),
    trekker('match-low', { rarity: 4, supportTags: ['skill', 'buff'] }),
    trekker('mismatch-high', { rarity: 5, supportTags: ['basic', 'buff'] }),
  ];
  const teams = recommendTeams(explore, { trekkers: units, discs: [] });
  const match = teams.find((team) => supportIds(team).join(',') === 'fixed,match-low');
  const mismatch = teams.find((team) => supportIds(team).join(',') === 'fixed,mismatch-high');
  assert.ok(match.score > mismatch.score);
  const changedRarity = recommendTeams(explore, {
    trekkers: units.map((unit) => ({ ...unit, rarity: 99 })), discs: [],
  });
  assert.deepEqual(teams.map((team) => [team.id, team.score]), changedRarity.map((team) => [team.id, team.score]));
});

test('an elemental Mark supplier only receives direct synergy points for its own element', () => {
  const markCatalog = {
    trekkers: [
      trekker('carry', { role: 'Vanguard', damageTags: ['mark'] }),
      trekker('fixed', { supportTags: ['heal'] }),
      trekker('same-mark', { supportTags: ['mark'] }),
      trekker('cross-mark', { element: 'Aqua', supportTags: ['mark'] }),
    ],
    discs: [],
  };
  const teams = recommendTeams(explore, markCatalog);
  const same = teams.find((team) => supportIds(team).join(',') === 'fixed,same-mark');
  const cross = teams.find((team) => supportIds(team).join(',') === 'cross-mark,fixed');
  assert.equal(same.breakdown.find((entry) => entry.label === 'Sinergi serangan').value, 8);
  assert.equal(cross.breakdown.find((entry) => entry.label === 'Sinergi serangan').value, 0);
  assert.ok(cross.warnings.some((warning) => warning.includes('tidak dihitung sebagai pemasok Ignis Mark')));
});

test('conditional sustain and crowd control are qualified in team explanations', () => {
  const [team] = recommendTeams({ ...explore, goal: 'survival' }, catalog);
  assert.ok(team.warnings.some((warning) => warning.includes('potential dan pemicu')));
});

test('element-scoped support buffs do not count for a main of another element', () => {
  const [team] = recommendTeams(explore, {
    trekkers: [roster[0], roster[2], trekker('scoped', {
      element: 'Aqua', supportTags: ['skill', 'debuff'],
      supportTagScopes: { skill: 'same-element', debuff: 'same-element' },
    })], discs: [],
  });
  assert.equal(team.breakdown.find((entry) => entry.label === 'Sinergi serangan').value, 1);
  assert.ok(!team.reasons.some((reason) => reason.includes('Tag dukungan skill cocok')));
});

test('disc element requirements prevent unrelated elemental damage tags from adding fit', () => {
  const [team] = recommendTeams(explore, {
    trekkers: roster.slice(0, 3),
    discs: [disc('matching'), disc('foreign', { element: 'Aqua' }), disc('neutral', { element: 'Neutral' })],
  });
  const scores = Object.fromEntries(team.discs.main.map((item) => [item.disc.id, item.score]));
  assert.ok(scores.matching > scores.neutral);
  assert.ok(scores.neutral > scores.foreign);
  assert.equal(scores.foreign, 10);
});

test('damage focus follows the selected main or support build position', () => {
  const units = [
    trekker('carry', { role: 'Vanguard', damageTags: ['basic'], builds: { main: { damageTags: ['skill'] } } }),
    trekker('summoner-a', { damageTags: ['basic'], builds: { support: { damageTags: ['minion'], supportTags: ['skill'] } } }),
    trekker('summoner-b', { damageTags: ['basic'], builds: { support: { damageTags: ['minion'] } } }),
  ];
  const positionedDiscs = [
    ...Array.from({ length: 3 }, (_, i) => disc(`skill-${i}`, { tags: ['skill'] })),
    ...Array.from({ length: 3 }, (_, i) => disc(`minion-${i}`, { tags: ['minion'] })),
  ];
  const [team] = recommendTeams(explore, { trekkers: units, discs: positionedDiscs });
  assert.ok(team.discs.main.every((item) => item.disc.id.startsWith('skill-')));
  assert.ok(team.discs.support.every((item) => item.disc.id.startsWith('minion-')));
  assert.equal(team.breakdown.find((entry) => entry.label === 'Sinergi serangan').value, 8);
  assert.ok(team.reasons[0].includes('fokus skill'));
});

test('goal selection changes ranking for bosses, farming, and survival', () => {
  const noDiscs = { trekkers: roster.slice(0, 6), discs: [] };
  const boss = recommendTeams({ ...explore, goal: 'boss' }, noDiscs)[0];
  const survival = recommendTeams({ ...explore, goal: 'survival' }, noDiscs)[0];
  const farm = recommendTeams({ ...explore, goal: 'farm' }, noDiscs)[0];
  assert.deepEqual(supportIds(boss), ['buffer', 'debuffer']);
  assert.ok(supportIds(survival).includes('healer'));
  assert.ok(supportIds(farm).includes('gatherer'));
  assert.notEqual(boss.id, survival.id);
});

test('actual disc compatibility affects team ranking', () => {
  const units = [
    trekker('a-basic', { role: 'Vanguard', damageTags: ['basic'] }),
    trekker('z-skill', { role: 'Vanguard', damageTags: ['skill'] }),
    trekker('support-1', { supportTags: ['buff'] }),
    trekker('support-2', { supportTags: ['heal'] }),
  ];
  const options = { mode: 'explore', limit: 20 };
  const skillDiscs = Array.from({ length: 6 }, (_, index) => disc(`skill-${index}`, { tags: ['skill'] }));
  const basicDiscs = skillDiscs.map((item) => ({ ...item, tags: ['basic'] }));
  const skill = recommendTeams(options, { trekkers: units, discs: skillDiscs });
  const basic = recommendTeams(options, { trekkers: units, discs: basicDiscs });
  assert.equal(skill[0].main.id, 'z-skill');
  assert.equal(basic[0].main.id, 'a-basic');
});

test('scores add up, stay bounded, and communicate conditional support-disc mechanics', () => {
  const teams = recommendTeams(explore, catalog);
  for (const team of teams) {
    assert.equal(team.score, team.breakdown.reduce((sum, entry) => sum + entry.value, 0));
    assert.equal(team.breakdown.reduce((sum, entry) => sum + entry.max, 0), 100);
    assert.ok(team.breakdown.every((entry) => entry.value >= 0 && entry.value <= entry.max));
    assert.ok(team.score >= 0 && team.score <= 100);
    assert.ok(assigned(team).every((item) => item.score >= 0 && item.score <= 100));
    assert.ok(team.discs.support.every((item) => item.reasons.some((reason) => reason.includes('tidak diasumsikan aktif'))));
  }
});

test('ranking is deterministic across catalog order and inputs are not mutated', () => {
  const options = { ...explore, ownedTrekkers: ['carry'], ownedDiscs: ['disc-0'] };
  const before = JSON.stringify({ options, catalog });
  const first = recommendTeams(options, catalog);
  const second = recommendTeams(options, { trekkers: roster.slice().reverse(), discs: discs.slice().reverse() });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ options, catalog }), before);
});
