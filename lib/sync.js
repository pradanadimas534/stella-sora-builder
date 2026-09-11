import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TREKKERS, DISCS, DATA_META } from '../src/data.js';
import { hash, fetchJSON, fetchText, contentFingerprint, parseFeed } from './source-client.js';
import { records, normalizeRecord, sourceId, diffCatalog } from './catalog-sync.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const snapshotPath = path.join(root, 'data', 'snapshot.json');
export const curatedRevision = 'curated-' + hash({ TREKKERS, DISCS }).slice(0, 16);
let inFlight;
async function jsonFile(filename, fallback) { try { return JSON.parse(await readFile(filename, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
export async function initialSnapshot() {
  const community = await jsonFile(path.join(root, 'data', 'community-builds.json'), { claims: [] });
  const config = await jsonFile(path.join(root, 'data', 'sources.json'));
  return { version: 1, revision: curatedRevision, checkedAt: null, lastSuccessAt: null, nextCheckAt: null,
    catalog: { trekkers: TREKKERS, discs: DISCS }, meta: DATA_META, rawHashes: {}, changes: [], claims: community.claims,
    documents: config.pages.map(p => ({ id: p.id, sourceId: p.id, sourceLabel: p.label, kind: p.kind, title: p.label, url: p.url, status: 'reference', discoveredAt: null, publishedAt: null })),
    sources: [...[config.gameData, ...config.pages, ...config.feeds].map(s => ({ id: s.id, label: s.label, status: 'reference', lastSuccessAt: null, message: 'Referensi awal; sinkronisasi runtime belum berhasil.' })),
      ...['youtube', 'google', 'facebook'].map(id => ({ id, label: id === 'youtube' ? 'YouTube' : id === 'google' ? 'Google Search' : 'Facebook Pages', status: 'not-configured', message: 'Kredensial API belum dipasang.' }))] };
}
export async function readSnapshot(filename = snapshotPath) {
  const snapshot = await jsonFile(filename, null);
  if (!snapshot) return initialSnapshot();
  if (snapshot.version !== 1 || !Array.isArray(snapshot.catalog?.trekkers) || !Array.isArray(snapshot.catalog?.discs)) throw new Error('Snapshot tidak valid.');
  return snapshot;
}
async function atomicJSON(filename, data) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = filename + '.tmp';
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
  await rename(temporary, filename);
}
async function mapLimit(items, limit, action) {
  const results = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (cursor < items.length) { const index = cursor++; results[index] = await action(items[index], index); }
  }));
  return results;
}
export async function buildSnapshot(previous, config, { env = process.env, now = new Date().toISOString(), getJSON = fetchJSON, getText = fetchText, localClaims = [], curations = {} } = {}) {
  const next = structuredClone(previous);
  next.checkedAt = now;
  next.nextCheckAt = new Date(Date.parse(now) + Math.max(1, config.intervalHours || 6) * 3600000).toISOString();
  next.sources = []; next.changes = []; next.claims = localClaims;
  const documents = new Map((previous.documents || []).map(d => [d.url, d]));
  async function check(source, action) {
    const old = previous.sources?.find(s => s.id === source.id);
    try {
      const result = await action(old);
      next.sources.push({ id: source.id, label: source.label, status: 'ok', lastAttemptAt: now, lastSuccessAt: now, ...result });
      return true;
    } catch {
      // Do not serialize provider error bodies, request URLs, tokens, or keys.
      next.sources.push({ id: source.id, label: source.label, status: 'error', lastAttemptAt: now, lastSuccessAt: old?.lastSuccessAt || null,
        fingerprint: old?.fingerprint || null, contentChanged: old?.contentChanged || false,
        message: 'Sumber tidak dapat diambil atau schema berubah. Data terakhir yang valid tetap digunakan.' });
      return false;
    }
  }
  const game = config.gameData;
  let gameSucceeded = false;
  if (game) gameSucceeded = await check(game, async () => {
    const allowedHosts = ['stella.ennead.cc'];
    const lists = await Promise.all([
      getJSON(new URL(game.charactersPath, game.baseUrl).href, { allowedHosts }),
      getJSON(new URL(game.discsPath, game.baseUrl).href, { allowedHosts }),
    ]);
    const catalog = { trekkers: [], discs: [] }; const rawHashes = {};
    for (const [index, kind, plural] of [[0, 'trekker', 'trekkers'], [1, 'disc', 'discs']]) {
      const list = records(lists[index], index === 0 ? 'characters' : 'discs');
      if (!list.length || list.length > 300) throw new Error('Ukuran katalog tidak masuk akal.');
      const previousBySource = new Map(previous.catalog[plural].map(item => [sourceId(item), item]));
      const items = await mapLimit(list, 2, async entry => {
        const id = String(entry.id ?? entry.Id ?? entry.ID);
        if (!/^\d{1,10}$/.test(id)) throw new Error('ID sumber tidak valid.');
        const endpoint = (index === 0 ? game.characterPath : game.discPath).replace('{id}', id);
        const detail = await getJSON(new URL(endpoint, game.baseUrl).href, { allowedHosts });
        const raw = detail?.data || detail;
        const merged = { ...entry, ...raw, id };
        const old = previousBySource.get(id);
        const result = normalizeRecord(merged, kind, old, previous.rawHashes?.[`${kind}:${id}`], curations[`${kind}:${id}`]);
        rawHashes[`${kind}:${id}`] = result.fingerprint;
        return result.item;
      });
      if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplikasi ID katalog.');
      // Sudden omissions often mean a partial upstream response, not removed playable characters.
      if (previous.catalog[plural].some(old => !items.some(item => sourceId(item) === sourceId(old)))) throw new Error('Katalog sumber kehilangan entri sebelumnya.');
      catalog[plural] = items;
    }
    next.changes = diffCatalog(previous.catalog, catalog);
    next.catalog = catalog; next.rawHashes = rawHashes;
    next.revision = 'live-' + hash(rawHashes).slice(0, 16);
    next.lastSuccessAt = now;
    next.meta = { ...DATA_META, checkedAt: now.slice(0, 10), label: 'Snapshot hasil sinkronisasi', note: `${catalog.trekkers.length} Trekker dan ${catalog.discs.length} Disc dari database komunitas. Entri baru atau berubah memakai analisis awal kit; build komunitas harus sesuai revisi data.` };
    return { message: `${next.changes.length} perubahan kit terdeteksi; rekomendasi dihitung dari revisi ${next.revision}.`, count: catalog.trekkers.length + catalog.discs.length };
  });
  for (const source of config.pages || []) await check(source, async old => {
    if (source.kind === 'official' && source.apiUrl) {
      const body = await getJSON(source.apiUrl, { allowedHosts: ['stellasora.global'] });
      if (body.code !== 0 || !Array.isArray(body.data?.rows) || !body.data.rows.length) throw new Error('API pengumuman resmi tidak valid.');
      const items = body.data.rows;
      let balanceChanged = false;
      for (const item of items) {
        if (!/^\d+$/.test(String(item.id)) || !item.title || !Number.isFinite(Number(item.publishTime))) continue;
        const url = `https://stellasora.global/news/${item.id}`;
        const fingerprint = contentFingerprint(item.description || item.title);
        const oldDocument = documents.get(url);
        const balanceCandidate = /\b(?:balance adjustment|skill adjustment|buff|nerf|increased? by|reduced? by|damage adjustment)\b/i.test(item.description || '');
        if (old?.fingerprint && balanceCandidate && oldDocument?.fingerprint !== fingerprint) balanceChanged = true;
        documents.set(url, { id: `official-${item.id}`, sourceId: source.id, sourceLabel: source.label, title: String(item.title).slice(0, 200), kind: 'official', url,
          publishedAt: new Date(Number(item.publishTime)).toISOString(), discoveredAt: oldDocument?.discoveredAt || now, fingerprint,
          status: 'official', balanceCandidate, note: balanceCandidate ? 'Pengumuman menyebut perubahan angka/skill; cocokkan kit terbaru sebelum mempertahankan klaim build.' : 'Pengumuman resmi; tidak semua berita mengubah balance.' });
      }
      const kitChanged = next.revision !== previous.revision;
      next.pendingBalanceReview = balanceChanged || (!!previous.pendingBalanceReview && !kitChanged);
      return { fingerprint: hash(items.map(i => [i.id, i.publishTime, contentFingerprint(i.description || i.title)])), count: items.length,
        message: `${items.length} pengumuman resmi dibaca dari API situs.${next.pendingBalanceReview ? ' Ada indikasi perubahan balance yang perlu dicocokkan dengan kit.' : ''}` };
    }
    const html = await getText(source.url, { allowedHosts: [new URL(source.url).hostname] });
    if (html.length < 500 || /<title[^>]*>[^<]*(?:checking your browser|just a moment|captcha|access denied)/i.test(html.slice(0, 5000))) throw new Error('Halaman tidak berisi data.');
    const fingerprint = contentFingerprint(html);
    const changed = !!old?.fingerprint && old.fingerprint !== fingerprint;
    if (source.kind === 'official') {
      // News discovery is separate from balance confirmation; promotional news does not imply a buff.
      const links = [...html.matchAll(/href=["']((?:https:\/\/stellasora\.global)?\/news\/\d+)["']/g)].slice(0, 25);
      if (!links.length) throw new Error('Pengumuman dirender melalui API; adapter halaman tidak boleh menganggap halaman kosong sebagai hasil terbaru.');
      for (const [, link] of links) {
        const url = new URL(link, source.url).href;
        if (!documents.has(url)) documents.set(url, { id: hash(url).slice(0, 20), sourceId: source.id, sourceLabel: source.label, title: 'Pengumuman resmi Stella Sora', kind: 'official', url, publishedAt: null, discoveredAt: now, status: 'discovered', note: 'Pengumuman baru ditemukan; perubahan balance dikonfirmasi melalui perubahan kit.' });
      }
    }
    return { fingerprint, contentChanged: changed || !!old?.contentChanged, message: changed ? 'Isi sumber berubah; klaim yang merujuk versi sebelumnya perlu divalidasi ulang.' : 'Halaman berhasil diperiksa.' };
  });
  for (const source of config.feeds || []) await check(source, async () => {
    const xml = await getText(source.url, { allowedHosts: [new URL(source.url).hostname] });
    const items = parseFeed(xml, source, now);
    if (!items.length && !/<(?:feed|rss)\b/i.test(xml)) throw new Error('Feed tidak valid.');
    for (const item of items) documents.set(item.url, { ...item, discoveredAt: documents.get(item.url)?.discoveredAt || now });
    return { count: items.length, message: `${items.length} referensi ditemukan; isi perlu ditinjau sebelum menjadi bukti rekomendasi.` };
  });
  const since = new Date(Date.parse(now) - 30 * 86400000).toISOString();
  function missing(id, label, message) { next.sources.push({ id, label, status: 'not-configured', lastAttemptAt: null, lastSuccessAt: null, message }); }
  if (config.youtube?.enabled && env.YOUTUBE_API_KEY) {
    await check({ id: 'youtube', label: 'YouTube' }, async () => {
      const params = new URLSearchParams({ part: 'snippet', q: config.youtube.query, type: 'video', order: 'date', publishedAfter: since, maxResults: '20', key: env.YOUTUBE_API_KEY });
      const body = await getJSON('https://www.googleapis.com/youtube/v3/search?' + params, { allowedHosts: ['www.googleapis.com'] });
      for (const item of body.items || []) {
        if (!/^[\w-]{11}$/.test(item.id?.videoId || '')) continue;
        if (config.youtube.channelIds?.length && !config.youtube.channelIds.includes(item.snippet?.channelId)) continue;
        const url = `https://www.youtube.com/watch?v=${item.id.videoId}`;
        documents.set(url, { id: hash(url).slice(0, 20), sourceId: 'youtube', sourceLabel: item.snippet.channelTitle, title: String(item.snippet.title).slice(0, 200), kind: 'community', url, publishedAt: item.snippet.publishedAt, discoveredAt: now, status: 'discovered', note: 'Metadata video; transkrip dan klaim build belum dianalisis.' });
      }
      return { message: 'Video terbaru ditemukan melalui YouTube Data API; judul bukan bukti build.' };
    });
  } else missing('youtube', 'YouTube', 'Pasang YOUTUBE_API_KEY untuk penemuan video otomatis.');
  if (config.google?.enabled && env.GOOGLE_SEARCH_API_KEY && env.GOOGLE_SEARCH_ENGINE_ID) {
    await check({ id: 'google', label: 'Google Search' }, async () => {
      const params = new URLSearchParams({ q: config.google.query, key: env.GOOGLE_SEARCH_API_KEY, cx: env.GOOGLE_SEARCH_ENGINE_ID, dateRestrict: 'm1', num: '10' });
      const body = await getJSON('https://customsearch.googleapis.com/customsearch/v1?' + params, { allowedHosts: ['customsearch.googleapis.com'] });
      for (const item of body.items || []) {
        if (!String(item.link).startsWith('https://')) continue;
        documents.set(item.link, { id: hash(item.link).slice(0, 20), sourceId: 'google', sourceLabel: item.displayLink, title: String(item.title).slice(0, 200), kind: 'community', url: item.link, publishedAt: null, discoveredAt: now, status: 'discovered', note: 'Hasil penelusuran; cuplikan belum diperlakukan sebagai bukti build.' });
      }
      return { message: 'Penelusuran melalui Custom Search selesai. API ini hanya tersedia untuk pelanggan lama.' };
    });
  } else missing('google', 'Google Search', 'Perlu key dan Search Engine ID pelanggan lama Custom Search; layanan tutup untuk pelanggan baru. RSS/situs terkurasi tetap tersedia.');
  if (config.facebook?.enabled && env.FACEBOOK_PAGE_ACCESS_TOKEN && env.FACEBOOK_GRAPH_VERSION && config.facebook.pageIds?.length) {
    await check({ id: 'facebook', label: 'Facebook Pages' }, async () => {
      if (!/^v\d{1,2}\.0$/.test(env.FACEBOOK_GRAPH_VERSION)) throw new Error('Versi Graph tidak valid.');
      for (const pageId of config.facebook.pageIds.slice(0, 5)) {
        if (!/^\d+$/.test(pageId)) throw new Error('Page ID tidak valid.');
        const params = new URLSearchParams({ fields: 'id,message,created_time,permalink_url', limit: '20', since: String(Math.floor(Date.parse(since) / 1000)) });
        const body = await getJSON(`https://graph.facebook.com/${env.FACEBOOK_GRAPH_VERSION}/${pageId}/posts?${params}`, { allowedHosts: ['graph.facebook.com'], headers: { Authorization: `Bearer ${env.FACEBOOK_PAGE_ACCESS_TOKEN}` } });
        for (const post of body.data || []) {
          if (!post.permalink_url?.startsWith('https://')) continue;
          documents.set(post.permalink_url, { id: hash(post.permalink_url).slice(0, 20), sourceId: 'facebook', sourceLabel: `Facebook Page ${pageId}`, title: 'Kiriman komunitas Stella Sora', kind: 'community', url: post.permalink_url, publishedAt: post.created_time, discoveredAt: now, status: 'discovered', note: 'Referensi dari Page yang diizinkan; belum menjadi klaim build tervalidasi.' });
        }
      }
      return { message: 'Kiriman diambil dari Page yang diizinkan oleh token; grup privat tidak diakses.' };
    });
  } else missing('facebook', 'Facebook Pages', 'Perlu Page ID, Page Access Token, izin baca, dan versi Graph API yang didukung.');
  for (const feed of config.communityBuildFeeds || []) {
    if (feed.trusted !== true) continue;
    await check(feed, async () => {
      const body = await getJSON(feed.url, { allowedHosts: [new URL(feed.url).hostname] });
      if (body.version !== 1 || !Array.isArray(body.claims)) throw new Error('Schema bukti komunitas tidak valid.');
      next.claims.push(...body.claims.slice(0, 200).map(c => ({ ...c, sourceId: feed.id })));
      return { message: 'Klaim terstruktur diperbarui; hanya klaim yang cocok revisi kit dan lolos validasi yang memengaruhi rekomendasi.' };
    });
  }
  next.documents = [...documents.values()].sort((a, b) => (b.publishedAt || b.discoveredAt || '').localeCompare(a.publishedAt || a.discoveredAt || '')).slice(0, 150);
  next.status = gameSucceeded ? 'synced' : 'degraded';
  return next;
}
export function syncData({ filename = snapshotPath, ...options } = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const [previous, config, community, curations] = await Promise.all([
      readSnapshot(filename), jsonFile(path.join(root, 'data', 'sources.json')), jsonFile(path.join(root, 'data', 'community-builds.json'), { claims: [] }), jsonFile(path.join(root, 'data', 'curated-overrides.json'), {}),
    ]);
    const next = await buildSnapshot(previous, config, { ...options, localClaims: community.claims, curations });
    await atomicJSON(filename, next);
    return next;
  })().finally(() => { inFlight = null; });
  return inFlight;
}
