const https = require('https');
function get(url){return new Promise((res,rej)=>{https.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
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
  console.log('SCRIPT LENGTH:', t.length);
  const list = extract(t,'ix_mp3list_snh');
  console.log('LIST TYPE:', Array.isArray(list)?('array len '+list.length):typeof list);
  if(Array.isArray(list)){
    console.log('--- FIRST 6 ENTRIES ---');
    for(let i=0;i<Math.min(6,list.length);i++){
      const it=list[i];
      console.log('['+i+'] keys:', Object.keys(it).join(','));
      console.log(JSON.stringify(it).slice(0,600));
      console.log('');
    }
    const artists = new Set(list.map(x=>String(x.artist||'')));
    console.log('DISTINCT artist COUNT:', artists.size);
    console.log('SAMPLE artists:', [...artists].slice(0,15).join(' | '));
    const albums = new Set(list.map(x=>String(x.album||'')));
    console.log('DISTINCT album COUNT:', albums.size);
    console.log('SAMPLE albums:', [...albums].slice(0,15).join(' | '));
    const titles = new Set(list.map(x=>String(x.title||'')));
    console.log('DISTINCT title COUNT:', titles.size);
  }
  const rec = extract(t,'records_snh');
  console.log('--- records_snh ---');
  console.log('TYPE:', Array.isArray(rec)?('array len '+rec.length):(rec?('object keys '+Object.keys(rec).join(',')):typeof rec));
  if(Array.isArray(rec)){ console.log('REC[0]:', JSON.stringify(rec[0]).slice(0,300)); }
  else if(rec){ const k=Object.keys(rec)[0]; console.log('REC['+k+'][0]:', JSON.stringify(rec[k] && rec[k][0]).slice(0,300)); }
})().catch(e=>{console.error('ERR',e);});
