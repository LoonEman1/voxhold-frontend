// Exercise the production nginx template, not Vite's development proxy.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const prefix = `voxhold-upload-${process.pid}`
const network = `${prefix}-net`, proxy = `${prefix}-proxy`, upstream = `${prefix}-upstream`
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 180_000 })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout)
  return result.stdout.trim()
}
const receiver = `require('node:http').createServer((req,res)=>{let size=0;req.on('data',chunk=>size+=chunk.length);req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({size}))})}).listen(8080,'0.0.0.0')`
const client = `
const assert = require('node:assert/strict');
(async()=>{
 let ready=false;
 for(let n=0;n<80;n++){try{const r=await fetch('http://${proxy}:8080/healthz');if(r.ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,250))}
 assert(ready,'production proxy did not become ready');
 for(const mib of [6,64]){
  const size=mib*1024*1024;
  const response=await fetch('http://${proxy}:8080/api/v1/channels/1/attachments/fixture',{method:'PUT',body:Buffer.alloc(size,97)});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).size,size,'proxy truncated the attachment');
 }
 const oversized=await fetch('http://${proxy}:8080/api/v1/channels/1/attachments/fixture',{method:'PUT',body:Buffer.alloc(65*1024*1024,97)});
 assert.equal(oversized.status,413,'proxy accepted an upload above 64 MiB');
 console.log('Production upload proxy: 6/64 MiB accepted, 65 MiB rejected');
})().catch(error=>{console.error(error);process.exitCode=1});`
try {
  docker(['network', 'create', network])
  docker(['run', '-d', '--name', upstream, '--network', network, 'node:24-bookworm', 'node', '-e', receiver])
  docker(['run', '-d', '--name', proxy, '--network', network,
    '-e', `BACKEND_UPSTREAM=${upstream}:8080`,
    '-v', `${resolve('docker/nginx.conf.template')}:/etc/nginx/templates/default.conf.template:ro`,
    '-v', `${resolve('docker/security_headers.conf')}:/etc/nginx/security_headers.conf:ro`,
    'nginxinc/nginx-unprivileged:1.29-alpine'])
  console.log(docker(['run', '--rm', '--network', network, 'node:24-bookworm', 'node', '-e', client]))
} finally {
  for (const name of [proxy, upstream]) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 30_000 })
  spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore', timeout: 30_000 })
}
