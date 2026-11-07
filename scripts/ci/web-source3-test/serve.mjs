// Qualification fixture only; not a desktop app or part of the delivered runtime.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const root=resolve(value('--root')),port=Number(value('--port')),saved=resolve(value('--saved'));
if(!args.includes('--root')||!args.includes('--saved')||!Number.isInteger(port)||port<1024)throw Error('root/port/saved required');
const {createAssetHandler}=await import(pathToFileURL(join(root,'host/asset-handler.mjs')));
const handler=createAssetHandler({webRoot:join(root,'web'),browserPackageRoot:join(root,'sdk/browser')});
await mkdir(saved,{recursive:true});
const fixture=await readFile('test/fixtures/embedded-host.html');
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/__qualification/host'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(fixture);return;}
 if(url.pathname==='/__qualification/save'&&req.method==='POST'){
  if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`)throw Error('origin');
  const app=url.searchParams.get('app');if(!['wordcraft','pdfcraft','deckcraft','gridcraft'].includes(app))throw Error('app');
  const name=url.searchParams.get('name')||'document',ext=name.split('.').at(-1).toLowerCase();if(!/^[a-z0-9]{1,8}$/.test(ext))throw Error('extension');
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>64<<20)throw Error('size');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);if(!bytes.length)throw Error('empty');
  const id=randomUUID(),path=join(saved,`${app}-${id}.${ext}`),temp=path+'.tmp';await writeFile(temp,bytes,{flag:'wx'});await rename(temp,path);
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({app,id,name,bytes:size,sha256:createHash('sha256').update(bytes).digest('hex'),path}));return;
 }
 if(await handler(req,res))return;res.writeHead(404);res.end('Not found');
}catch(error){if(!res.headersSent){res.writeHead(400);res.end(error.message)}else res.destroy()}});
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok)});
console.log(`Qualification fixture http://127.0.0.1:${port}/__qualification/host`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
