import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { backupMedia } from './private-media-backup.mjs';

async function fixture() {
  const key = await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'}, true, ['encrypt','decrypt']);
  const der = await crypto.subtle.exportKey('spki', key.publicKey);
  const raw = new Uint8Array([255,0,128,230,191,12]);
  const records = new Map();
  const env = {BACKUP_ENVIRONMENT:'staging', BACKUP_RUN_ID:'test', BACKUP_TRIGGER_SECRET:'disposable-test-trigger', BACKUP_EXPIRES_AT:String(Date.now()+60000),
    RECOVERY_PUBLIC_KEY:'-----BEGIN PUBLIC KEY-----\n'+Buffer.from(der).toString('base64')+'\n-----END PUBLIC KEY-----',
    SOURCE:{list:async()=>({objects:[{key:'private/photo.jpg',etag:'v1'}],truncated:false}),get:async()=>({etag:'v1',size:raw.length,httpMetadata:{contentType:'image/jpeg'},customMetadata:{caption:'private'},arrayBuffer:async()=>raw.buffer})},
    BACKUP:{head:async path=>records.has(path),put:async(path,value)=>records.set(path,value)}};
  return {env,records,key,raw};
}

test('encrypted R2 backup preserves binary bytes and hides source metadata',async()=>{
  const {env,records,key,raw}=await fixture();const manifest=await backupMedia(env);
  assert.equal(manifest.object_count,1); assert.equal(manifest.total_bytes,raw.length);
  const record=JSON.parse(records.get(manifest.objects[0].backup_key));
  assert(!JSON.stringify([...records]).includes('private/photo.jpg'));
  const secret=await crypto.subtle.decrypt('RSA-OAEP',key.privateKey,Buffer.from(record.wrapped_key,'base64'));
  const aes=await crypto.subtle.importKey('raw',secret,'AES-GCM',false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(record.nonce,'base64'),additionalData:new TextEncoder().encode(record.format)},aes,Buffer.from(record.ciphertext,'base64'));
  const payload=JSON.parse(new TextDecoder().decode(plain));
  assert.deepEqual(new Uint8Array(Buffer.from(payload.body,'base64')),raw);
  assert.equal(payload.http_metadata.contentType,'image/jpeg');assert.equal(payload.custom_metadata.caption,'private');
});

test('trigger rejects anonymous, expired and repeated requests',async()=>{
  const {env}=await fixture();const url='https://maintenance.invalid/';
  assert.equal((await worker.fetch(new Request(url,{method:'POST'}),env)).status,403);
  const request=()=>new Request(url,{method:'POST',headers:{'X-Recovery-Trigger':env.BACKUP_TRIGGER_SECRET}});
  assert.equal((await worker.fetch(request(),{...env,BACKUP_EXPIRES_AT:'1'})).status,410);
  assert.equal((await worker.fetch(request(),{...env,BACKUP_EXPIRES_AT:undefined})).status,410);
  assert.equal((await worker.fetch(request(),env)).status,200);
  assert.equal((await worker.fetch(request(),env)).status,409);
});

test('backup rejects production bindings, source races and large objects',async()=>{
  const {env}=await fixture();
  await assert.rejects(backupMedia({...env,BACKUP_ENVIRONMENT:'production'}),/environment/);
  await assert.rejects(backupMedia({...env,SOURCE:{...env.SOURCE,get:async()=>({etag:'changed'})}}),/Source changed/);
  await assert.rejects(backupMedia({...env,SOURCE:{...env.SOURCE,get:async()=>({etag:'v1',size:11*1024*1024})}}),/size limit/);
});

test('backup never completes a manifest after source replacement, addition or deletion', async()=>{
  for (const mutation of ['replacement','addition','deletion']) {
    const {env,records}=await fixture(); let reads=0;
    env.SOURCE.list=async()=>({objects:++reads===1?[{key:'private/photo.jpg',etag:'v1'}]:
      mutation==='replacement'?[{key:'private/photo.jpg',etag:'v2'}]:
      mutation==='addition'?[{key:'private/photo.jpg',etag:'v1'},{key:'private/new.jpg',etag:'v1'}]:[],truncated:false});
    await assert.rejects(backupMedia(env),/Source changed/);
    assert.equal(records.has('staging/test/media-manifest.json'),false);
  }
});

test('direct workflow helper enforces expiry, unique completed run and valid paths',async()=>{
  const {env,records}=await fixture();
  await assert.rejects(backupMedia({...env,BACKUP_EXPIRES_AT:'1'}),/expired/);
  await assert.rejects(backupMedia({...env,BACKUP_RUN_ID:'../other'}),/run ID/);
  await assert.rejects(backupMedia({...env,BACKUP_RUN_ID:''}),/run ID/);
  await backupMedia(env);
  const completed=records.get('staging/test/media-manifest.json');
  await assert.rejects(backupMedia(env),/already completed/);
  assert.equal(records.get('staging/test/media-manifest.json'),completed);
});

test('backup rejects broken pagination without claiming completion',async()=>{
  const {env,records}=await fixture();
  env.SOURCE.list=async()=>({objects:[],truncated:true});
  await assert.rejects(backupMedia(env),/pagination/);
  assert.equal(records.size,0);
});
