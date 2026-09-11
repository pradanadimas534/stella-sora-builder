import { TREKKERS, DISCS } from './data.js';

const DAMAGE_TAGS = new Set(['skill', 'basic', 'ultimate', 'mark', 'minion']);
const GENERAL_TAGS = new Set(['buff', 'heal', 'shield', 'debuff', 'gather', 'energy']);
const GOALS = {
  balanced: { label: 'seimbang', tags: ['heal', 'shield', 'buff', 'debuff', 'energy'] },
  boss: { label: 'boss', tags: ['debuff', 'buff', 'energy'] },
  farm: { label: 'farming', tags: ['gather', 'energy', 'buff'] },
  survival: { label: 'bertahan', tags: ['heal', 'shield', 'energy'] },
};

const TAG_LABELS = {
  skill: 'skill', basic: 'serangan dasar', ultimate: 'ultimate', mark: 'mark',
  minion: 'minion', buff: 'buff', heal: 'heal', shield: 'shield',
  debuff: 'debuff', gather: 'pengumpulan musuh', energy: 'energi',
};

const tagsOf = (item, field) => Array.isArray(item?.[field]) ? item[field] : [];
const unique = (values) => [...new Set(values)];
const intersect = (a, b) => unique(a.filter((tag) => b.includes(tag)));
const tagNames = (tags) => tags.map((tag) => TAG_LABELS[tag] || tag).join(', ');
const compareIds = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const clamp = (value, maximum) => Math.max(0, Math.min(maximum, value));

const damageTagsOf = (trekker, position) =>
  Array.isArray(trekker.builds?.[position]?.damageTags)
    ? trekker.builds[position].damageTags : tagsOf(trekker, 'damageTags');

function applicableSupportTags(main, support) {
  const tags = Array.isArray(support.builds?.support?.supportTags)
    ? support.builds.support.supportTags : tagsOf(support, 'supportTags');
  const scopes = { ...support.supportTagScopes, ...support.builds?.support?.supportTagScopes };
  return tags.filter((tag) => (tag !== 'mark' && scopes[tag] !== 'same-element') || main.element === support.element);
}

// Elemental Marks are not interchangeable between Trekkers of different elements.
function supportMatches(main, support) {
  return intersect(damageTagsOf(main, 'main'), applicableSupportTags(main, support));
}

function discDamageMatches(disc, trekker, position) {
  if (disc.element !== 'Neutral' && disc.element !== trekker.element) return [];
  if (disc.effectTarget === 'main' && position !== 'main') return [];
  if (disc.effectTarget === 'support' && position !== 'support') return [];
  return intersect(tagsOf(disc, 'tags'), damageTagsOf(trekker, position));
}

function cleanCatalog(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice().sort(compareIds);
}

function goalScore(teamTags, matchingTags, goal) {
  const has = (tag) => teamTags.includes(tag);
  if (goal === 'boss') {
    return 4 + (has('debuff') ? 5 : 0) + (has('buff') ? 4 : 0)
      + (matchingTags.length ? 4 : 0) + (has('energy') ? 3 : 0);
  }
  if (goal === 'farm') {
    return (has('gather') ? 12 : 0) + (has('energy') ? 3 : 0)
      + (has('debuff') ? 2 : 0) + (has('buff') ? 3 : 0);
  }
  if (goal === 'survival') {
    return 3 + (has('heal') ? 9 : 0) + (has('shield') ? 6 : 0)
      + (has('energy') ? 2 : 0);
  }
  return 5 + (has('heal') || has('shield') ? 6 : 0) + (has('buff') ? 4 : 0)
    + (has('debuff') ? 3 : 0) + (has('energy') || has('gather') ? 2 : 0);
}

function discRecommendation(disc, main, supports, goal, lane) {
  const tags = tagsOf(disc, 'tags');
  const directMatch = discDamageMatches(disc, main, 'main');
  const supportingMatch = unique(supports.flatMap((trekker) => discDamageMatches(disc, trekker, 'support')));
  const teamMatch = unique([...directMatch, ...supportingMatch]);
  const sameElement = [main, ...supports].filter((trekker) => trekker.element === disc.element).length;
  const neutral = disc.element === 'Neutral';
  const eligible = neutral || sameElement > 0;
  const general = eligible ? unique(tags.filter((tag) => GENERAL_TAGS.has(tag))) : [];
  const desired = eligible ? intersect(tags, GOALS[goal].tags) : [];
  const reasons = [];
  let score = 10;

  if (lane === 'main') {
    score += disc.element === main.element ? 30 : neutral ? 20 : sameElement ? 10 : 0;
    score += directMatch.length ? 30 : disc.effectTarget === 'support' && supportingMatch.length ? 25 : 0;
    score += general.length ? Math.min(15, 8 + general.length * 3) : teamMatch.length ? 8 : 0;
    if (disc.element === main.element) reasons.push(`Elemen ${disc.element} sesuai dengan ${main.name}.`);
    else if (neutral) reasons.push('Elemen netral memberi pilihan lintas elemen; cek syarat efek disc.');
    else reasons.push(`Elemen ${disc.element} berbeda dari main ${main.element}; cek syarat efeknya.`);
    if (directMatch.length) reasons.push(`Tag ${tagNames(directMatch)} sesuai fokus serangan ${main.name}.`);
    else if (disc.effectTarget === 'support' && supportingMatch.length) reasons.push(`Efek menargetkan anggota pendukung dengan fokus ${tagNames(supportingMatch)}.`);
  } else {
    score += neutral ? 20 : sameElement >= 2 ? 30 : sameElement === 1 ? 20 : 0;
    score += directMatch.length ? 25 : teamMatch.length ? 15 : 0;
    score += general.length ? Math.min(20, 8 + general.length * 4) : 0;
    if (sameElement) reasons.push(`Elemen ${disc.element} sesuai dengan ${sameElement} anggota tim.`);
    else if (neutral) reasons.push('Kandidat netral untuk melengkapi slot pendukung.');
    else reasons.push(`Tidak ada anggota berelemen ${disc.element}; periksa syarat disc.`);
    if (teamMatch.length) reasons.push(`Tag ${tagNames(teamMatch)} relevan untuk profil serangan tim.`);
    reasons.push('Kecocokan slot pendukung bersifat kualitatif; Melody/Harmony tidak diasumsikan aktif.');
  }

  score += desired.length ? Math.min(15, 6 + desired.length * 3) : 0;
  if (desired.length) reasons.push(`Tag ${tagNames(desired)} mendukung kebutuhan ${GOALS[goal].label}.`);
  if (!directMatch.length && !general.length && lane === 'main'
    && !(disc.effectTarget === 'support' && supportingMatch.length)) {
    reasons.push('Belum ada kecocokan tag langsung dengan main; ini pilihan pelengkap.');
  }
  return { disc, score: clamp(Math.round(score), 100), reasons };
}

/** Assign each disc once, maximizing suitability with up to three slots per lane. */
function chooseDiscs(discs, main, supports, goal) {
  const evaluated = discs.map((disc) => ({
    main: discRecommendation(disc, main, supports, goal, 'main'),
    support: discRecommendation(disc, main, supports, goal, 'support'),
  }));
  const mainCount = Math.min(3, discs.length);
  const supportCount = Math.min(3, Math.max(0, discs.length - mainCount));
  const states = Array.from({ length: mainCount + 1 }, () => Array(supportCount + 1).fill(null));
  states[0][0] = { total: 0, main: [], support: [] };

  // Backward updates prevent a disc from occupying two slots in the same team.
  for (const candidate of evaluated) {
    for (let m = mainCount; m >= 0; m -= 1) {
      for (let s = supportCount; s >= 0; s -= 1) {
        let best = states[m][s];
        if (m > 0 && states[m - 1][s]) {
          const previous = states[m - 1][s];
          const total = previous.total + candidate.main.score;
          if (!best || total > best.total) best = {
            total, main: [...previous.main, candidate.main], support: previous.support,
          };
        }
        if (s > 0 && states[m][s - 1]) {
          const previous = states[m][s - 1];
          const total = previous.total + candidate.support.score;
          if (!best || total > best.total) best = {
            total, main: previous.main, support: [...previous.support, candidate.support],
          };
        }
        states[m][s] = best;
      }
    }
  }

  const chosen = states[mainCount][supportCount];
  const order = (a, b) => b.score - a.score || compareIds(a.disc, b.disc);
  const selectedIds = new Set([...chosen.main, ...chosen.support].map(({ disc }) => disc.id));
  const alternatives = evaluated.filter(({ main: item }) => !selectedIds.has(item.disc.id))
    .map((candidate) => candidate.main.score >= candidate.support.score ? candidate.main : candidate.support)
    .sort(order).slice(0, 3);

  return {
    main: chosen.main.slice().sort(order), support: chosen.support.slice().sort(order),
    alternatives, value: Math.round(chosen.total / 600 * 18),
  };
}

function evaluateTeam(main, supports, discs, goal, discCache) {
  const damageTags = damageTagsOf(main, 'main').filter((tag) => DAMAGE_TAGS.has(tag));
  const supportTags = unique(supports.flatMap((trekker) => applicableSupportTags(main, trekker)));
  const matchingTags = unique(supports.flatMap((trekker) => supportMatches(main, trekker)));
  const sameElement = supports.filter((trekker) => trekker.element === main.element).length;
  const elementValue = sameElement * 11 + (2 - sameElement) * 4;
  const roleValue = (main.role === 'Vanguard' ? 6 : main.role === 'Versatile' ? 5 : 1)
    + supports.reduce((sum, trekker) => sum + (trekker.role === 'Support' ? 4 : trekker.role === 'Versatile' ? 3 : 1), 0);
  const synergyValue = supports.reduce((sum, trekker) => {
    const tags = applicableSupportTags(main, trekker);
    const matching = supportMatches(main, trekker);
    return sum + Math.min(13, (matching.length ? 8 : 0)
      + (tags.includes('buff') ? 3 : 0) + (tags.includes('debuff') ? 3 : 0)
      + (tags.includes('energy') ? 1 : 0));
  }, 0);
  const discKey = main.id + '|' + supports.map(t => t.element + ':' + damageTagsOf(t, 'support').slice().sort().join(',')).sort().join('|');
  let selection = discCache?.get(discKey);
  if (!selection) { selection = chooseDiscs(discs, main, supports, goal); discCache?.set(discKey, selection); }
  const breakdown = [
    { label: 'Keselarasan elemen', value: elementValue, max: 22 },
    { label: 'Komposisi peran', value: roleValue, max: 14 },
    { label: 'Sinergi serangan', value: synergyValue, max: 26 },
    { label: 'Kebutuhan mode', value: goalScore(supportTags, matchingTags, goal), max: 20 },
    { label: 'Kecocokan disc', value: selection.value, max: 18 },
  ];
  const reasons = [
    `${main.name} menjadi main dengan fokus ${tagNames(damageTags) || 'serangan sesuai build'}; ${supports.map((trekker) => trekker.name).join(' dan ')} mengisi dua slot pendukung.`,
    sameElement === 2 ? `Tiga Trekker berelemen ${main.element} memudahkan pencocokan syarat elemen.`
      : `${sameElement + 1} dari 3 Trekker berelemen ${main.element}; anggota lain dipilih berdasarkan peran dan tag.`,
  ];
  if (matchingTags.length) reasons.push(`Tag dukungan ${tagNames(matchingTags)} cocok dengan fokus serangan main.`);
  else reasons.push('Sinergi dinilai dari dukungan umum; belum ada tag dukungan yang langsung cocok dengan serangan main.');
  const goalTags = intersect(supportTags, GOALS[goal].tags);
  reasons.push(goalTags.length ? `Untuk ${GOALS[goal].label}, tim menawarkan ${tagNames(goalTags)}.`
    : `Kebutuhan ${GOALS[goal].label} belum tercakup kuat oleh tag dukungan tim.`);
  if (selection.main.length) reasons.push(`${selection.main[0].disc.name} menjadi kandidat disc utama berdasarkan elemen dan tag, tanpa bonus skor kelangkaan.`);

  const warnings = [];
  if ([main, ...supports].some(t => t.analysisStatus === 'inferred')) warnings.push('Sebagian kit baru atau berubah memakai analisis awal otomatis. Prioritas build-nya belum diuji ulang oleh komunitas.');
  if (sameElement < 2) warnings.push('Tim memakai beberapa elemen. Periksa syarat elemen pada skill, potential, dan disc sebelum memakai build.');
  if (supports.some((trekker) => trekker.element !== main.element && tagsOf(trekker, 'supportTags').includes('mark')) && damageTags.includes('mark')) {
    warnings.push(`Mark dari elemen lain tidak dihitung sebagai pemasok ${main.element} Mark untuk main.`);
  }
  if (main.role === 'Support') warnings.push('Main berperan Support. Periksa apakah pola serangannya sesuai untuk menjadi karakter aktif.');
  if (supportTags.some((tag) => ['heal', 'shield', 'gather'].includes(tag))) {
    warnings.push('Ketersediaan heal, shield, atau tarikan mengikuti potential dan pemicu tiap Trekker; cek potential serta tip build sebelum mengandalkannya.');
  }
  if (!supportTags.includes('heal') && !supportTags.includes('shield')) warnings.push('Tim tidak memiliki tag heal atau shield; daya tahan perlu ditopang permainan dan pilihan potential.');
  if (goal === 'farm' && !supportTags.includes('gather')) warnings.push('Tidak ada tag pengumpulan musuh; efisiensi farming bergantung pada pola serangan dan posisi.');
  if (!discs.length) warnings.push('Belum ada disc yang tersedia. Rekomendasi tim tetap ditampilkan, tetapi bagian skor disc bernilai 0.');
  else if (discs.length < 6) warnings.push(`Tersedia ${discs.length} disc unik; ${6 - discs.length} dari 6 slot disc belum terisi.`);
  if (selection.support.length) warnings.push('Pilihan disc pendukung adalah kecocokan awal. Cek efek yang berlaku di slot pendukung; skor tidak mengasumsikan Melody/Harmony aktif.');

  return {
    id: `${main.id}--${supports.map((trekker) => trekker.id).sort().join('--')}`,
    main, supports, score: clamp(breakdown.reduce((sum, entry) => sum + entry.value, 0), 100),
    breakdown, reasons, warnings,
    discs: { main: selection.main, support: selection.support },
    alternatives: selection.alternatives,
  };
}

/**
 * Transparent compatibility heuristic, not simulated DPS or a character tier list.
 * Element filters the main only. Collection ownership applies to every result.
 * Optional catalog injection makes scoring testable without changing game data.
 * @param {object} options
 * @param {{trekkers: object[], discs: object[]}} [catalog]
 * @returns {object[]}
 */
export function recommendTeams(options = {}, catalog = { trekkers: TREKKERS, discs: DISCS }) {
  const mode = options.mode === 'explore' ? 'explore' : 'collection';
  const goal = Object.hasOwn(GOALS, options.goal) ? options.goal : 'balanced';
  const element = options.element || 'all';
  const lockedMain = options.lockedMain || '';
  const limit = options.limit === undefined ? 3 : Math.max(0, Math.floor(Number(options.limit) || 0));
  if (!limit) return [];
  const ownedTrekkers = new Set(Array.isArray(options.ownedTrekkers) ? options.ownedTrekkers : []);
  const ownedDiscs = new Set(Array.isArray(options.ownedDiscs) ? options.ownedDiscs : []);
  const trekkers = cleanCatalog(catalog.trekkers)
    .filter((trekker) => mode === 'explore' || ownedTrekkers.has(trekker.id));
  const discs = cleanCatalog(catalog.discs)
    .filter((disc) => mode === 'explore' || ownedDiscs.has(disc.id));
  if (trekkers.length < 3) return [];

  let candidates = trekkers.filter((trekker) => element === 'all' || trekker.element === element);
  if (lockedMain) candidates = candidates.filter((trekker) => trekker.id === lockedMain);
  else {
    const damageRoles = candidates.filter((trekker) => trekker.role === 'Vanguard' || trekker.role === 'Versatile');
    if (damageRoles.length) candidates = damageRoles;
  }

  const results = [];
  const discCache = new Map();
  for (const main of candidates) {
    const possibleSupports = trekkers.filter((trekker) => trekker.id !== main.id);
    for (let first = 0; first < possibleSupports.length - 1; first += 1) {
      for (let second = first + 1; second < possibleSupports.length; second += 1) {
        results.push(evaluateTeam(main, [possibleSupports[first], possibleSupports[second]], discs, goal, discCache));
      }
    }
  }
  return results.sort((a, b) => b.score - a.score || compareIds(a, b)).slice(0, limit);
}
