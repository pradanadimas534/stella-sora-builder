import { TREKKERS as SEED_TREKKERS, DISCS as SEED_DISCS, DATA_META as SEED_META } from './data.js';
import { recommendTeams } from './engine.js';
import { applyCommunityEvidence, validClaims } from './community.js';

let TREKKERS = SEED_TREKKERS, DISCS = SEED_DISCS, DATA_META = SEED_META;
let live = { revision: 'offline', sources: [], documents: [], changes: [], claims: [], checkedAt: null, lastSuccessAt: null };
async function readLiveData() {
  const response = await fetch('/api/catalog', { signal: AbortSignal.timeout(5000), cache: 'no-store' });
  if (!response.ok) throw new Error('API katalog tidak tersedia.');
  const data = await response.json();
  if (data.version !== 1 || !Array.isArray(data.catalog?.trekkers) || !data.catalog.trekkers.length || !Array.isArray(data.catalog?.discs)) throw new Error('Katalog tidak valid.');
  live = data; TREKKERS = data.catalog.trekkers; DISCS = data.catalog.discs; DATA_META = data.meta;
}
try { await readLiveData(); } catch { /* Bundled catalog remains available without a running sync service. */ }

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const icons = {
  star: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M7 6.5a7 7 0 0 0-2 4m12 7a7 7 0 0 0 2-4"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v15"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  leaf: '<path d="M20 3C5 2 2 10 6 16s15 2 14-13ZM4 21 15 10"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/>',
  flame: '<path d="M12 2c2 7 7 7 7 13a7 7 0 1 1-14 0c0-4 3-6 4-8 0 4 2 5 3 5 2-3 0-5 0-10Z"/>',
  drop: '<path d="M12 2C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-13Z"/>',
  mountain: '<path d="m2 20 8-15 5 9 3-5 4 11H2ZM7 11l3 2 2-3"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.star}</svg>`;
const elements = ['Aqua', 'Ignis', 'Ventus', 'Terra', 'Lux', 'Umbra'];
const elementIcons = { Aqua: 'drop', Ignis: 'flame', Ventus: 'leaf', Terra: 'mountain', Lux: 'star', Umbra: 'moon', Neutral: 'disc' };
const goals = { balanced: 'Seimbang', boss: 'Lawan boss', farm: 'Bersihkan wave', survival: 'Bertahan hidup' };
const tagLabels = { basic: 'Auto Attack', skill: 'Skill DMG', ultimate: 'Ultimate', mark: 'Mark', minion: 'Minion', buff: 'Buff', heal: 'Heal', shield: 'Shield', debuff: 'Debuff', gather: 'Gather', energy: 'Energy' };
const defaults = { mode: 'explore', element: 'Aqua', goal: 'balanced', lockedMain: '', ownedTrekkers: [], ownedDiscs: [] };
const storageKey = 'stella-studio-v1';
let storageAvailable = true;
let saved = [];
function sanitize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Format pengaturan tidak valid.');
  const ids = (value, list) => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && list.some(item => item.id === id)))] : [];
  return {
    mode: input.mode === 'collection' ? 'collection' : 'explore',
    element: elements.includes(input.element) ? input.element : 'all',
    goal: Object.hasOwn(goals, input.goal) ? input.goal : 'balanced',
    lockedMain: TREKKERS.some(t => t.id === input.lockedMain) ? input.lockedMain : '',
    ownedTrekkers: ids(input.ownedTrekkers, TREKKERS),
    ownedDiscs: ids(input.ownedDiscs, DISCS),
  };
}
let state = { ...defaults };
try {
  const data = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (data) {
    state = sanitize(data.settings);
    saved = Array.isArray(data.saved) ? data.saved.filter(s => s && typeof s.name === 'string' && typeof s.teamId === 'string' && s.settings && typeof s.id === 'string').slice(0, 20).map(s => ({ ...s, settings: sanitize(s.settings) })) : [];
  }
} catch { storageAvailable = false; }
let sharedNotice = false;
try {
  if (location.hash.startsWith('#build=')) {
    const hash = location.hash.slice(7);
    if (hash.length > 30000) throw new Error('Tautan terlalu panjang.');
    const settings = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(hash), c => c.charCodeAt(0))));
    state = sanitize(settings);
    sharedNotice = true;
  }
} catch { setTimeout(() => toast('Tautan build tidak valid. Pengaturan sebelumnya digunakan.'), 200); }
let page = 'builder';
let teams = [];
let selectedTeam = 0;
let activeBuild = 0;
let catalogKind = 'trekkers';
let catalogSearch = '';
let catalogElement = 'all';
let catalogOwnedOnly = false;
let toastTimer;
const badge = element => `<span class="element-badge ${esc(element.toLowerCase())}">${icon(elementIcons[element])}${esc(element)}</span>`;
const imageTag = (item, cls = '') => item.image ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" class="${cls}" loading="lazy" />` : `<span class="portrait-fallback ${cls}" aria-label="${esc(item.name)}">${icon(elementIcons[item.element], 'fallback-icon')}<span>${esc(item.name.slice(0, 2))}</span></span>`;
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, settings: state, saved })); storageAvailable = true; }
  catch { storageAvailable = false; }
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3600);
}
function calculate() {
  const eligible = validClaims(live.claims, { revision: live.revision, sourceStates: live.sources, pendingBalanceReview: live.pendingBalanceReview });
  const candidates = recommendTeams({ ...state, limit: eligible.length ? Number.MAX_SAFE_INTEGER : 3 }, { trekkers: TREKKERS, discs: DISCS });
  teams = applyCommunityEvidence(candidates, eligible, { revision: live.revision, sourceStates: live.sources, goal: state.goal }).slice(0, 3);
  selectedTeam = 0; activeBuild = 0;
}
function header() {
  return `<header class="header"><div class="header-inner"><a href="#" class="brand" data-action="nav" data-page="builder"><span class="brand-symbol">${icon('star')}</span><span>stella<span class="brand-light">studio</span><small>YOUR TEAM, IN HARMONY</small></span></a>
    <nav aria-label="Navigasi utama">${[['builder', 'grid', 'Team Builder'], ['trekkers', 'people', 'Trekkers'], ['discs', 'disc', 'Discs'], ['guide', 'book', 'Panduan']].map(([id, i, label]) => `<button class="nav-item ${page === id ? 'active' : ''}" data-action="nav" data-page="${id}" ${page === id ? 'aria-current="page"' : ''}>${icon(i)}${label}</button>`).join('')}</nav>
    <button class="saved-button" data-action="saved">${icon('bookmark')}<span>Build tersimpan</span><span class="count">${saved.length}</span></button></div></header>`;
}
function hero() {
  return `<section class="hero"><div class="hero-copy"><div class="eyebrow"><span class="tiny-spark">✦</span> STELLA SORA TEAM COMPANION</div><h1>Tim yang tepat.<br/>Petualangan yang <span>lebih hebat.</span></h1><p>Temukan sinergi Trekker, arah build, dan Disc yang saling melengkapi.<br class="desktop-only"/> Mulai dari koleksimu, atau jelajahi semua kemungkinan.</p><div class="hero-meta"><span><i class="live-dot"></i> ${TREKKERS.length} Trekker</span><span>${DISCS.length} Disc</span><span>${live.lastSuccessAt ? 'Katalog tersinkron' : 'Katalog awal'}</span></div></div>
    <div class="orbit-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><div class="orbit-center">${icon('star')}</div><div class="orbit-label orbit-label-one">${icon('people')} TEAM SYNERGY</div><div class="orbit-label orbit-label-two">${icon('disc')} PERFECT HARMONY</div><span class="orbit-point point-one">✦</span><span class="orbit-point point-two">✧</span><span class="orbit-point point-three"></span><div class="orbit-caption">A LITTLE STRATEGY. A LOT OF POSSIBILITIES.</div></div></section>`;
}
function controls() {
  const mainOptions = TREKKERS.filter(t => t.role !== 'Support' && (state.mode !== 'collection' || state.ownedTrekkers.includes(t.id)) && (state.element === 'all' || t.element === state.element));
  return `<section class="control-panel" aria-labelledby="config-heading"><div class="control-top"><div><div class="section-kicker">01 / PREFERENSI TIM</div><h2 id="config-heading">Mulai dengan caramu</h2></div><div class="segmented" aria-label="Mode rekomendasi"><button data-action="mode" data-value="collection" aria-pressed="${state.mode === 'collection'}" class="${state.mode === 'collection' ? 'active' : ''}">${icon('people')}Koleksiku</button><button data-action="mode" data-value="explore" aria-pressed="${state.mode === 'explore'}" class="${state.mode === 'explore' ? 'active' : ''}">${icon('star')}Eksplorasi</button></div></div>
    <div class="mode-description">${state.mode === 'collection' ? `<span>${icon('check')} Menggunakan ${state.ownedTrekkers.length} Trekker dan ${state.ownedDiscs.length} Disc milikmu.</span><button class="text-button" data-action="collection">Kelola koleksi ${icon('arrow')}</button>` : `<span>${icon('info')} Jelajahi seluruh katalog, termasuk Trekker dan Disc yang belum kamu miliki.</span><button class="text-button" data-action="collection">Atur koleksi ${icon('arrow')}</button>`}</div>
    <div class="control-fields"><div class="element-field"><label>Elemen utama</label><div class="element-options">${['all', ...elements].map(el => `<button data-action="element" data-value="${el}" title="${el === 'all' ? 'Semua elemen' : el}" aria-pressed="${state.element === el}" class="element-option ${el.toLowerCase()} ${state.element === el ? 'selected' : ''}">${el === 'all' ? icon('grid') : icon(elementIcons[el])}<span>${el === 'all' ? 'Semua' : el}</span></button>`).join('')}</div></div>
    <div class="select-field"><label for="goal-select">Target permainan</label><select id="goal-select">${Object.entries(goals).map(([value, label]) => `<option value="${value}" ${state.goal === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
    <div class="select-field"><label for="main-select">Trekker utama <span>opsional</span></label><select id="main-select"><option value="">Pilihkan untukku</option>${mainOptions.map(t => `<option value="${esc(t.id)}" ${state.lockedMain === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div></div>
    <div class="control-bottom"><button class="text-button data-status" data-action="nav" data-page="sources">${icon('shield')} ${live.lastSuccessAt ? 'Status data & sumber komunitas' : 'Katalog awal · lihat status sinkronisasi'} ${icon('arrow')}</button><button class="primary-button" data-action="generate">${icon('star')} Temukan timku ${icon('arrow')}</button></div></section>`;
}
function emptyResults() {
  const insufficient = state.mode === 'collection' && state.ownedTrekkers.length < 3;
  return `<section class="empty-state"><span class="empty-icon">${icon('people')}</span><h2>${insufficient ? 'Petualangan dimulai dari koleksimu' : 'Belum ada tim yang sesuai'}</h2><p>${insufficient ? 'Tandai minimal 3 Trekker yang kamu miliki, termasuk Vanguard atau Versatile untuk posisi Main. Tambahkan Disc untuk mendapatkan loadout.' : 'Coba elemen lain, lepaskan pilihan Trekker utama, atau tambahkan anggota koleksi.'}</p><button class="primary-button" data-action="${insufficient ? 'collection' : 'reset-filter'}">${insufficient ? 'Pilih koleksiku' : 'Reset filter tim'} ${icon('arrow')}</button></section>`;
}
function characterCard(t, slot) {
  return `<button class="character-card ${t.element.toLowerCase()} ${activeBuild === slot ? 'build-selected' : ''}" data-action="build-tab" data-index="${slot}" aria-label="Lihat build ${esc(t.name)}"><div class="character-visual"><span class="slot-label ${slot === 0 ? 'main-slot' : ''}">${slot === 0 ? icon('bolt') : icon('people')}${slot === 0 ? 'MAIN' : `SUPPORT ${slot}`}</span><span class="character-watermark">${esc(t.element)}</span>${imageTag(t)}<span class="rarity" aria-label="${t.rarity} bintang">${'★'.repeat(t.rarity)}</span></div><div class="character-info"><span class="character-role">${esc(t.role)}</span><div class="character-name"><h3>${esc(t.name)}</h3>${icon('chevron')}</div><div class="character-tags">${badge(t.element)}<span>${esc(tagLabels[t.damageTags?.[0]] || tagLabels[t.supportTags?.[0]] || t.role)}</span></div></div></button>`;
}
function teamResults() {
  if (!teams.length) return emptyResults();
  const team = teams[selectedTeam];
  const units = [team.main, ...team.supports];
  return `<section id="results" class="results-section" aria-labelledby="results-heading"><div class="section-heading"><div><div class="section-kicker">02 / REKOMENDASI</div><h2 id="results-heading">Temukan harmoni timmu <span class="soft-count">${teams.length} opsi tim</span></h2></div><span class="result-context">${badge(team.main.element)}<span>${goals[state.goal]}</span></span></div>
    <div class="result-tabs" aria-label="Pilihan tim">${teams.map((t, i) => `<button data-action="team" data-index="${i}" class="${i === selectedTeam ? 'active' : ''}" aria-pressed="${i === selectedTeam}"><span class="tab-index">0${i + 1}</span><span>${i === 0 ? 'Pilihan utama' : `Alternatif ${i}`}<small>${esc(t.main.name)} & tim</small></span><span class="tab-score">${t.score}<small>/100</small></span>${i === 0 ? '<span class="best-tag">REKOMENDASI</span>' : ''}</button>`).join('')}</div>
    <div class="team-layout"><div><div class="character-grid">${units.map(characterCard).join('')}</div><div class="team-note">${icon('info')} 1 Main + 2 Support. Pilih Trekker untuk melihat arah build-nya.</div></div>
    <aside class="synergy-panel"><div class="synergy-title"><span>${icon('star')} Kecocokan tim</span><span class="heuristic-label">HEURISTIK</span></div><div class="score-row"><strong>${team.score}<span>/100</span></strong><div class="score-ring" style="--score:${team.score}">${icon('check')}</div></div><p class="score-description">Kesesuaian komposisi dan Disc dengan preferensimu; bukan angka DPS.</p><div class="score-breakdown">${team.breakdown.map(b => `<div><span>${esc(b.label)}</span><span class="meter"><i style="width:${Math.max(0, Math.min(100, b.value / b.max * 100))}%"></i></span><b>${Math.round(b.value)}<small>/${b.max}</small></b></div>`).join('')}</div><div class="synergy-reasons">${team.reasons.slice(0, 3).map(r => `<p>${icon('check')}<span>${esc(r)}</span></p>`).join('')}</div></aside></div>
    ${team.warnings.length ? `<div class="warning-note">${icon('info')}<div>${team.warnings.map(w => `<p>${esc(w)}</p>`).join('')}</div></div>` : ''}
    <div class="evidence-box"><div>${icon('book')}<strong>${esc(team.evidenceLabel)}</strong></div>${team.evidence?.length ? team.evidence.map(e => `<p>${esc(e.summary)} <a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(e.sourceLabel)} ↗</a></p><small>${esc(e.conditions)}</small>`).join('') : '<p>Urutan tim ini menggunakan kecocokan kit. Penemuan kiriman atau video saja belum membuktikan kekuatan sebuah build.</p>'}${team.communityPoints ? `<small>Sinyal komunitas +${team.communityPoints} untuk urutan hasil; skor kecocokan kit tetap ${team.score}/100.</small>` : ''}<button class="text-button" data-action="nav" data-page="sources">Lihat sumber & pembaruan ${icon('arrow')}</button></div>
    <div class="result-actions"><span>${icon('check')} ${state.mode === 'collection' ? 'Seluruh rekomendasi berasal dari koleksimu' : 'Mode eksplorasi · kepemilikan tidak dibatasi'}</span><div><button class="secondary-button" data-action="share">${icon('share')} Bagikan</button><button class="secondary-button" data-action="save">${icon('bookmark')} Simpan build</button></div></div></section>${buildSection(team)}${discSection(team)}`;
}
function buildSection(team) {
  const units = [team.main, ...team.supports];
  const t = units[activeBuild] || units[0];
  const position = activeBuild === 0 ? 'main' : 'support';
  const build = t.builds?.[position] || (t.buildPosition === position ? t.build : { focus: `${position === 'main' ? 'Main' : 'Support'} · panduan posisi`, stats: ['ATK', `${t.element} DMG`], potentials: ['Periksa Potential yang berlaku pada posisi ini'], skills: [`Prioritaskan ${position === 'main' ? 'Main' : 'Support'} Skill`], tip: 'Belum ada jalur terkurasi untuk posisi ini. Gunakan referensi kit untuk memastikan syarat skill dan Potential.' });
  return `<section class="build-section" id="trekker-build"><div class="section-heading"><div><div class="section-kicker">03 / ARAH BUILD TREKKER</div><h2>Setiap anggota punya peran</h2></div><a class="text-button" href="${esc(t.source)}" target="_blank" rel="noopener noreferrer">Referensi Trekker ${icon('share')}</a></div><div class="build-panel"><div class="build-tabs" aria-label="Build anggota tim">${units.map((unit, i) => `<button data-action="build-tab" data-index="${i}" class="${activeBuild === i ? 'active' : ''}" aria-pressed="${activeBuild === i}"><span class="mini-avatar ${unit.element.toLowerCase()}">${imageTag(unit)}</span><span>${esc(unit.name)}<small>${i === 0 ? 'Main Trekker' : 'Support Trekker'}</small></span>${activeBuild === i ? icon('check') : ''}</button>`).join('')}</div>
    <div class="build-body"><div class="build-intro"><span class="element-symbol ${t.element.toLowerCase()}">${icon(elementIcons[t.element])}</span><div><h3>${esc(build.focus || t.name)}</h3><p>${esc(t.summary)}</p></div></div><div class="build-columns"><div><h4><span>01</span> Prioritas stat</h4><div class="priority-pills">${(build.stats || []).map((stat, i) => `<span><small>${i + 1}</small>${esc(stat)}</span>`).join('')}</div></div><div><h4><span>02</span> Arah Potential</h4><ul>${(build.potentials || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul></div><div><h4><span>03</span> Prioritas skill</h4><ol>${(build.skills || []).map(p => `<li>${esc(p)}</li>`).join('')}</ol></div></div><div class="build-tip">${icon('bolt')}<p>${activeBuild > 0 ? '<strong>Posisi Support:</strong> prioritaskan efek Support Skill dan buff yang berlaku untuk anggota tim. ' : ''}${esc(build.tip)}</p></div><p class="small-note">${t.analysisStatus === 'inferred' ? 'Analisis awal kit; belum diuji komunitas.' : 'Arah build terkurasi.'} Sesuaikan Potential dengan posisi, jalur build, dan opsi yang muncul saat run.</p></div></div></section>`;
}
function discItem(entry, index, support = false) {
  const d = entry.disc;
  return `<button class="disc-card" data-action="disc-detail" data-id="${esc(d.id)}"><span class="disc-number">0${index + 1}</span><span class="disc-cover ${d.element.toLowerCase()}">${d.image ? imageTag(d) : icon('disc')}<span>${d.rarity}★</span></span><span class="disc-content"><strong>${esc(d.name)}</strong><span>${badge(d.element)}<small>${support ? 'Slot Support' : esc(tagLabels[d.tags?.[0]] || 'Pelengkap tim')}</small></span><small class="disc-summary">${esc(d.summary)}</small></span>${icon('chevron')}</button>`;
}
function discSection(team) {
  return `<section class="disc-section"><div class="section-heading"><div><div class="section-kicker">04 / DISC LOADOUT</div><h2>Lengkapi ritme timmu</h2></div><button class="text-button" data-action="disc-alternatives">Lihat alternatif ${icon('arrow')}</button></div><div class="disc-help">${icon('disc')} Disc disusun untuk satu tim: hingga 3 Main dan 3 Support. Buka Disc untuk melihat alasan dan referensinya.</div><div class="disc-columns">${[['main', 'Main Discs', 'Prioritas kecocokan efek dengan tim'], ['support', 'Support Discs', 'Pelengkap elemen dan kebutuhan loadout']].map(([key, title, subtitle]) => `<div class="disc-group"><div class="disc-group-title"><h3>${title} <span>${team.discs[key].length}/3</span></h3><p>${subtitle}</p></div>${team.discs[key].map((d, i) => discItem(d, i, key === 'support')).join('')}${team.discs[key].length < 3 ? `<div class="empty-disc">${icon('plus')} ${3 - team.discs[key].length} slot belum terisi${state.mode === 'collection' ? ' · tambahkan Disc di koleksi' : ''}</div>` : ''}</div>`).join('')}</div><p class="small-note">Aktivasi Harmony tetap bergantung pada Musical Notes saat run. Rekomendasi ini belum menghitung level, Crescendo, atau jumlah Notes yang terkumpul.</p></section>`;
}
function catalogContent(inDialog = false) {
  const list = catalogKind === 'trekkers' ? TREKKERS : DISCS;
  const owned = catalogKind === 'trekkers' ? state.ownedTrekkers : state.ownedDiscs;
  const items = list.filter(item => item.name.toLowerCase().includes(catalogSearch.toLowerCase()) && (catalogElement === 'all' || catalogElement === item.element) && (!catalogOwnedOnly || owned.includes(item.id)));
  return `<div class="catalog-toolbar"><div class="segmented"><button data-action="catalog-kind" data-value="trekkers" class="${catalogKind === 'trekkers' ? 'active' : ''}" aria-pressed="${catalogKind === 'trekkers'}">${icon('people')}Trekkers <small>${state.ownedTrekkers.length}/${TREKKERS.length}</small></button><button data-action="catalog-kind" data-value="discs" class="${catalogKind === 'discs' ? 'active' : ''}" aria-pressed="${catalogKind === 'discs'}">${icon('disc')}Discs <small>${state.ownedDiscs.length}/${DISCS.length}</small></button></div><label class="search-field">${icon('search')}<input id="catalog-search" type="search" placeholder="Cari ${catalogKind === 'trekkers' ? 'Trekker' : 'Disc'}…" value="${esc(catalogSearch)}" aria-label="Cari dalam katalog" /></label></div><div class="catalog-filter"><label>Elemen <select id="catalog-element" aria-label="Filter elemen katalog"><option value="all">Semua</option>${[...elements, ...(catalogKind === 'discs' ? ['Neutral'] : [])].map(el => `<option ${catalogElement === el ? 'selected' : ''}>${el}</option>`).join('')}</select></label><label class="check-label"><input type="checkbox" id="owned-only" ${catalogOwnedOnly ? 'checked' : ''}/> Milikku saja</label><span>${items.length} ditemukan</span></div><div class="catalog-grid ${catalogKind === 'discs' ? 'catalog-discs' : ''}">${items.map(item => `<button class="collection-card ${item.element.toLowerCase()} ${owned.includes(item.id) ? 'owned' : ''}" data-action="toggle-owned" data-kind="${catalogKind}" data-id="${esc(item.id)}" aria-pressed="${owned.includes(item.id)}" aria-label="${owned.includes(item.id) ? 'Hapus' : 'Tambahkan'} ${esc(item.name)} ${owned.includes(item.id) ? 'dari' : 'ke'} koleksi"><span class="ownership-check">${icon(owned.includes(item.id) ? 'check' : 'plus')}</span><span class="collection-visual">${imageTag(item)}<span class="collection-rarity">${'★'.repeat(item.rarity)}</span></span><span class="collection-info"><strong>${esc(item.name)}</strong><span>${badge(item.element)}<small>${esc(item.role || `${item.rarity}★ Disc`)}</small></span></span></button>`).join('') || '<div class="catalog-empty">Tidak ada hasil. Coba nama atau filter lain.</div>'}</div>${inDialog ? '' : `<div class="catalog-footer"><p>Pilihan disimpan di browser ini dan digunakan dalam mode Koleksiku.</p><div><button class="secondary-button" data-action="export">${icon('download')} Ekspor data</button><button class="secondary-button" data-action="import">${icon('plus')} Impor data</button></div></div>`}`;
}
function catalogPage() {
  return `<section class="page-intro"><div class="eyebrow">YOUR PERSONAL COLLECTION</div><h1>${page === 'trekkers' ? 'Kenali para Trekker.' : 'Temukan Disc yang pas.'}</h1><p>Tandai yang kamu miliki. Biarkan rekomendasi menyesuaikan dengan koleksimu.</p></section><section class="catalog-panel" id="catalog-container">${catalogContent()}</section>`;
}
function sourcesPage() {
  const date = value => value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Belum tersedia';
  const labels = { ok: 'Berhasil diperiksa', error: 'Pemeriksaan gagal', reference: 'Referensi awal', 'not-configured': 'Belum terhubung' };
  const active = validClaims(live.claims, { revision: live.revision, sourceStates: live.sources, pendingBalanceReview: live.pendingBalanceReview });
  return `<section class="page-intro"><div class="eyebrow">EVIDENCE, NOT GUESSWORK</div><h1>Rekomendasi yang bisa ditelusuri.</h1><p>Ikuti perubahan kit, baca sumber komunitas, dan lihat seberapa baru dasar rekomendasimu.</p></section>
    <section class="sync-summary"><div><span class="section-kicker">VERSI DATA AKTIF</span><h2>${esc(live.revision)}</h2><p>${live.lastSuccessAt ? `Sinkronisasi katalog terakhir: ${date(live.lastSuccessAt)}` : 'Katalog awal masih digunakan. Sinkronisasi data game belum berhasil.'}</p></div><div><strong>${active.length}</strong><span>Klaim komunitas aktif</span></div><div><strong>${live.changes?.length || 0}</strong><span>Perubahan pada cek terakhir</span></div></section>
    <div class="sync-notice">${icon('info')}<p>Pemeriksaan dijadwalkan setiap 6 jam saat server berjalan atau workflow GitHub aktif. Karakter baru dan perubahan kit memicu perhitungan ulang. Hasil dengan kit baru diberi label analisis awal sampai referensi build diperbarui. Kegagalan sumber mempertahankan snapshot terakhir.</p></div>
    <section class="source-grid">${live.sources.length ? live.sources.map(s => `<article class="source-card"><div><span class="source-type">${['youtube', 'google', 'facebook'].includes(s.id) ? 'PLATFORM KOMUNITAS' : s.id === 'stellabase' ? 'DATABASE GAME KOMUNITAS' : s.id === 'official-news' ? 'SUMBER RESMI' : 'REFERENSI KOMUNITAS'}</span><span class="source-state ${s.status === 'ok' ? 'is-ok' : ''}">${esc(labels[s.status] || s.status)}</span></div><h3>${esc(s.label)}</h3><p>${esc(s.message)}</p><small>Berhasil: ${date(s.lastSuccessAt)}</small></article>`).join('') : '<article class="source-card"><h3>Server sinkronisasi belum tersedia</h3><p>Jalankan aplikasi melalui npm start agar API katalog dan pemantau sumber aktif.</p></article>'}</section>
    <section class="method-panel"><h2>Bagaimana sumber memengaruhi hasil?</h2><p>Data kit menjadi dasar kecocokan. Referensi komunitas yang memuat tim, jalur damage, penulis, tanggal, dan revisi data yang cocok dapat memberi sinyal tambahan untuk urutan rekomendasi. Satu penulis yang mengunggah ulang panduan di beberapa platform tetap dihitung sekali. Jumlah view atau like tidak digunakan sebagai ukuran kekuatan.</p><p>Kiriman yang baru ditemukan belum otomatis menjadi fakta. Video saat ini diambil sebagai metadata; tidak ada klaim bahwa transkripnya sudah dipahami. Untuk analisis otomatis dari komunitas, hubungkan feed build terstruktur dari kurator tepercaya. Klaim yang kedaluwarsa, sumbernya berubah, atau revisi kit-nya berbeda tidak menaikkan ranking.</p><p>Buff atau nerf angka akan terdeteksi sebagai perubahan data dan membatalkan validasi build lama. Mesin saat ini belum menyimulasikan DPS, sehingga perubahan multiplier tidak selalu mengubah urutan tim tanpa bukti pengujian terbaru.</p><button class="text-button" data-action="nav" data-page="guide">Pelajari metode kecocokan ${icon('arrow')}</button></section>
    ${live.changes?.length ? `<section class="updates-panel"><div class="section-heading"><h2>Perubahan kit terdeteksi</h2></div><div class="change-list">${live.changes.slice(0, 40).map(c => `<span><strong>${esc(c.name)}</strong><small>${c.type === 'new' ? 'Baru' : 'Kit berubah'} · ${c.kind === 'trekkers' ? 'Trekker' : 'Disc'}</small></span>`).join('')}</div></section>` : ''}
    <section class="updates-panel"><div class="section-heading"><h2>Referensi & penemuan terbaru</h2><span class="small-note">Diperiksa: ${date(live.checkedAt)}</span></div><div class="document-list">${(live.documents || []).slice(0, 30).map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer"><span class="document-icon">${icon(d.kind === 'official' ? 'shield' : 'book')}</span><span><strong>${esc(d.title)}</strong><small>${esc(d.sourceLabel)} · ${d.publishedAt ? date(d.publishedAt) : 'Tanggal publikasi belum terkonfirmasi'} · ${d.status === 'reference' ? 'Referensi awal' : 'Belum divalidasi sebagai bukti build'}</small></span>${icon('share')}</a>`).join('') || '<p>Belum ada penemuan baru. Status tiap konektor ditampilkan di atas.</p>'}</div></section>`;
}
function guidePage() {
  return `<section class="page-intro"><div class="eyebrow">A LITTLE GUIDANCE</div><h1>Tim bagus dimulai dari sinergi.</h1><p>Kenali cara kerja rekomendasi dan gunakan hasilnya sebagai titik awal.</p></section><div class="guide-grid"><article class="guide-card"><span class="guide-number">01</span><h2>Tentukan satu Main</h2><p>Tim terdiri dari satu Main dan dua Support. Mulai dari pola damage Main, lalu cari anggota yang membantu pola tersebut. Rekomendasi awal memprioritaskan Vanguard atau Versatile untuk Main.</p></article><article class="guide-card"><span class="guide-number">02</span><h2>Pilih sesuai kebutuhan</h2><p>Target boss menekankan damage terarah; wave memberi nilai pada kontrol; survival lebih menghargai heal dan shield. Kesamaan elemen menjadi salah satu faktor, bersama kecocokan peran dan dukungan.</p></article><article class="guide-card"><span class="guide-number">03</span><h2>Disc adalah loadout tim</h2><p>Pilih hingga tiga Main Disc dan tiga Support Disc yang berbeda. Perhatikan elemen, sasaran efek, serta syarat Musical Notes. Kecocokan elemen saja belum menjamin seluruh efek aktif.</p></article><article class="guide-card"><span class="guide-number">04</span><h2>Bangun Record dengan arah</h2><p>Gunakan prioritas stat, skill, dan arah Potential sebagai panduan saat run. Hasil dapat berubah mengikuti Potential yang tersedia, talent, investasi, dan mekanik musuh.</p></article></div><section class="method-panel"><h2>Apa arti skor kecocokan?</h2><p>Skor 0–100 adalah penilaian berbasis aturan untuk membandingkan kombinasi dalam katalog. Faktor penilaiannya ditampilkan di setiap rekomendasi: elemen, peran, dukungan pola damage, kebutuhan target, dan Disc. Skor bukan simulasi DPS, peluang menang, atau tier list resmi.</p><p>Mode Koleksiku menyaring Trekker, Disc, dan alternatif berdasarkan kepemilikan. Mode Eksplorasi mencakup seluruh katalog awal. Aplikasi belum memodelkan level, Talent, Crescendo, rotasi rinci, Harmony aktif, resistansi musuh, atau aturan event tertentu.</p><h3>Data dan referensi</h3><p>${esc(DATA_META.note)} Diperiksa ${esc(DATA_META.checkedAt)}.</p><div class="source-links">${(DATA_META.sources || []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ${icon('share')}</a>`).join('')}</div><p class="small-note">Proyek penggemar independen; tidak berafiliasi dengan Yostar. Nama dan ilustrasi game merupakan milik pemegang haknya.</p></section>`;
}
function render() {
  $('#app').innerHTML = `${header()}<main id="main" class="container">${page === 'builder' ? `${hero()}${sharedNotice ? '<div class="shared-note">Build dari tautan dimuat. Koleksi dalam tautan digunakan untuk mereproduksi rekomendasi ini.</div>' : ''}${controls()}${teamResults()}` : page === 'guide' ? guidePage() : page === 'sources' ? sourcesPage() : catalogPage()}<footer><a class="footer-brand" href="#" data-action="nav" data-page="builder">${icon('star')} stella studio</a><p>Dibuat untuk perjalananmu di Nova. <span>Fan-made companion.</span></p><button class="text-button" data-action="nav" data-page="sources">Sumber & pembaruan ${icon('arrow')}</button></footer>${!storageAvailable ? '<div class="storage-note">Penyimpanan browser tidak tersedia. Ekspor data agar koleksimu tidak hilang.</div>' : ''}</main>`;
}
function openDialog(title, content, wide = false) {
  const dialog = $('#dialog');
  dialog.className = wide ? 'wide-dialog' : '';
  dialog.innerHTML = `<div class="dialog-header"><div><div class="section-kicker">STELLA STUDIO</div><h2 id="dialog-title">${esc(title)}</h2></div><button class="icon-button" data-action="close-dialog" aria-label="Tutup dialog">${icon('close')}</button></div>${content}`;
  if (!dialog.open) dialog.showModal();
}
function openCollection() {
  catalogSearch = ''; catalogElement = 'all'; catalogOwnedOnly = false;
  openDialog('Koleksi milikmu', `<p class="dialog-description">Pilih Trekker dan Disc yang sudah kamu miliki. Kamu bisa mengubahnya kapan saja.</p><div id="dialog-catalog">${catalogContent(true)}</div><div class="dialog-footer"><span id="collection-count">${state.ownedTrekkers.length} Trekker · ${state.ownedDiscs.length} Disc dipilih</span><button class="primary-button" data-action="apply-collection">Gunakan koleksi ${icon('arrow')}</button></div>`, true);
}
function refreshCatalog(keepSearchFocus = false) {
  const input = $('#catalog-search');
  const pos = input?.selectionStart;
  const container = $('#dialog').open ? $('#dialog-catalog') : $('#catalog-container');
  if (container) container.innerHTML = catalogContent($('#dialog').open);
  const count = $('#collection-count');
  if (count) count.textContent = `${state.ownedTrekkers.length} Trekker · ${state.ownedDiscs.length} Disc dipilih`;
  if (keepSearchFocus) { $('#catalog-search')?.focus(); try { $('#catalog-search')?.setSelectionRange(pos, pos); } catch {} }
}
function discDetail(id) {
  const disc = DISCS.find(d => d.id === id);
  if (!disc) return;
  const team = teams[selectedTeam];
  const entries = team ? [...team.discs.main, ...team.discs.support, ...team.alternatives] : [];
  const entry = entries.find(e => e.disc.id === id);
  openDialog(disc.name, `<div class="disc-detail"><div class="disc-detail-top"><span class="disc-cover large ${disc.element.toLowerCase()}">${disc.image ? imageTag(disc) : icon('disc')}</span><div>${badge(disc.element)}<p>${disc.rarity}★ Runic Disc</p><div class="tag-row">${disc.tags.map(t => `<span>${esc(tagLabels[t] || t)}</span>`).join('')}</div></div></div><p>${esc(disc.summary)}</p>${entry ? `<h3>Alasan dipilih</h3><ul>${entry.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}<p class="note-box">${esc(disc.notes || 'Cek Musical Notes dan syarat skill pada referensi sebelum menentukan loadout akhir.')}</p><a class="secondary-button" href="${esc(disc.source)}" target="_blank" rel="noopener noreferrer">Buka data Disc ${icon('share')}</a></div>`);
}
async function share() {
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(state))));
  const link = `${location.origin}${location.pathname}#build=${encoded}`;
  try { await navigator.clipboard.writeText(link); toast('Tautan konfigurasi disalin. Penerima dapat melihat semua opsi tim.'); }
  catch { openDialog('Bagikan konfigurasi', `<p class="dialog-description">Salin tautan ini. Penerima perlu membuka aplikasi pada alamat yang sama.</p><textarea readonly class="share-link" aria-label="Tautan konfigurasi">${esc(link)}</textarea>`); }
}
function showSaved() {
  openDialog('Build tersimpan', `<div class="saved-list">${saved.length ? saved.map(s => `<div class="saved-entry"><span>${icon('bookmark')}<strong>${esc(s.name)}</strong><small>${esc(goals[s.settings.goal])} · ${s.settings.mode === 'collection' ? 'Koleksiku' : 'Eksplorasi'}</small></span><button class="secondary-button" data-action="load-saved" data-id="${esc(s.id)}">Buka</button><button class="icon-button" data-action="delete-saved" data-id="${esc(s.id)}" aria-label="Hapus build ${esc(s.name)}">${icon('close')}</button></div>`).join('') : `<div class="empty-saved">${icon('bookmark')}<h3>Belum ada build tersimpan</h3><p>Temukan tim yang kamu suka, lalu pilih Simpan build.</p></div>`}</div><div class="dialog-footer"><span>Disimpan di browser ini · maksimal 20 build</span><button class="secondary-button" data-action="export">${icon('download')} Ekspor</button></div>`);
}
function exportData() {
  const blob = new Blob([JSON.stringify({ version: 1, settings: state, saved }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = 'stella-studio-koleksi.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('Koleksi dan build diekspor.');
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  event.preventDefault();
  const { action, value, id, index } = button.dataset;
  switch (action) {
    case 'nav': page = button.dataset.page; if (page === 'builder') calculate(); if (page === 'trekkers' || page === 'discs') { catalogKind = page; catalogSearch = ''; catalogElement = 'all'; catalogOwnedOnly = false; } render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'mode': state.mode = value; state.lockedMain = ''; sharedNotice = false; calculate(); persist(); render(); break;
    case 'element': state.element = value; state.lockedMain = ''; calculate(); persist(); render(); break;
    case 'generate': calculate(); persist(); render(); $('#results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); toast(teams.length ? `${teams.length} opsi tim dihitung sesuai preferensimu.` : 'Belum cukup anggota yang sesuai. Periksa koleksi dan filter.'); break;
    case 'reset-filter': state.element = 'all'; state.lockedMain = ''; calculate(); persist(); render(); break;
    case 'team': selectedTeam = Number(index); activeBuild = 0; render(); break;
    case 'build-tab': activeBuild = Number(index); render(); break;
    case 'collection': openCollection(); break;
    case 'close-dialog': $('#dialog').close(); calculate(); render(); break;
    case 'apply-collection': state.mode = 'collection'; state.lockedMain = ''; sharedNotice = false; page = 'builder'; calculate(); persist(); $('#dialog').close(); render(); toast('Koleksi diterapkan ke rekomendasi.'); break;
    case 'catalog-kind': catalogKind = value; catalogSearch = ''; catalogElement = 'all'; refreshCatalog(); break;
    case 'toggle-owned': {
      const key = button.dataset.kind === 'trekkers' ? 'ownedTrekkers' : 'ownedDiscs';
      state[key] = state[key].includes(id) ? state[key].filter(v => v !== id) : [...state[key], id];
      if (key === 'ownedTrekkers' && state.lockedMain === id && !state[key].includes(id) && state.mode === 'collection') state.lockedMain = '';
      persist(); refreshCatalog(); break;
    }
    case 'disc-detail': discDetail(id); break;
    case 'disc-alternatives': {
      const alternatives = teams[selectedTeam]?.alternatives || [];
      openDialog('Alternatif Disc', `<p class="dialog-description">Opsi cadangan untuk kebutuhan atau preferensi lain. Periksa kembali efek dan Musical Notes saat mengganti Disc.</p><div class="alternative-list">${alternatives.length ? alternatives.map(discItem).join('') : '<p>Belum ada Disc alternatif yang tersedia. Tambahkan Disc ke koleksi atau gunakan mode Eksplorasi.</p>'}</div>`); break;
    }
    case 'share': await share(); break;
    case 'save': {
      const team = teams[selectedTeam]; if (!team) break;
      if (saved.length >= 20) { toast('Penyimpanan penuh. Hapus salah satu build atau ekspor data dahulu.'); break; }
      saved.unshift({ id: crypto.randomUUID(), name: [team.main, ...team.supports].map(t => t.name).join(' / '), teamId: team.id, settings: structuredClone(state) });
      persist(); render(); toast(storageAvailable ? 'Build tersimpan di browser ini.' : 'Build belum tersimpan permanen. Gunakan ekspor data.'); break;
    }
    case 'saved': showSaved(); break;
    case 'load-saved': {
      const entry = saved.find(s => s.id === id); if (!entry) break;
      state = sanitize(entry.settings); page = 'builder'; calculate();
      const found = teams.findIndex(t => t.id === entry.teamId); selectedTeam = Math.max(found, 0);
      persist(); $('#dialog').close(); render(); toast(found >= 0 ? 'Build tersimpan dibuka.' : 'Katalog berubah. Rekomendasi terbaru ditampilkan.'); break;
    }
    case 'delete-saved': saved = saved.filter(s => s.id !== id); persist(); render(); showSaved(); break;
    case 'export': exportData(); break;
    case 'import': $('#import-file').click(); break;
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'goal-select' || event.target.id === 'main-select') { state[event.target.id === 'goal-select' ? 'goal' : 'lockedMain'] = event.target.value; calculate(); persist(); render(); }
  if (event.target.id === 'catalog-element') { catalogElement = event.target.value; refreshCatalog(); }
  if (event.target.id === 'owned-only') { catalogOwnedOnly = event.target.checked; refreshCatalog(); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'catalog-search') { catalogSearch = event.target.value; refreshCatalog(true); }
});
$('#dialog').addEventListener('cancel', () => { calculate(); render(); });
$('#dialog').addEventListener('click', event => {
  if (event.target !== $('#dialog')) return;
  const rect = $('#dialog').getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { $('#dialog').close(); calculate(); render(); }
});
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 1000000) throw new Error('Berkas terlalu besar. Batasnya 1 MB.');
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !data.settings || !Array.isArray(data.saved)) throw new Error('Gunakan berkas hasil ekspor Stella Studio versi 1.');
    const nextState = sanitize(data.settings);
    const nextSaved = data.saved.slice(0, 20).map(s => {
      if (!s || typeof s.name !== 'string' || typeof s.teamId !== 'string') throw new Error('Data build tersimpan tidak valid.');
      return { id: crypto.randomUUID(), name: s.name.slice(0, 200), teamId: s.teamId.slice(0, 300), settings: sanitize(s.settings) };
    });
    openDialog('Impor koleksi', `<p class="dialog-description">Berkas berisi ${nextState.ownedTrekkers.length} Trekker, ${nextState.ownedDiscs.length} Disc, dan ${nextSaved.length} build. Data ini akan menggantikan koleksi dan build yang sekarang tersimpan di browser.</p><div class="dialog-footer"><button class="secondary-button" data-action="close-dialog">Batal</button><button class="primary-button" id="confirm-import">Terapkan data</button></div>`);
    $('#confirm-import').addEventListener('click', () => { state = nextState; saved = nextSaved; calculate(); persist(); $('#dialog').close(); render(); toast('Koleksi dan build berhasil diimpor.'); }, { once: true });
  } catch (error) { toast(`Impor gagal: ${error.message}`); }
  event.target.value = '';
});
document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement) { event.target.style.display = 'none'; event.target.parentElement?.classList.add('image-unavailable'); }
}, true);
calculate();
render();
setInterval(async () => {
  if (document.hidden || $('#dialog').open) return;
  const previousRevision = live.revision;
  const previousCheck = live.checkedAt;
  try {
    await readLiveData();
    if (live.revision !== previousRevision) {
      state = sanitize(state); calculate(); persist(); render();
      toast('Data kit diperbarui. Rekomendasi dihitung ulang dengan revisi terbaru.');
    } else if (previousCheck !== live.checkedAt) {
      calculate(); render();
    }
  } catch { /* Keep the last usable catalog if the local service is temporarily unavailable. */ }
}, 60000);
