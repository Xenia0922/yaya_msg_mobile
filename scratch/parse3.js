const https = require('https');
function get(url){return new Promise((res,rej)=>{const o={headers:{'User-Agent':'Mozilla/5.0'}};https.get(url,o,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
function extract(scriptText, variableName){
  const ai = scriptText.indexOf(variableName);
  if(ai<0) return null;
  const os = scriptText.indexOf('{', ai);
  const as = scriptText.indexOf('[', ai);
  const vs = (as>=0 && (os<0||as<os))?as:os;
  if(vs<0) return null;
  const stack=[]; let inStr=false,esc=false;
  for(let i=vs;i<scriptText.length;i++){
    const c=scriptText[i];
    if(inStr){ if(esc)esc=false; else if(c==='\\')esc=true; else if(c==='"')inStr=false; continue;}
    if(c==='"')inStr=true;
    else if(c==='['||c==='{')stack.push(c);
    else if(c===']'||c==='}'){stack.pop(); if(stack.length===0){try{return JSON.parse(scriptText.slice(vs,i+1));}catch(e){return null;}}}
  }
  return null;
}
(async()=>{
  const t = await get('https://www.snh48.com/js/json_data_snh.js');
  // list all top-level var declarations
  const vars = [...t.matchAll(/var\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m=>m[1]);
  console.log('TOP-LEVEL VARS:', vars.join(', '));
  const list = extract(t,'ix_mp3list_snh');
  // distinct key-sets across entries
  const keySets = new Set();
  list.forEach(it=>keySets.add(Object.keys(it).sort().join('|')));
  console.log('DISTINCT KEY-SETS in ix_mp3list_snh:', [...keySets].join('  ||  '));
  // sample a few entries from different parts
  [0,50,100,150,200,233].forEach(i=>{ if(list[i]) console.log('['+i+']', JSON.stringify(list[i])); });
  // Does any entry have album/team/singer/cover fields?
  const hasExtra = list.filter(x=>['album','team','singer','cover','image','id','songId'].some(k=>k in x)).length;
  console.log('ENTRIES WITH EXTRA ALBUM-LIKE FIELDS:', hasExtra);
  // mp3 filename prefixes
  const prefixes = new Set(list.map(x=>String(x.mp3||'').split('/').pop().replace(/_\d+\.mp3$/i,'').replace(/\.mp3$/i,'')));
  console.log('MP3 PREFIXES (sample):', [...prefixes].slice(0,40).join(', '));
})().catch(e=>{console.error('ERR',e);});
