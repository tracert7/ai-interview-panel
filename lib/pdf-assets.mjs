import {readFile} from 'node:fs/promises';
const packageURL=import.meta.resolve('pdfjs-dist/package.json');
const folders={cMapUrl:'cmaps',standardFontDataUrl:'standard_fonts',wasmUrl:'wasm'};
// PDF-supplied names can only refer to packaged assets, never arbitrary PC paths or URLs.
export class LocalPDFAssets{
  async fetch({kind,filename}){
    if(!Object.hasOwn(folders,kind)||typeof filename!=='string'||!/^[A-Za-z0-9_-]+\.(bcmap|ttf|pfb|otf|wasm)$/.test(filename))throw Error('지원하지 않는 PDF 문자 자원입니다.');
    return new Uint8Array(await readFile(new URL('./'+folders[kind]+'/'+filename,packageURL)));
  }
}
