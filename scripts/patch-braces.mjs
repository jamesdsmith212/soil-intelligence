// Project-local fix for GHSA-vfj7-8cjw-p6xm, pending a reviewed upstream release.
// Do not change package versions or hide the upstream advisory from npm audit.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = source => createHash('sha256').update(source).digest('hex');
const error = "throw new RangeError('braces exceeds maximum nesting depth (100)');";
export const patches = [
  { file:'parse.js', hash:'e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310', edits:[
    ['  const push = node => {', `  const push = node => {\n    if ((node.type === 'brace' || node.type === 'paren') && stack.length > 100) {\n      ${error}\n    }`],
  ] },
  { file:'compile.js', hash:'dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f', edits:[
    ['  const walk = (node, parent = {}) => {', `  const walk = (node, parent = {}, depth = 0) => {\n    if (depth > 101) ${error}`],
    ['output += walk(child, node);', 'output += walk(child, node, depth + 1);'],
  ] },
  { file:'expand.js', hash:'41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7', edits:[
    ['  const walk = (node, parent = {}) => {', `  const walk = (node, parent = {}, depth = 0) => {\n    if (depth > 101) ${error}`],
    ['walk(child, node);', 'walk(child, node, depth + 1);'],
  ] },
  { file:'stringify.js', hash:'379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a', edits:[
    ['  const stringify = (node, parent = {}) => {', `  const stringify = (node, parent = {}, depth = 0) => {\n    if (depth > 101) ${error}`],
    ['output += stringify(child);', 'output += stringify(child, {}, depth + 1);'],
  ] },
];

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Unrecognised braces source; review the security patch before proceeding.');
  return source.replace(before, after);
}

export function patchedSource(source, patch) {
  if (hash(source) === patch.hash) return patch.edits.reduce((text,[before,after])=>replaceOnce(text,before,after),source);
  const original = patch.edits.reduce((text,[before,after])=>replaceOnce(text,after,before),source);
  if (hash(original) !== patch.hash) throw new Error('Braces source integrity mismatch; refusing to run unverified tooling.');
  return source; // Already patched, with the exact reviewed bytes.
}

async function installedCopies(nodeModules, scopedDirectory=false) {
  let entries;
  try { entries=await readdir(nodeModules,{withFileTypes:true}); }
  catch (reason) { if (reason.code==='ENOENT') return []; throw reason; }
  const copies=[];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue; // Never follow symlinks.
    const directory=join(nodeModules,entry.name);
    if (entry.name.startsWith('@')) {
      copies.push(...await installedCopies(directory,true));
      continue;
    }
    if (entry.name==='braces' && !scopedDirectory) copies.push(directory);
    copies.push(...await installedCopies(join(directory,'node_modules')));
  }
  return copies;
}

export async function patchInstalled({checkOnly=false}={}) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const copies=await installedCopies(join(root,'node_modules'));
  if (!copies.length) throw new Error('No installed braces copy found; install the locked npm dependencies first.');
  const writes=[];
  for (const directory of copies) {
    const metadata=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
    if (metadata.name!=='braces' || metadata.version!=='3.0.3') throw new Error('Braces version changed; review the advisory and update the verified patch.');
    for (const patch of patches) {
      const path=join(directory,'lib',patch.file);
      const source=await readFile(path,'utf8');
      const output=patchedSource(source,patch);
      if (checkOnly && output!==source) throw new Error('Braces security patch is missing; run npm install or npm run security:patch.');
      if (output!==source) writes.push({path,output});
    }
  }
  // Verify every copy and all source hashes before changing any dependency file.
  for (const {path,output} of writes) await writeFile(path,output);
  console.log(`Braces depth protection verified in ${copies.length} installed copy/copies (${writes.length} files patched).`);
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  await patchInstalled({checkOnly:process.argv.includes('--check')});
}
