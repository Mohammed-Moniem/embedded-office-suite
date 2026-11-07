import {appendFileSync,writeFileSync,renameSync,createWriteStream,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';

// Only supervises this build's own child processes. A CHECK timeout alone cannot
// persist which frozen helper or compiler was active when a job stopped.
export function createSupervisor(directory,{heartbeatMs=15000}={}){
  mkdirSync(directory,{recursive:true});
  const history=[];
  function record(stage,status,details={}){
    const row={at:new Date().toISOString(),stage,status,...details};history.push(row);
    appendFileSync(join(directory,'events.jsonl'),JSON.stringify(row)+'\n');
    const target=join(directory,'STATUS.json');writeFileSync(target+'.tmp',JSON.stringify({schemaVersion:1,history},null,2)+'\n');renameSync(target+'.tmp',target);
    console.log(JSON.stringify(row));
  }
  async function stage(name,work){
    if(!/^[a-z0-9-]+$/.test(name))throw Error('Invalid build stage name');
    record(name,'started');const started=Date.now();
    const pulse=setInterval(()=>record(name,'heartbeat',{elapsedMs:Date.now()-started}),heartbeatMs);
    try{const result=await work();record(name,'succeeded',{elapsedMs:Date.now()-started});return result;}
    catch(error){record(name,'failed',{elapsedMs:Date.now()-started,error:error.message});throw error;}
    finally{clearInterval(pulse);}
  }
  async function command(name,executable,args,{cwd,env=process.env,timeoutMs=600000}={}){
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw Error('Invalid child deadline');
    return stage(name,async()=>{
      const log=join(directory,name+'.log'),stream=createWriteStream(log,{flags:'wx'});
      const child=spawn(executable,args,{cwd,env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
      let failure,terminating=false;
      const terminate=error=>{
        if(terminating)return;terminating=true;failure=error;
        record(name,'termination-requested',{pid:child.pid??null,error:error.message});
        if(process.platform==='win32'&&child.pid){
          const killer=spawn(join(process.env.SystemRoot??'C:\\Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});
          killer.once('error',()=>child.kill('SIGKILL'));killer.once('close',code=>{if(code!==0)child.kill('SIGKILL');});
        }else if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')child.kill('SIGKILL');}}
      };
      stream.on('error',terminate);
      for(const pipe of [child.stdout,child.stderr])pipe.on('data',bytes=>{stream.write(bytes);process.stdout.write(bytes);});
      record(name,'child-started',{pid:child.pid??null,executable,args,cwd,timeoutMs,log});
      const timer=setTimeout(()=>terminate(Error(`Child exceeded ${timeoutMs} ms`)),timeoutMs);
      let result;
      try{result=await new Promise(resolve=>{
        child.once('error',error=>{failure=error;});child.once('close',(code,signal)=>resolve({code,signal}));
      });}finally{
        clearTimeout(timer);
        if(!stream.destroyed)await new Promise(resolve=>{stream.once('error',resolve);stream.end(resolve);});
      }
      record(name,'child-exited',{...result,error:failure?.message??null});
      if(failure)throw failure;
      if(result.code!==0)throw Error(`${name} exited ${result.code}; inspect ${log}`);
      return {log,...result};
    });
  }
  return {stage,command,record};
}
