import { syncData } from '../lib/sync.js';
const result = await syncData();
console.log(JSON.stringify({ revision: result.revision, status: result.status, checkedAt: result.checkedAt, changes: result.changes.length, sources: result.sources.map(s => ({ id: s.id, status: s.status })) }, null, 2));
if (result.status !== 'synced') process.exitCode = 1;
