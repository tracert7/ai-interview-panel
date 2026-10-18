import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {SecureStore,windowsProtect} from '../lib/secure-store.mjs';
test('non-Windows credentials are memory-only while host identity persists',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'interview-store-test-'));let first,second;
 try{first=new SecureStore(dir,{platform:'linux'});await first.init();const id=first.hostId;await first.save({version:1,activeId:'oaiapp_synthetic',profiles:[{clientId:'oaiapp_synthetic',subject:'test-subject',email:null,credentials:'SYNTHETIC_NOT_REAL'}]});await assert.rejects(readFile(path.join(dir,'accounts.auth.enc')));assert(!(await readFile(path.join(dir,'registrations.json'),'utf8')).includes('SYNTHETIC_NOT_REAL'));first.release();second=new SecureStore(dir,{platform:'linux'});await second.init();assert.equal(second.hostId,id);assert.equal(second.data.profiles.length,1);assert.equal(second.data.profiles[0].credentials,null);}
 finally{first?.release();second?.release();assert(dir.startsWith(path.join(os.tmpdir(),'interview-store-test-')));await rm(dir,{recursive:true,force:true});}
});
test('a second runtime cannot use the same rotating credential record',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'interview-store-test-'));const a=new SecureStore(dir,{platform:'linux'}),b=new SecureStore(dir,{platform:'linux'});
 try{await a.init();await assert.rejects(b.init(),/다른 면접실/);}finally{a.release();b.release();assert(dir.startsWith(path.join(os.tmpdir(),'interview-store-test-')));await rm(dir,{recursive:true,force:true});}
});
test('Windows DPAPI encrypts and decrypts synthetic data without plaintext storage',{skip:process.platform!=='win32'},async()=>{
 const plain=Buffer.from('SYNTHETIC TEST DATA - NOT A REAL TOKEN');const encrypted=await windowsProtect(plain);assert(!encrypted.includes(plain));assert.deepEqual(await windowsProtect(encrypted,true),plain);
});
