import { resolve, dirname } from 'node:path';
import { createOfficeIntegration, createFilesystemHost, APPS } from '../index.mjs';

const [app, command, output, input] = process.argv.slice(2);
if (!APPS.includes(app) || !command || !output) {
  console.error('Usage: node native-smoke.mjs APP /absolute/APP-cli /absolute/output.ext [/absolute/input.ext]');
  process.exitCode = 2;
} else {
  const destination = resolve(output);
  const source = input ? resolve(input) : undefined;
  const host = createFilesystemHost({readRoots: source ? [dirname(source)] : [], writeRoots: [dirname(destination)]});
  const office = createOfficeIntegration({host, binaries: {[app]: {command:resolve(command),...(app==='gridcraft'?{filesystemPolicy:'automation-roots'}:{})}}});
  try {
    const document = await office.open({app, ...(source ? {path: source} : {})});
    const saved = await office.save({sessionId: document.sessionId, path: destination, expectedRevision: document.revision});
    console.log(JSON.stringify({app: saved.app, revision: saved.revision, dirty: saved.dirty, savedRevision: saved.savedRevision}));
    await office.close({sessionId: saved.sessionId});
  } finally { await office.dispose(); }
}
