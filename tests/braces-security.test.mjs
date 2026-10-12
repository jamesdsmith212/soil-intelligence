import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { patches, patchedSource } from '../scripts/patch-braces.mjs';

const require = createRequire(import.meta.url);
const braces = require('braces');
const depthError = error => error instanceof RangeError && /maximum nesting depth \(100\)/.test(error.message);
const nested = (depth, open='{', close='}') => open.repeat(depth)+'a'+close.repeat(depth);

test('braces rejects excessive nesting before any recursive walker runs',()=>{
  for (const method of ['parse','compile','expand','stringify']) {
    assert.throws(()=>braces[method](nested(101)),depthError,method);
    assert.throws(()=>braces[method](nested(4500)),depthError,method);
  }
  assert.throws(()=>braces(nested(4500)),depthError);
  assert.throws(()=>braces([nested(4500)],{expand:true}),depthError);
});

test('parentheses, mixed nesting and unterminated patterns cannot bypass the limit',()=>{
  for (const pattern of [nested(101,'(',')'),'{('.repeat(51)+'a'+')}'.repeat(51),'{'.repeat(101)+'a']) {
    assert.throws(()=>braces.parse(pattern),depthError);
  }
});

test('direct AST inputs cannot bypass recursive-walker depth limits',()=>{
  for (const method of ['compile','expand','stringify']) {
    let ast={type:'root',nodes:[]};
    let current=ast;
    for (let depth=0;depth<200;depth++) {
      const child={type:'brace',nodes:[],open:true,close:true,commas:1,ranges:0,parent:current};
      current.nodes.push(child); current=child;
    }
    current.nodes.push({type:'text',value:'a'});
    assert.throws(()=>braces[method](ast),depthError,method);
  }
});

test('ordinary globs, ranges, escaping and supported nesting retain their behaviour',()=>{
  assert.equal(braces.compile('app/{core,texture}/*.ts'),'app/(core|texture)/*.ts');
  assert.deepEqual(braces.expand('x/{a,b}/{1..3}'),['x/a/1','x/a/2','x/a/3','x/b/1','x/b/2','x/b/3']);
  assert.deepEqual(braces.expand('{a,{b,c}}'),['a','b','c']);
  assert.deepEqual(braces.expand(nested(100)),[nested(100)]);
  assert.doesNotThrow(()=>braces.parse('\\{'.repeat(200)+'x'+'\\}'.repeat(200)));
  assert.doesNotThrow(()=>braces.parse('"'+'{'.repeat(200)+'"'));
  assert.doesNotThrow(()=>braces.parse('['+'{'.repeat(200)+']'));
  const micromatch=require('micromatch');
  assert.deepEqual(micromatch(['app/a.ts','app/b.tsx','README.md'],'app/*.{ts,tsx}'),['app/a.ts','app/b.tsx']);
});

test('the installer patch is idempotent and refuses unknown source bytes',()=>{
  for (const patch of patches) {
    const source=readFileSync(require.resolve('braces/lib/'+patch.file),'utf8');
    assert.equal(patchedSource(source,patch),source);
    const original=patch.edits.reduce((text,[before,after])=>text.replace(after,before),source);
    assert.equal(patchedSource(original,patch),source);
    assert.throws(()=>patchedSource(source+'\n// unexpected change\n',patch),/integrity mismatch/);
    assert.throws(()=>patchedSource('unknown source',patch),/Unrecognised braces source/);
  }
});
