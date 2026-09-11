import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, initialSnapshot, curatedRevision } from '../lib/sync.js';
import { normalizeRecord, records, diffCatalog } from '../lib/catalog-sync.js';
import { contentFingerprint, parseFeed, publicUrl, fetchText, hash } from '../lib/source-client.js';
import { validClaims, applyCommunityEvidence } from '../src/community.js';

const now = '2026-09-11T06:00:00Z';
const nowMs = Date.parse(now);
const mainRecord = { id: 1, name: 'Main', element: 'Aqua', role: 'Vanguard', rarity: 5, mainSkill: { name: 'Wave', description: 'Deals Skill DMG.', multiplier: 100 }, mainCore: [{ name: 'Core Wave' }], supportSkill: { name: 'Support Wave', description: 'Deals Skill DMG.' } };
const supportRecord = { id: 2, name: 'Healer', element: 'Aqua', role: 'Support', rarity: 4, supportSkill: { name: 'Rest', description: 'Restores HP to main Trekker. Applies Aqua Mark.' } };
const discRecord = { id: 10, name: 'Disc', element: 'Aqua', rarity: 4, melody: { description: 'Increases Skill DMG.' } };
const config = { intervalHours: 6, gameData: { id: 'stellabase', label: 'Game data', baseUrl: 'https://stella.ennead.cc', charactersPath: '/characters', discsPath: '/discs', characterPath: '/character/{id}', discPath: '/disc/{id}' }, pages: [], feeds: [] };
function snapshot() { return { version: 1, revision: 'old', catalog: { trekkers: [], discs: [] }, sources: [], rawHashes: {}, claims: [], documents: [], changes: [], lastSuccessAt: null }; }
function provider(overrides = {}) {
  const values = { '/characters': [mainRecord, supportRecord], '/discs': [discRecord], '/character/1': mainRecord, '/character/2': supportRecord, '/disc/10': discRecord, ...overrides };
  return async url => { const item = values[new URL(url).pathname]; if (item instanceof Error) throw item; if (!item) throw Error('Unexpected URL'); return structuredClone(item); };
}
test('new game entries create position-aware provisional builds with traceable source', () => {
  const { item } = normalizeRecord(mainRecord, 'trekker');
  assert.equal(item.id, 'trekker-1'); assert.equal(item.analysisStatus, 'inferred');
  assert.deepEqual(item.builds.main.damageTags, ['skill']); assert.deepEqual(item.builds.main.potentials, ['Core Wave']);
  assert.equal(item.builds.support.skills[0], 'Support Wave');
  assert.equal(item.source, 'https://stella.ennead.cc/trekkers/1');
});
test('unknown upstream numeric enums fail closed rather than guessing elements or roles', () => {
  assert.throws(() => normalizeRecord({ ...mainRecord, element: 3 }, 'trekker'), /schema/);
  assert.throws(() => records({ success: false }, 'characters'), /Format/);
});
test('numeric buff change changes fingerprint and invalidates the old build', () => {
  const first = normalizeRecord(mainRecord, 'trekker');
  first.item.builds.main.tip = 'Previously validated community rotation';
  const unchanged = normalizeRecord(mainRecord, 'trekker', first.item, first.fingerprint);
  assert.equal(unchanged.changed, false); assert.match(unchanged.item.builds.main.tip, /Previously/);
  const updated = normalizeRecord({ ...mainRecord, mainSkill: { ...mainRecord.mainSkill, multiplier: 150 } }, 'trekker', first.item, first.fingerprint);
  assert.notEqual(updated.fingerprint, first.fingerprint); assert.equal(updated.changed, true);
  assert.doesNotMatch(updated.item.builds.main.tip, /Previously/);
});
test('successful synchronization creates a new revision and only marks real game-data success', async () => {
  const before = snapshot(); const result = await buildSnapshot(before, config, { getJSON: provider(), env: {}, now });
  assert.equal(result.status, 'synced'); assert.equal(result.lastSuccessAt, now);
  assert.equal(result.catalog.trekkers.length, 2); assert.equal(result.catalog.discs.length, 1);
  assert.equal(result.changes.length, 3); assert.equal(result.nextCheckAt, '2026-09-11T12:00:00.000Z');
  assert.equal(before.revision, 'old'); assert.equal(before.catalog.trekkers.length, 0);
  const repeat = await buildSnapshot(result, config, { getJSON: provider(), env: {}, now });
  assert.equal(repeat.revision, result.revision); assert.equal(repeat.changes.length, 0);
});
test('failed detail fetch rolls back the complete catalog and never leaks an API key', async () => {
  const before = await buildSnapshot(snapshot(), config, { getJSON: provider(), env: {}, now });
  const after = await buildSnapshot(before, config, { getJSON: provider({ '/character/2': Error('key=VERY_SECRET') }), env: {}, now: '2026-09-11T12:00:00Z' });
  assert.equal(after.status, 'degraded'); assert.equal(after.revision, before.revision);
  assert.deepEqual(after.catalog, before.catalog); assert.equal(after.lastSuccessAt, before.lastSuccessAt);
  assert.doesNotMatch(JSON.stringify(after), /VERY_SECRET/); assert.equal(after.sources[0].status, 'error');
});
test('an incomplete upstream list does not silently delete owned characters', async () => {
  const before = await buildSnapshot(snapshot(), config, { getJSON: provider(), env: {}, now });
  const after = await buildSnapshot(before, config, { getJSON: provider({ '/characters': [mainRecord] }), env: {}, now });
  assert.equal(after.status, 'degraded'); assert.equal(after.catalog.trekkers.length, 2);
});
test('new characters and buffs both trigger change events; identical records do not', () => {
  const original = normalizeRecord(mainRecord, 'trekker').item;
  const buff = normalizeRecord({ ...mainRecord, mainSkill: { ...mainRecord.mainSkill, multiplier: 200 } }, 'trekker').item;
  const added = normalizeRecord(supportRecord, 'trekker').item;
  const changes = diffCatalog({ trekkers: [original], discs: [] }, { trekkers: [buff, added], discs: [] });
  assert.deepEqual(changes.map(c => c.type), ['changed', 'new']);
});
const claim = { id: 'a', status: 'reviewed', sourceId: 'source', sourceUrl: 'https://example.com/build', sourceLabel: 'Author', author: 'Alice', summary: 'A verified team', publishedAt: '2026-09-01T00:00:00Z', reviewedAt: '2026-09-10T00:00:00Z', catalogRevision: 'live-one', main: 'main', supports: ['a', 'b'], goals: ['boss'], damageTags: ['skill'], expiresAfterDays: 90 };
test('community evidence requires review, matching revision, real dates, and eligible source', () => {
  const context = { revision: 'live-one', now: nowMs };
  assert.equal(validClaims([claim], context).length, 1);
  for (const mutation of [{ status: 'discovered' }, { catalogRevision: 'live-old' }, { publishedAt: '2027-01-01' }, { publishedAt: '2025-01-01' }, { sourceUrl: 'javascript:alert(1)' }, { supports: ['a', 'a'] }, { author: 3 }, { goals: 'boss' }]) {
    assert.equal(validClaims([{ ...claim, ...mutation }], context).length, 0);
  }
  assert.equal(validClaims([claim], { ...context, sourceStates: [{ id: 'source', status: 'error' }] }).length, 0);
  assert.equal(validClaims([claim], { ...context, sourceStates: [{ id: 'source', status: 'ok', contentChanged: true, fingerprint: 'new' }] }).length, 0);
  assert.equal(validClaims([{ ...claim, sourceFingerprint: 'new' }], { ...context, sourceStates: [{ id: 'source', status: 'ok', contentChanged: true, fingerprint: 'new' }] }).length, 1);
});
test('cross-posts count once, community ranking stays separate from kit compatibility', () => {
  const team = { id: 'team', score: 80, main: { id: 'main', damageTags: ['skill'] }, supports: [{ id: 'a' }, { id: 'b' }] };
  const result = applyCommunityEvidence([team], [claim, { ...claim, id: 'repost', sourceUrl: 'https://youtube.com/watch?v=123' }], { revision: 'live-one', now: nowMs, goal: 'boss' });
  assert.equal(result[0].score, 80); assert.equal(result[0].communityPoints, 4); assert.equal(result[0].rankScore, 84); assert.equal(result[0].evidence.length, 1);
  assert.equal(applyCommunityEvidence([team], [claim], { revision: 'live-one', now: nowMs, goal: 'survival' })[0].communityPoints, 0);
  assert.equal(team.evidence, undefined);
});
test('missing optional credentials are visible and do not produce fabricated community evidence', async () => {
  const result = await buildSnapshot(snapshot(), config, { getJSON: provider(), env: {}, now });
  assert.equal(result.sources.filter(s => s.status === 'not-configured').length, 3);
  assert.equal(result.claims.length, 0);
});
test('feed discovery preserves publication time and never auto-approves a post', () => {
  const xml = '<feed><entry><title>Build &amp; tips</title><link href="https://example.com/post"/><published>2026-09-01T00:00:00Z</published></entry></feed>';
  const [item] = parseFeed(xml, { id: 'feed', label: 'Feed', kind: 'community' }, now);
  assert.equal(item.title, 'Build & tips'); assert.equal(item.status, 'discovered'); assert.equal(item.publishedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(parseFeed('<feed><entry><link href="javascript:evil"/></entry></feed>', {}, now).length, 0);
});
test('network source URLs reject local addresses, non-HTTPS, credentials and unapproved redirects', async () => {
  for (const value of ['http://example.com', 'https://127.0.0.1', 'https://localhost', 'https://a.local', 'https://user:pass@example.com', 'https://evil.example']) assert.throws(() => publicUrl(value, ['example.com', '127.0.0.1', 'localhost', 'a.local']));
  let requestOptions;
  const text = await fetchText('https://example.com', { allowedHosts: ['example.com'], fetchImpl: async (url, options) => { requestOptions = options; return new Response('ok'); } });
  assert.equal(text, 'ok'); assert.equal(requestOptions.redirect, 'error');
  await assert.rejects(fetchText('https://example.com', { allowedHosts: ['example.com'], maxBytes: 3, fetchImpl: async () => new Response('too big') }), /besar/);
});
test('content fingerprints ignore scripts but catch visible patch changes', () => {
  assert.equal(contentFingerprint('<main>Patch 1</main><script>random 1</script>'), contentFingerprint('<main>Patch 1</main><script>random 2</script>'));
  assert.notEqual(contentFingerprint('<main>Buff 10</main>'), contentFingerprint('<main>Buff 20</main>'));
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
});
test('initial catalog tells the truth about synchronization and contains a real cited community claim', async () => {
  const seed = await initialSnapshot();
  assert.equal(seed.lastSuccessAt, null); assert.equal(seed.revision, curatedRevision);
  assert.equal(seed.catalog.trekkers.length, 24); assert.equal(seed.catalog.discs.length, 30);
  assert.equal(seed.claims[0].sourceUrl, 'https://mobi.gg/en/tips/stella-sora-chitose-build/');
});
test('a curated override applies only to its exact kit fingerprint', () => {
  const first = normalizeRecord(mainRecord, 'trekker');
  const curation = { fingerprint: first.fingerprint, data: { summary: 'Reviewed build', builds: { main: { focus: 'Reviewed route' } } } };
  const same = normalizeRecord(mainRecord, 'trekker', first.item, first.fingerprint, curation);
  assert.equal(same.item.analysisStatus, 'curated'); assert.equal(same.item.summary, 'Reviewed build');
  const changed = normalizeRecord({ ...mainRecord, mainSkill: { ...mainRecord.mainSkill, multiplier: 200 } }, 'trekker', same.item, first.fingerprint, curation);
  assert.equal(changed.item.analysisStatus, 'inferred'); assert.notEqual(changed.item.summary, 'Reviewed build');
});
test('the official API supplies publication dates without treating promotional news as balance', async () => {
  const configWithNews = { ...config, pages: [{ id: 'official-news', label: 'Official', kind: 'official', url: 'https://stellasora.global/news', apiUrl: 'https://stellasora.global/api/resource/news' }] };
  const getJSON = async url => url.includes('api/resource/news') ? { code: 0, data: { rows: [{ id: 123, title: 'New event', description: 'Rewards now available.', publishTime: nowMs }] } } : provider()(url);
  const result = await buildSnapshot(snapshot(), configWithNews, { getJSON, env: {}, now });
  assert.equal(result.sources.find(s => s.id === 'official-news').status, 'ok');
  assert.equal(result.documents[0].publishedAt, '2026-09-11T06:00:00.000Z');
  assert.equal(result.pendingBalanceReview, false);
});
test('a pending official balance review suspends old community ranking signals', () => {
  assert.equal(validClaims([claim], { revision: 'live-one', now: nowMs, pendingBalanceReview: true }).length, 0);
});
