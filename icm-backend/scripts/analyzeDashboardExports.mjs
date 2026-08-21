import fs from 'fs';
import { globSync } from 'glob';

const dashboardPath = 'src/services/identity/posture/identityPostureDashboard.js';
const src = fs.readFileSync(dashboardPath, 'utf8');
const allExports = [
  ...new Set([
    ...[...src.matchAll(/^export const (\w+)/gm)].map((m) => m[1]),
    ...[...src.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]),
  ]),
];

const files = globSync('src/**/*.js', { ignore: ['**/node_modules/**'] });
const externalRefs = new Set();

for (const file of files) {
  if (file.replace(/\\/g, '/').endsWith('identityPostureDashboard.js')) continue;
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes('identityPostureDashboard')) continue;

  const importBlocks = [
    ...content.matchAll(
      /import\s*\{([^}]+)\}\s*from\s*['"][^'"]*identityPostureDashboard[^'"]*['"]/gs,
    ),
  ];
  for (const block of importBlocks) {
    for (const name of allExports) {
      if (new RegExp(`\\b${name}\\b`).test(block[1])) externalRefs.add(name);
    }
  }
}

const unused = allExports.filter((n) => !externalRefs.has(n));
console.log(`Total exports: ${allExports.length}`);
console.log(`Externally imported: ${externalRefs.size}`);
console.log('Externally used:', [...externalRefs].sort().join(', '));
console.log('\nInternal-only (can un-export):');
unused.sort().forEach((n) => console.log(`  - ${n}`));
