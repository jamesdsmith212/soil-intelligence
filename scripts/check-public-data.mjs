import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../',import.meta.url).pathname;
const skipped = new Set(['.git','node_modules','dist','.next','.vinext','.wrangler','coverage']);
const errors = [];
async function walk(directory) {
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    if (skipped.has(entry.name) || entry.name.endsWith('.tsbuildinfo') || entry.name==='next-env.d.ts') continue;
    const path = join(directory,entry.name);
    const label = relative(root,path);
    if (entry.isDirectory()) { await walk(path); continue; }
    if (/\.(xlsx?|pdf|sqlite3?|db|pem|key)$/i.test(entry.name) || /^\.env|^\.dev\.vars|^hosting\.json/.test(entry.name)) { errors.push(`Forbidden private/runtime file: ${label}`); continue; }
    const content = await readFile(path,'utf8');
    if (/\/Users\/|\/home\/[a-z][\w-]+|appgprj_[a-z0-9]+|git\.chatgpt-team\.site|[a-z0-9-]+\.[a-z0-9-]+\.chatgpt\.site|(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) errors.push(`Local path, private hosting identity or secret signature: ${label}`);
  }
}
await walk(root);
for (const filename of ['soil-data.json','nutrient-data.json']) {
  const data = JSON.parse(await readFile(join(root,'data',filename),'utf8'));
  if (data.synthetic!==true) errors.push(`${filename} is not explicitly synthetic`);
  for (const field of data.fields) {
    if (!/^demo-field-/.test(field.id ?? field.fieldId) || !/^Demo /.test(field.name ?? field.fieldName)) errors.push(`Non-demo field in ${filename}`);
  }
  for (const grid of data.grids??[]) {
    if (!/^demo-grid-/.test(grid.id) || grid.sampleId && !/^demo-sample-/.test(grid.sampleId)) errors.push(`Non-demo sampling reference in ${filename}`);
    if (grid.centroid.some(value=>value<0 || value>0.01)) errors.push(`Non-schematic grid coordinates in ${filename}`);
  }
  for (const product of data.products??[]) if (!/^demo-/.test(product.id) || !product.priceBasis.startsWith('INVENTED')) errors.push(`Non-demo product or price in ${filename}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode=1; }
else console.log('Public-data check passed: only explicit synthetic datasets; no private runtime files, hosting identities, local paths or detected secrets.');
