// Run without the job token before any restoration. This is also useful alone.
import './prelude.mjs';
const {observeSystem}=await import('./bridge.mjs');
console.log(JSON.stringify({scope:'EXPLICIT_COMPRESSION_PROFILE_PREFLIGHT_ONLY',...observeSystem(),fullNativeByteEquivalenceEstablished:false}));
