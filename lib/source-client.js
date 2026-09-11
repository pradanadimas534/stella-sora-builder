import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
export function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}
export function publicUrl(value, allowedHosts) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Sumber harus memakai HTTPS publik.');
  if (isIP(url.hostname) || url.hostname === 'localhost' || /\.(?:local|internal|localhost)$/.test(url.hostname) || !url.hostname.includes('.')) throw new Error('Host lokal tidak dapat menjadi sumber.');
  if (!allowedHosts.includes(url.hostname)) throw new Error('Host sumber belum diizinkan di konfigurasi.');
  return url;
}
export async function fetchText(value, { allowedHosts, fetchImpl = fetch, headers = {}, maxBytes = 4_000_000 } = {}) {
  const url = publicUrl(value, allowedHosts);
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'StellaStudio/1.0 (community build monitor)', ...headers } });
  if (!response.ok) throw new Error(`Sumber merespons HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Respons sumber terlalu besar.');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) { const { done, value: chunk } = await reader.read(); if (done) break; size += chunk.byteLength; if (size > maxBytes) throw new Error('Respons sumber terlalu besar.'); chunks.push(chunk); }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function fetchJSON(url, options) { return JSON.parse(await fetchText(url, options)); }
export function plain(value = '') {
  return String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g, entity => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]).replace(/\s+/g, ' ').trim();
}
export function contentFingerprint(html) {
  const main = html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1] || html;
  return hash(plain(main));
}
export function parseFeed(xml, source, now) {
  const entries = [...xml.matchAll(/<(?:entry|item)\b[^>]*>([\s\S]*?)<\/(?:entry|item)>/gi)].slice(0, 30);
  return entries.map(([, entry]) => {
    const field = name => plain(entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '');
    const url = entry.match(/<link\b[^>]*href=["']([^"']+)/i)?.[1]?.replace(/&amp;/g, '&') || field('link');
    try { if (new URL(url).protocol !== 'https:') return null; } catch { return null; }
    const date = field('published') || field('updated') || field('pubDate');
    return { id: hash(url).slice(0, 20), sourceId: source.id, sourceLabel: source.label, kind: source.kind, title: field('title').slice(0, 200), url,
      publishedAt: Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null, discoveredAt: now,
      status: 'discovered', note: 'Ditemukan melalui feed; belum menjadi bukti build tervalidasi.' };
  }).filter(Boolean);
}
