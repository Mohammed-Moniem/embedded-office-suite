// Root must adopt this adjacent to the unchanged reviewed driver. The only
// effect is an explicit inherited --import for its native ZIP subprocesses.
import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
assert(process.argv.length===2 || (process.argv.length===3 && process.argv[2]==='--publish'),'Only the original optional --publish argument is admitted');
assert(!process.env.NODE_OPTIONS,'Ambient NODE_OPTIONS is not admitted');
const driver=new URL('./driver.mjs',import.meta.url), prelude=new URL('./prelude.mjs',import.meta.url);
for(const [url,sha] of [[driver,'54e88d72ef080f39e0b033bac467fb15c5616700ed443cd6a01ea7f203e24b6b'],[prelude,'b92958d86e455adefb3a7e5e840942a45b6331265dbbb58140b59621657f6112']]){
  const info=await lstat(url); assert(info.isFile()&&!info.isSymbolicLink(),'Regular launcher dependency required');
  assert.equal(createHash('sha256').update(await readFile(url)).digest('hex'),sha,'Launcher dependency mismatch');
}
const child=spawn(process.execPath,[fileURLToPath(driver),...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,NODE_OPTIONS:'--import='+prelude.href}});
child.once('error',()=>{process.stderr.write('EXPLICIT_COMPRESSOR_LAUNCH_FAILED_CLOSED\n');process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=signal?1:code;});
