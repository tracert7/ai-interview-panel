import {execFileSync} from 'node:child_process';
const paths=execFileSync('git',['diff','--cached','--name-only','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const p of paths){
  if(/(^|\/)(\.private|private|node_modules)(\/|$)|\.auth\.enc$/.test(p)||/(^|\/)\.env/.test(p)&&p!=='.env.example')throw Error('Private file cannot be published: '+p);
  if(/\.(png|jpe?g|gif|webp)$/.test(p))continue;
  const text=execFileSync('git',['show',':'+p],{encoding:'utf8'});
  if(/sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text))throw Error('Possible credential in staged file: '+p);
}
console.log('Public-file check passed for '+paths.length+' staged files. No private directories or credential-like literals found.');
