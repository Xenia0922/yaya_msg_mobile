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
  console.log('ix_songs_snh TYPE:', Array.isArray(songs)?('array len '+songs.length):typeof songs);
  if(Array.isArray(songs) && songs[0]){
    console.log('SONG[0] keys:', Object.keys(songs[0]).join(','));
    console.log(JSON.stringify(songs[0]).slice(0,800));
    console.log('---');
    console.log('SONG[1] keys:', Object.keys(songs[1]).join(','));
    console.log(JSON.stringify(songs[1]).slice(0,800));
  }
})().catch(e=>{console.error('ERR',e);});
