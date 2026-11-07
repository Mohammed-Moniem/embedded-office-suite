import {mkdir,cp} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import assert from 'node:assert/strict';
import {filesIn,sha256} from './artifacts.mjs';

const noticeName=/^(?:OFL(?:[-.]|$)|LICEN[CS]E(?:[-._]|$)|NOTICE(?:[-._]|$)|ATTRIBUTION(?:[-._]|$)|COPYING(?:[-._]|$)|COPYRIGHT(?:[-._]|$))/i;
/** Retain notices beside built-in fonts/icons as well as top-level/legal folders. */
export async function engineAssetNotices(source){
  let files;try{files=await filesIn(join(source,'assets'));}catch(error){if(error.code==='ENOENT')return[];throw error;}
  const result=[];for(const file of files.filter(file=>noticeName.test(basename(file.path))))result.push({path:'assets/'+file.path,absolute:file.absolute,bytes:file.size,mode:file.mode,sha256:await sha256(file.absolute)});
  return result;
}
export async function copyEngineAssetNotices(source,destination){
  const notices=await engineAssetNotices(source);
  for(const file of notices){const output=join(destination,file.path);await mkdir(dirname(output),{recursive:true});await cp(file.absolute,output);assert.equal(await sha256(output),file.sha256,'Copied engine asset notice changed');}
  return notices.map(({absolute,...file})=>file);
}
