import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const files = ['server.js'];
for (const folder of ['src', 'lib', 'scripts', 'tests']) {
  for (const entry of await readdir(folder)) if (/\.m?js$/.test(entry)) files.push(`${folder}/${entry}`);
}
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe', windowsHide: true });
console.log(`Syntax valid: ${files.length} JavaScript files.`);
