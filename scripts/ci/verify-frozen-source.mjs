import assert from 'node:assert/strict';
import {readFile,lstat,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {safeRelative,sha256} from '../lib/artifacts.mjs';

// Build inputs/outputs are deliberately absent from the source archive. Verify
// every committed source byte and reject new source files while admitting only
// these two top-level generated directories during a build continuation.
export async function verifyFrozenSource(root,{manifestSha256,sourceCommit,allowBuildOutputs=false}){
  assert(/^[a-f0-9]{64}$/.test(manifestSha256)&&/^[a-f0-9]{40}$/.test(sourceCommit),'Invalid source authority');
  const raw=await readFile(join(root,'MANIFEST.json'));
  assert.equal(createHash('sha256').update(raw).digest('hex'),manifestSha256,'Wrong frozen manifest');
  const manifest=JSON.parse(raw);
  assert.equal(manifest.schemaVersion,1);assert.equal(manifest.kind,'office-source-progress');
  assert.equal(manifest.sourceCommit,sourceCommit);assert(Array.isArray(manifest.files)&&manifest.files.length);
  const expected=new Set(['MANIFEST.json']);
  for(const file of manifest.files){
    const path=safeRelative(file.path),top=path.split('/')[0];
    assert(!['build','.toolchains'].includes(top),'Generated root appears in source authority');
    assert(!expected.has(path),'Duplicate source manifest entry');expected.add(path);
    assert(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&Number.isInteger(file.mode)&&file.mode>=0&&file.mode<=0o777&&/^[a-f0-9]{64}$/.test(file.sha256),'Invalid source metadata');
  }
  let count=0;
  async function walk(directory,prefix=''){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=prefix+entry.name,absolute=join(directory,entry.name),info=await lstat(absolute);
      assert(!info.isSymbolicLink(),'Source contains a symbolic link: '+path);
      if(!prefix&&allowBuildOutputs&&['build','.toolchains'].includes(entry.name)){
        assert(info.isDirectory(),'Generated root is not a directory: '+path);continue;
      }
      if(info.isDirectory())await walk(absolute,path+'/');
      else{assert(info.isFile()&&expected.has(path),'Unlisted source entry: '+path);count++;}
    }
  }
  await walk(root);assert.equal(count,expected.size,'Source inventory count differs');
  for(const file of manifest.files){
    const absolute=join(root,file.path),info=await lstat(absolute);
    assert(info.isFile()&&!info.isSymbolicLink()&&info.size===file.bytes,'Source entry differs: '+file.path);
    assert.equal(await sha256(absolute),file.sha256,'Source content differs: '+file.path);
    if(process.platform!=='win32')assert.equal(info.mode&0o777,file.mode,'Source mode differs: '+file.path);
  }
  return {sourceCommit,files:manifest.files.length,manifestSha256,allowedGeneratedRoots:allowBuildOutputs?['build','.toolchains']:[]};
}
