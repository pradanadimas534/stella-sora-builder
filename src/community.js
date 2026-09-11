// Community evidence is a separate, bounded ranking signal. Views/likes are not evidence.
export function validClaims(claims, { revision, now = Date.now(), sourceStates = [], pendingBalanceReview = false } = {}) {
  if (pendingBalanceReview) return [];
  return (Array.isArray(claims) ? claims : []).filter(claim => {
    if (!claim || claim.status !== 'reviewed' || !claim.reviewedAt || !claim.sourceUrl || typeof claim.author !== 'string' || !claim.author.trim() || typeof claim.summary !== 'string' || !claim.summary) return false;
    try { if (new URL(claim.sourceUrl).protocol !== 'https:') return false; } catch { return false; }
    if (typeof claim.main !== 'string' || !Array.isArray(claim.supports) || claim.supports.some(id => typeof id !== 'string') || claim.supports.length !== 2 || new Set([claim.main, ...claim.supports]).size !== 3) return false;
    if ((claim.goals && !Array.isArray(claim.goals)) || (claim.damageTags && !Array.isArray(claim.damageTags))) return false;
    const published = Date.parse(claim.publishedAt);
    const reviewed = Date.parse(claim.reviewedAt);
    if (!Number.isFinite(published) || !Number.isFinite(reviewed) || published > now || reviewed > now) return false;
    // Recency is measured from publication, never refreshed just because a crawler ran.
    if (now - published > Math.min(180, claim.expiresAfterDays || 90) * 86400000) return false;
    if (claim.catalogRevision !== revision && !(claim.baseline === 'curated' && revision?.startsWith('curated-'))) return false;
    const source = sourceStates.find(s => s.id === claim.sourceId);
    if ((source?.contentChanged && claim.sourceFingerprint !== source.fingerprint) || (source && source.status !== 'ok' && source.status !== 'reference')) return false;
    return true;
  });
}

export function applyCommunityEvidence(teams, claims, options = {}) {
  const eligible = validClaims(claims, options);
  return teams.map(team => {
    const names = team.supports.map(t => t.id).sort().join('|');
    const tags = team.main.builds?.main?.damageTags || team.main.damageTags || [];
    const matches = eligible.filter(c => c.main === team.main.id && c.supports.slice().sort().join('|') === names
      && (!c.goals?.length || c.goals.includes(options.goal))
      && (!c.damageTags?.length || c.damageTags.every(t => tags.includes(t))));
    const seen = new Set();
    const evidence = matches.filter(c => {
      // The same author cross-posting on several platforms counts once.
      const author = c.author.trim().toLowerCase();
      if (seen.has(author)) return false; seen.add(author); return true;
    });
    const communityPoints = Math.min(8, evidence.length * 4);
    return { ...team, evidence, communityPoints, rankScore: team.score + communityPoints,
      evidenceLabel: evidence.length ? `${evidence.length} referensi terverifikasi` : 'Belum ada referensi komunitas tervalidasi untuk kombinasi ini' };
  }).sort((a, b) => b.rankScore - a.rankScore || a.id.localeCompare(b.id));
}
