// Fixed public reconstruction only. Node built-ins + system tar; no package install.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream,constants} from 'node:fs';
import {readFile,writeFile,lstat,realpath,mkdir,copyFile,chmod,link,unlink,rename,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parseArgs} from 'node:util';
import {sha256,filesIn,safeRelative} from './lib/artifacts.mjs';

export const CONFIG_SHA256='772b18ab21c2fe219d4b74b9412560dd8f9098c910e54e78390b8370cfd6096e';
const scriptRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function info(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function validRow(row){safeRelative(row.path);assert(Number.isSafeInteger(row.bytes)&&row.bytes>=0);assert(/^[a-f0-9]{64}$/.test(row.sha256));if(row.mode!==undefined)assert(Number.isInteger(row.mode)&&row.mode>=0&&row.mode<=0o777);}
export async function loadConfig(path=join(scriptRoot,'config/web-source3-restore-progress3.json')){
 assert.equal(await realpath(path),resolve(path),'Canonical regular configuration required');assert((await lstat(path)).isFile());
 const bytes=await readFile(path);assert.equal(digest(bytes),CONFIG_SHA256,'Fixed restoration authority changed');
 const config=JSON.parse(bytes);assert.equal(config.schemaVersion,1);assert.equal(config.kind,'fixed-source3-wasm-restoration');
 assert.equal(digest(Buffer.from(config.originalMap.utf8)),config.originalMap.sha256);assert.equal(config.originalMap.sha256,'94539fe2cf70fa7e0f363cba6965179b43a24d1f363c7f4f59778810bda1f245');
 const original=JSON.parse(config.originalMap.utf8);assert.equal(config.direct.length,22);assert.equal(config.containers.length,10);assert.equal(config.containers.reduce((n,row)=>n+row.files.length,0),5398);
 for(let index=0;index<original.files.length;index++){const {url,source,...row}=config.direct[index];assert.deepEqual(row,original.files[index]);validRow(row);}
 for(let index=0;index<original.containers.length;index++){const {url,...row}=config.containers[index];assert.deepEqual(row,original.containers[index]);safeRelative(row.path);const paths=new Set();for(const file of row.files){validRow(file);assert(!paths.has(file.path),'Duplicate container member');paths.add(file.path);}}
 for(const row of config.assets){const url=new URL(row.url);assert.equal(url.protocol,'https:');assert(['github.com','raw.githubusercontent.com'].includes(url.hostname));assert.equal(url.username,'');assert.equal(url.password,'');assert(Number.isSafeInteger(row.bytes)&&row.bytes>0);assert(/^[a-f0-9]{64}$/.test(row.sha256));safeRelative(row.name);assert(!row.name.includes('/'));}
 assert.equal(config.publicWasm.sha256,'99c25048df8b3562b5cfbac86fc463ad9b0682d9fd2b5d8da5c06a1acbe0c5af');assert.equal(config.publicWasm.manifestSha256,'558993c7cdd2b8a242d0e45894462b905a508c83acbe41d06e6d5c765581687b');
 return config;
}
async function canonicalPath(path,{absent=false}={}){
 const absolute=resolve(path);let current=absolute;
 while(true){const entry=await info(current);if(entry){assert(!entry.isSymbolicLink(),'Symlink path rejected');assert(current===absolute?entry.isDirectory():entry.isDirectory(),'Non-directory path rejected');if(current===absolute&&absent)throw Error('Refusing existing destination');}
  if(dirname(current)===current)break;current=dirname(current);}
 // Every existing ancestor was checked; do not resolve through aliases.
 return absolute;
}
function rejectProtected(path){for(const name of ['scripts','config','docs','packages','engines','patches','.git','.toolchains','build/web-progress3','build/windows-ci-transfer','build/engines','build/public-qualification'])assert(!inside(join(scriptRoot,name),path)&&!inside(path,join(scriptRoot,name)),'Protected source/input path rejected');}
export async function preflight(destination,cache){
 assert(destination&&cache,'Provide --destination and --cache');
 const target=await canonicalPath(destination,{absent:true}),cached=await canonicalPath(cache);
 rejectProtected(target);rejectProtected(cached);assert(!inside(target,cached)&&!inside(cached,target),'Cache/destination overlap rejected');
 return {target,cache:cached};
}
async function verifyAsset(path,row){const entry=await lstat(path);assert(entry.isFile()&&!entry.isSymbolicLink(),'Regular cached asset required');assert.equal(entry.size,row.bytes,'Cached asset size mismatch');assert.equal(await sha256(path),row.sha256,'Cached asset hash mismatch');}
async function acquire(row,cache,offline,signal){
 const path=join(cache,row.sha256);if(await info(path)){await verifyAsset(path,row);return {path,url:row.url,sha256:row.sha256,bytes:row.bytes,source:'verified-cache'};}
 assert(!offline,'Offline asset missing: '+row.name);
 const temporary=path+'.partial-'+randomUUID();
 try{
  const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(300000)]);
  const response=await fetch(row.url,{signal:requestSignal,redirect:'follow'});assert.equal(response.status,200,'Public download failed: '+row.url);
  const finalUrl=new URL(response.url);assert.equal(finalUrl.protocol,'https:');assert(['github.com','raw.githubusercontent.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'].includes(finalUrl.hostname),'Unexpected public redirect host');
  const hash=createHash('sha256');let bytes=0;
  const check=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>row.bytes)return done(Error('Public asset exceeds fixed size'));hash.update(chunk);done(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),check,createWriteStream(temporary,{flags:'wx',mode:0o600}),{signal:requestSignal});
  assert.equal(bytes,row.bytes,'Public asset size mismatch');assert.equal(hash.digest('hex'),row.sha256,'Public asset hash mismatch');await chmod(temporary,0o644);
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;await verifyAsset(path,row);}
  return {path,url:row.url,finalUrl:finalUrl.origin+finalUrl.pathname,sha256:row.sha256,bytes,source:'anonymous-public-download',authorizationSent:false};
 }finally{await rm(temporary,{force:true});}
}
async function command(args){
 const child=spawn('tar',args,{shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,COPYFILE_DISABLE:'1'}});let out='',err='',timedOut=false;
 child.stdout.on('data',chunk=>{out+=chunk;if(out.length>8<<20)child.kill('SIGKILL');});child.stderr.on('data',chunk=>{err+=chunk;if(err.length>1<<20)child.kill('SIGKILL');});
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},180000);
 const code=await new Promise((ok,fail)=>{child.once('error',fail);child.once('close',ok)}).finally(()=>clearTimeout(timer));
 assert(!timedOut,'System tar timed out');assert.equal(code,0,'System tar failed: '+err.slice(0,1000));return out;
}
export function archiveNames(text){
 const paths=[];for(let name of text.split(/\r?\n/)){if(!name)continue;while(name.startsWith('./'))name=name.slice(2);name=name.replace(/\/$/,'');if(!name||name==='.')continue;safeRelative(name);assert(!/[\r\n\t]/.test(name),'Ambiguous archive member');paths.push(name);}return paths;
}
async function verifyInventory(directory,expected){
 const actual=await filesIn(directory);assert.equal(actual.length,expected.length,'Extracted inventory count mismatch');const paths=new Map(expected.map(row=>[row.path,row]));
 for(const file of actual){const row=paths.get(file.path);assert(row,'Unexpected extracted member: '+file.path);assert.equal(file.size,row.bytes,'Extracted size mismatch: '+file.path);assert.equal(await sha256(file.absolute),row.sha256,'Extracted hash mismatch: '+file.path);if(process.platform!=='win32')assert.equal(file.mode,row.mode??0o644,'Extracted mode mismatch: '+file.path);}
}
async function extract(path,destination,expected){
 assert(!await info(destination),'Extraction destination must be absent');
 const listing=await command(['-tf',path]),names=archiveNames(listing);
 const allowed=new Set();for(const row of expected){allowed.add(row.path);let parent=dirname(row.path).split(sep).join('/');while(parent!=='.'){allowed.add(parent);parent=dirname(parent).split(sep).join('/');}}
 // File manifests omit empty directories. The fixed support TAR contains such
 // cache directories; allow only safe directory entries, never unlisted files.
 const directoryNames=new Set(listing.split(/\r?\n/).filter(name=>name.endsWith('/')).flatMap(name=>archiveNames(name)));
 for(const name of names)assert(allowed.has(name)||directoryNames.has(name),'Unlisted archive member: '+name);
 const verbose=await command(['-tvf',path]);for(const line of verbose.split(/\r?\n/).filter(Boolean))assert(line.startsWith('-')||line.startsWith('d'),'Archive links/special files rejected');
 await mkdir(destination,{recursive:true});await command(['-xf',path,'-C',destination]);
 await verifyInventory(destination,expected);
}
async function copyExact(source,target,row,{replace=false}={}){
 const entry=await lstat(source);assert(entry.isFile()&&!entry.isSymbolicLink());assert.equal(entry.size,row.bytes);assert.equal(await sha256(source),row.sha256);
 await mkdir(dirname(target),{recursive:true});await copyFile(source,target,replace?0:constants.COPYFILE_EXCL);await chmod(target,row.mode??0o644);assert.equal(await sha256(target),row.sha256);
}
export async function restore({destination,cache,offline=false,mode='data',configPath}={}){
 assert(['data','wasm'].includes(mode),'Mode must be data or wasm');
 const config=await loadConfig(configPath),paths=await preflight(destination,cache);
 if(mode==='wasm')assert(!await info(paths.target+'.restoration.json'),'Refusing existing restoration sidecar');
 const assets=mode==='wasm'?[config.publicWasm]:config.assets;
 // Reject damaged existing cache entries and incomplete offline caches before writes.
 for(const row of assets){const path=join(paths.cache,row.sha256);if(await info(path))await verifyAsset(path,row);else assert(!offline,'Offline asset missing: '+row.name);}
 await mkdir(paths.cache,{recursive:true});const receipts=[];const downloaded=new Map();let next=0;const acquisition=new AbortController();
 const acquired=await Promise.allSettled(Array.from({length:Math.min(3,assets.length)},async()=>{while(next<assets.length&&!acquisition.signal.aborted){const row=assets[next++];try{const receipt=await acquire(row,paths.cache,offline,acquisition.signal);downloaded.set(row.url,receipt.path);receipts.push(receipt);console.log(row.name+': '+receipt.source);}catch(error){acquisition.abort(error);throw error;}}}));
 const failures=acquired.filter(row=>row.status==='rejected');if(failures.length)throw new AggregateError(failures.map(row=>row.reason),'Public asset acquisition failed');
 await mkdir(dirname(paths.target),{recursive:true});const stage=join(dirname(paths.target),'.office-web-restore-'+randomUUID());await mkdir(stage,{mode:0o700});const working=join(stage,'working');
 let committed=false;
 try{
  if(mode==='wasm')await extract(downloaded.get(config.publicWasm.url),working,config.publicWasm.files);
  else{
   await mkdir(working);
   for(const container of config.containers.filter(row=>row.restore.kind!=='copy-verified-subtree'))await extract(downloaded.get(container.url),join(working,container.path),container.files);
   const baseline=config.containers.find(row=>row.path===config.production.baselineContainer);assert(baseline);
   // Archived source beneath build/ remains DATA. The separate working copy is
   // the admitted source3 baseline plus fixed current public production overlays.
   for(const row of baseline.files.filter(row=>row.path!=='MANIFEST.json'))await copyExact(join(working,baseline.path,row.path),join(working,row.path),row);
   for(const row of config.production.overlays)await copyExact(downloaded.get(row.url),join(working,row.path),row,{replace:true});
   for(const row of config.direct){if(row.source==='baseline-public-source'){assert.equal(await sha256(join(working,row.path)),row.sha256);continue;}await copyExact(downloaded.get(row.url),join(working,row.path),row);}
   for(const container of config.containers.filter(row=>row.restore.kind==='copy-verified-subtree')){
    for(const row of container.files)await copyExact(join(working,container.restore.from,row.path),join(working,container.path,row.path),row);
   }
   for(const container of config.containers)await verifyInventory(join(working,container.path),container.files);
   for(const row of config.direct)assert.equal(await sha256(join(working,row.path)),row.sha256);
   for(const directory of JSON.parse(config.originalMap.utf8).requiredDirectories)await mkdir(join(working,directory),{recursive:true});
  }
  const receipt={schemaVersion:1,kind:'fixed-source3-public-restoration',mode,passed:true,authoritySha256:CONFIG_SHA256,originalMapSha256:config.originalMap.sha256,publicProductionCommit:config.production.publicCommit,downloadedAssets:receipts.sort((a,b)=>a.url.localeCompare(b.url)),directInputs:mode==='data'?config.direct.length:0,containerFileEntries:mode==='data'?5398:config.publicWasm.files.length,expected:config.expected,modeValidation:process.platform==='win32'?'Windows POSIX mode bits unavailable; contents validated':'Exact POSIX modes validated',historicalSourceExecuted:false,limits:config.limits};
  // Keep delivered WASM extraction byte-exact; its receipt lives beside it.
  if(mode==='data')await writeFile(join(working,'RESTORE-RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  assert(!await info(paths.target),'Destination appeared during restoration; refusing replacement');await rename(working,paths.target);committed=true;
  const receiptPath=mode==='data'?join(paths.target,'RESTORE-RECEIPT.json'):paths.target+'.restoration.json';
  if(mode==='wasm')await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log('Source3 '+mode+' restoration passed: '+paths.target);return {...receipt,destination:paths.target,receiptPath};
 }finally{await rm(stage,{recursive:true,force:true});if(!committed)console.error('Destination was not committed');}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const {values}=parseArgs({options:{destination:{type:'string'},cache:{type:'string'},offline:{type:'boolean'},mode:{type:'string'},config:{type:'string'},help:{type:'boolean'}}});
 if(values.help)console.log('Node 22+ and system tar required.\nnode scripts/restore-web-source3.mjs --destination NEW_PATH --cache CACHE_PATH [--offline] [--mode data|wasm]\nDefault data mode restores the fixed public baseline + pinned production overlays and exact package inputs. wasm mode downloads/extracts the exact current public WASM package. Destinations must be new canonical paths; never use a source/input directory.');
 else await restore({destination:values.destination,cache:values.cache,offline:values.offline,mode:values.mode??'data',configPath:values.config});
}
