import {createHash} from 'node:crypto';
export const EXPECTED_ENVIRONMENT = Object.freeze({node: '24.18.0', platform: 'darwin', arch: 'arm64', systemZlib: '1.2.12'});
export function fixtures() {
  const pattern = Buffer.from('source3-office-raw-deflate-window-boundary-control\n');
  const mixed = Buffer.alloc(131173); let state = 0x13579bdf;
  for (let i = 0; i < mixed.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0; mixed[i] = i % 1024 < 128 ? state & 255 : pattern[i % pattern.length]; }
  const rows = Array.from({length: 1024}, (_, i) => ({path: 'runtime/assets/item-' + i + '.json', bytes: i * 197, mode: 420, sha256: createHash('sha256').update('source3-profile-' + i).digest('hex')}));
  let seed=123456789; const hosted=Buffer.alloc(1048576);
  for(let i=0;i<hosted.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;hosted[i]=i%7?((i>>>5)%251):seed>>>24;}
  return [{name: 'mixed-64k-boundaries', bytes: mixed}, {name: 'manifest-shaped-json', bytes: Buffer.from(JSON.stringify({schemaVersion: 1, files: rows}, null, 2) + '\n')}, {name:'actual-hosted-differential-1mib',bytes:hosted}];
}
export const EXPECTED_PROBES = Object.freeze([
  {
    "name": "mixed-64k-boundaries",
    "inputBytes": 131173,
    "inputSha256": "bbedb81ab6313835b204a475ddbc485b9823f18f5f69088bd449342eaf021dc6",
    "compressedBytes": 17556,
    "compressedSha256": "498b282e44cfa8fe80db2dda8f604252bb03ee817334328ad6f70715dea72eed"
  },
  {
    "name": "manifest-shaped-json",
    "inputBytes": 187805,
    "inputSha256": "92589437682ab33f5fd636763bee47400c2e6af1c4ae26ebfb8e09b774dbd2a2",
    "compressedBytes": 49459,
    "compressedSha256": "97deebb71eb4933033e7db84d6d2b5fb258fc805296f598938c9cd72dde150da"
  },
  {
    "name": "actual-hosted-differential-1mib",
    "inputBytes": 1048576,
    "inputSha256": "e0376a788b90b6fc78d3cdc950d38cdc2fb8343cb54f8177551c20becf3d0ba7",
    "compressedBytes": 351702,
    "compressedSha256": "355c94ae5f981451cb67c9e160044293fac090ffab70aa2da76c102bb00083a3"
  }
]);
