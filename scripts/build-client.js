'use strict';
// Compiles the single-file JSX client into a content-hashed asset and vendors
// the browser runtime locally. The source page loads React, ReactDOM and lucide
// from unpkg at a floating major ("react@18"), which makes every production page
// load depend on a third party that can change version, go down, or be tampered
// with while a signed-in session is on screen. The built page serves the exact
// versions pinned in package-lock.json from this origin instead.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const babel=require('@babel/standalone');
const root=path.join(__dirname,'..');
const input=fs.readFileSync(path.join(root,'public/index.html'),'utf8');

const pattern=/<script[^>]*type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
const match=input.match(pattern);
if(!match) throw new Error('Expected exactly one JSX entry point');
const js=babel.transform(match[1],{presets:['react'],comments:false,compact:true}).code;
const hash=crypto.createHash('sha256').update(js).digest('hex').slice(0,16);
const dir=path.join(root,'public/build');
fs.mkdirSync(path.join(dir,'vendor'),{recursive:true});
fs.writeFileSync(path.join(dir,`app.${hash}.js`),js);

// Copy each pinned runtime next to the app and rewrite its <script src>.
const VENDOR=[
  {module:'react/umd/react.production.min.js',       file:'react.production.min.js',     match:/<script[^>]*src="https:\/\/unpkg\.com\/react@[^"]*"[^>]*><\/script>/},
  {module:'react-dom/umd/react-dom.production.min.js',file:'react-dom.production.min.js',match:/<script[^>]*src="https:\/\/unpkg\.com\/react-dom@[^"]*"[^>]*><\/script>/},
  {module:'lucide/dist/umd/lucide.min.js',            file:'lucide.min.js',              match:/<script[^>]*src="https:\/\/unpkg\.com\/lucide@[^"]*"[^>]*><\/script>/},
];
let html=input;
const vendored=[];
for(const v of VENDOR){
  const source=path.join(root,'node_modules',v.module);
  if(!fs.existsSync(source)) throw new Error(`Missing pinned runtime ${v.module}. Run npm ci before building.`);
  const bytes=fs.readFileSync(source);
  const vhash=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16);
  const name=v.file.replace(/\.js$/,`.${vhash}.js`);
  fs.writeFileSync(path.join(dir,'vendor',name),bytes);
  if(!v.match.test(html)) throw new Error(`Could not find the CDN tag for ${v.file} in public/index.html`);
  html=html.replace(v.match,`<script src="/build/vendor/${name}"></script>`);
  vendored.push(`${v.file} ${bytes.length}B`);
}

html=html
  .replace(/\s*<script src="https:\/\/unpkg.com\/@babel\/standalone[^>]*><\/script>/,'')
  .replace(pattern,`<script src="/build/app.${hash}.js"></script>`);
if(/unpkg\.com/.test(html)) throw new Error('Built page still references unpkg.com');
fs.writeFileSync(path.join(dir,'index.html'),html);
console.log(`Built app.${hash}.js (${Buffer.byteLength(js)} bytes); no browser JSX compilation.`);
console.log(`Vendored from node_modules: ${vendored.join(', ')}; built page loads no third-party scripts.`);
