import { hash, plain } from './source-client.js';

const ELEMENTS = ['Aqua', 'Ignis', 'Ventus', 'Terra', 'Lux', 'Umbra', 'Neutral'];
const ROLES = ['Vanguard', 'Versatile', 'Support'];
const ANALYSIS_VERSION = 2;
const TAGS = { basic: /auto.?attack(?:\s+DMG)?|normal attack/i, skill: /skill\s+(?:DMG|damage)/i, ultimate: /ultimate\s+(?:DMG|damage)/i, minion: /minion\s+(?:DMG|damage|ATK)/i };
export function records(payload, kind) {
  if (Array.isArray(payload)) return payload;
  for (const key of [kind, 'data', 'items', 'results']) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (payload?.[key] && typeof payload[key] === 'object') {
      for (const nested of [kind, 'items', 'results']) if (Array.isArray(payload[key][nested])) return payload[key][nested];
    }
  }
  throw new Error(`Format daftar ${kind} berubah; snapshot sebelumnya dipertahankan.`);
}
function unwrap(payload) { return payload?.data && !Array.isArray(payload.data) ? payload.data : payload; }
function label(value) { return typeof value === 'string' ? value : value?.name || value?.en || value?.label || ''; }
function strings(value, depth = 0) {
  if (depth > 10 || value == null) return [];
  if (typeof value === 'string') return [plain(value)];
  return typeof value === 'object' ? Object.values(value).flatMap(v => strings(v, depth + 1)) : [];
}
function named(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return [];
  const own = label(value.name || value.title);
  return [...(own ? [own] : []), ...Object.values(value).filter(v => typeof v === 'object').flatMap(v => named(v, depth + 1))];
}
export function sourceId(item) { return String(item.sourceId || item.source?.match(/\/(\d+)(?:\?|$)/)?.[1] || item.id); }
function identity(record, previous, kind) {
  const name = label(record.name || record.Name);
  const elementName = label(record.element || record.Element).replace(/^None$/i, 'Neutral');
  const element = ELEMENTS.find(el => el.toLowerCase() === elementName.toLowerCase());
  const roleName = label(record.role || record.class || record.position || record.Class);
  const role = ROLES.find(r => r.toLowerCase() === roleName.toLowerCase());
  const rarity = Number(record.rarity ?? record.Rarity ?? record.grade ?? record.star);
  if (!name || name.length > 100 || !element || ![3, 4, 5].includes(rarity) || (kind === 'trekker' && (!role || element === 'Neutral'))) {
    throw new Error(`Identitas ${kind} tidak cocok dengan schema; perlu pemeriksaan adapter.`);
  }
  const numericId = String(record.id ?? record.Id ?? record.ID);
  if (!/^\d{1,10}$/.test(numericId)) throw new Error('ID game tidak valid.');
  return { id: previous?.id || `${kind}-${numericId}`, sourceId: numericId, name, element, rarity, ...(role ? { role } : {}) };
}
function genericBuild(record, element, position) {
  const section = position === 'main' ? record.skill || record.mainSkill || record.skills?.main || record.main : record.supportSkill || record.skills?.support || record.support;
  const core = position === 'main' ? record.potentials?.mainCore || record.mainCore : record.potentials?.supportCore || record.supportCore;
  const text = strings(section || {}).join(' ');
  const tags = Object.entries(TAGS).filter(([, re]) => re.test(text)).map(([tag]) => tag);
  const potentials = Array.isArray(core) ? core.slice(0, 2).map(p => label(p.name)).filter(Boolean) : [];
  const skills = [label(section?.name), label(record.ultimate?.name)].filter(Boolean);
  const positionLabel = position === 'main' ? 'Main' : 'Support';
  return { focus: `${positionLabel} · analisis awal kit terbaru`, damageTags: tags,
    stats: ['ATK', `${element} DMG`], potentials: potentials.length ? potentials : ['Jalur Potential terbaru belum tervalidasi'],
    skills: skills.length ? skills : [`Periksa ${positionLabel} Skill pada referensi game`],
    tip: 'Dibangun ulang dari data yang tersedia. Prioritas ini masih umum; angka buff, urutan rotasi, dan kombinasi Potential belum diuji komunitas.',
    analysisStatus: 'inferred' };
}
export function normalizeRecord(payload, kind, previous, previousHash, curation) {
  const record = unwrap(payload);
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Detail game tidak valid.');
  const info = identity(record, previous, kind);
  const kitKeys = ['id', 'name', 'element', 'position', 'role', 'class', 'grade', 'star', 'rarity', 'normalAttack', 'skill', 'supportSkill', 'ultimate', 'potentials', 'mainCore', 'supportCore', 'talents', 'stats', 'mainSkill', 'secondarySkills', 'supportNote', 'tag', 'dupe', 'melody'];
  const relevant = Object.fromEntries(Object.entries(record).filter(([key]) => kitKeys.includes(key)));
  const fingerprint = hash(relevant);
  const asset = kind === 'trekker' ? record.portrait || record.icon : record.icon;
  const image = previous?.image || (typeof asset === 'string' && /^\/stella\/assets\/[\w.-]+$/.test(asset) ? `https://api.ennead.cc${asset}` : '');
  if (curation?.fingerprint === fingerprint && curation.data && typeof curation.data === 'object') {
    const allowed = ['summary', 'tags', 'notes', 'effectTarget', 'damageTags', 'supportTags', 'supportTagScopes', 'buildPosition', 'builds', 'build'];
    const fields = Object.fromEntries(Object.entries(curation.data).filter(([key]) => allowed.includes(key)));
    return { item: { ...previous, ...info, ...fields, image, source: `https://stella.ennead.cc/${kind === 'trekker' ? 'trekkers' : 'discs'}/${info.sourceId}`, fingerprint, analysisVersion: ANALYSIS_VERSION, analysisStatus: 'curated' }, fingerprint, changed: previousHash !== fingerprint };
  }
  const unchanged = previous && previousHash === fingerprint && previous.analysisVersion === ANALYSIS_VERSION;
  if (unchanged) return { item: { ...previous, ...info, image, fingerprint }, fingerprint, changed: false };
  if (previous && !previousHash && !previous.analysisStatus && previous.name === info.name && previous.element === info.element && previous.role === info.role && kind === 'trekker') {
    const allNames = new Set(named({ skill: record.skill || record.mainSkill, supportSkill: record.supportSkill, ultimate: record.ultimate, potentials: record.potentials || { mainCore: record.mainCore, supportCore: record.supportCore } }));
    const routes = Object.values(previous.builds || { default: previous.build });
    const routeNames = routes.flatMap(b => [...(b?.potentials || []), ...(b?.skills || []).map(s => s.replace(/^(?:Main Skill|Support Skill|Ultimate|Auto Attack):\s*/, ''))]);
    if (routeNames.length && routeNames.every(name => allNames.has(name))) return { item: { ...previous, ...info, fingerprint, analysisVersion: ANALYSIS_VERSION, analysisStatus: 'curated' }, fingerprint, changed: true };
  }
  // The first live fetch also requires revalidation: the seed did not capture numeric kit hashes.
  const allText = strings(relevant).join(' ');
  const source = `https://stella.ennead.cc/${kind === 'trekker' ? 'trekkers' : 'discs'}/${info.sourceId}`;
  const common = { ...info, source, image, fingerprint, analysisVersion: ANALYSIS_VERSION, analysisStatus: 'inferred',
    summary: 'Kit terbaru terdeteksi dari database komunitas. Analisis awal diperbarui; lihat referensi untuk efek lengkap dan kondisi aktivasinya.' };
  if (kind === 'disc') {
    const tags = Object.entries(TAGS).filter(([, re]) => re.test(allText)).map(([tag]) => tag);
    if (/(?:increase|increases|increasing|boost)\b[^.]{0,65}\b(?:ATK|attack|DMG)/i.test(allText)) tags.push('buff');
    const effectNames = { basic: 'Auto Attack', skill: 'Skill', ultimate: 'Ultimate', minion: 'Minion', buff: 'buff' };
    return { item: { ...common, tags, summary: `Disc ${info.element} dengan indikasi efek ${tags.map(t => effectNames[t]).join(', ') || 'khusus'}. Target dan pemicu efek perlu dicocokkan pada referensi.`, notes: 'Data Disc berubah atau baru ditemukan. Persyaratan Melody, Harmony, target efek, dan Musical Notes perlu dicocokkan kembali sebelum investasi.' }, fingerprint, changed: true };
  }
  const main = genericBuild(record, info.element, 'main');
  const support = genericBuild(record, info.element, 'support');
  const supportText = strings(record.supportSkill || record.skills?.support || record.support || {}).join(' ');
  const supportTags = [];
  if (/(?:appl(?:y|ies)|inflict\w*|attach\w*|create\w*)\b[^.]{0,90}(?:\bMark\b|Breeze|Torrent|Radiance|Gloom)/i.test(supportText)) supportTags.push('mark');
  if (/(?:restore|recover|heal)[^.]{0,50}(?:HP|health)/i.test(supportText)) supportTags.push('heal');
  if (/(?:grant\w*|provide\w*|gain\w*|appl(?:y|ies))[^.]{0,50}\bshield\b/i.test(supportText)) supportTags.push('shield');
  if (/(?:pull|gather)[^.]{0,45}(?:enem|target)/i.test(supportText)) supportTags.push('gather');
  if (/(?:increase|boost)[^.]{0,50}(?:allies|team|main Trekker)[^.]{0,40}(?:ATK|DMG)/i.test(supportText)) supportTags.push('buff');
  support.supportTags = supportTags;
  const buildPosition = info.role === 'Vanguard' ? 'main' : 'support';
  return { item: { ...common, damageTags: (buildPosition === 'main' ? main : support).damageTags, supportTags,
    supportTagScopes: { mark: 'same-element', buff: 'same-element' }, buildPosition,
    builds: { main, support }, build: buildPosition === 'main' ? main : support }, fingerprint, changed: true };
}

export function diffCatalog(before, after) {
  const changes = [];
  for (const kind of ['trekkers', 'discs']) {
    const old = new Map(before[kind].map(item => [item.id, item]));
    for (const item of after[kind]) {
      const previous = old.get(item.id);
      if (!previous) changes.push({ kind, id: item.id, name: item.name, type: 'new' });
      else if ((previous.fingerprint || hash(previous)) !== (item.fingerprint || hash(item))) changes.push({ kind, id: item.id, name: item.name, type: 'changed' });
    }
  }
  return changes;
}
