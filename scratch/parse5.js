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
  const songs = extract(t,'ix_songs_snh');
  if(songs && typeof songs==='object'){
    const keys = Object.keys(songs);
    console.log('ix_songs_snh is OBJECT with', keys.length, 'keys');
    console.log('FIRST 5 KEYS:', keys.slice(0,5).join(', '));
    const sampleKey = keys[0];
    console.log('SAMPLE KEY:', sampleKey);
    console.log('SAMPLE VALUE:', JSON.stringify(songs[sampleKey]).slice(0,800));
    // print a few more
    keys.slice(0,3).forEach(k=>{ console.log('['+k+']', JSON.stringify(songs[k]).slice(0,400)); });
  } else { console.log('not object', typeof songs); }
})().catch(e=>{console.error('ERR',e);});
