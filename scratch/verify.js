const https = require('https');
function get(url){return new Promise((res,rej)=>{const o={headers:{'User-Agent':'Mozilla/5.0'}};https.get(url,o,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
function extract(t, v){
  const ai=t.indexOf(v); if(ai<0)return null;
  const os=t.indexOf('{',ai), as=t.indexOf('[',ai);
  const vs=(as>=0&&(os<0||as<os))?as:os; if(vs<0)return null;
  const st=[]; let inS=false,esc=false;
  for(let i=vs;i<t.length;i++){const c=t[i];
    if(inS){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')inS=false;continue;}
    if(c==='"')inS=true; else if(c==='['||c==='{')st.push(c);
    else if(c===']'||c==='}'){st.pop();if(st.length===0){try{return JSON.parse(t.slice(vs,i+1));}catch(e){return null;}}}}
  return null;
}
function norm(s){return String(s||'').trim().toLowerCase().replace(/\s+/g,'');}
(async()=>{
  const groups=[['SNH','snh'],['GNZ','gnz'],['BEJ','bej'],['CKG','ckg'],['CGT','cgt']];
  for(const [label,key] of groups){
    const t=await get('https://www.snh48.com/js/json_data_'+key+'.js');
    const songsObj=extract(t,'ix_songs_'+key);
    const recObj=extract(t,'records_'+key);
    const songs=(songsObj&&songsObj[label])||(Array.isArray(songsObj)?songsObj:[]);
    const recs=(recObj&&recObj[label])||(Array.isArray(recObj)?recObj:[]);
    console.log('=== '+label+' === songs:'+songs.length+' records:'+recs.length);
    if(songs.length){
      const rmap=new Map(); recs.forEach(r=>rmap.set(norm(r.title), r));
      let matched=0; const sampleKeys=new Set();
      songs.slice(0,4).forEach(s=>{
        const rec=rmap.get(norm(s.record_name));
        if(rec)matched++;
        console.log('  song:', JSON.stringify({name:s.songs_name, album:s.record_name, time:s.songs_time, url:s.url, recTeam:rec?rec.team:'(no rec)', recImg:rec?rec.image.slice(0,40):'(none)'}));
      });
      // match rate
      let rate=0; songs.forEach(s=>{ if(rmap.get(norm(s.record_name))) rate++; });
      console.log('  record_name MATCH RATE:', (rate/songs.length*100).toFixed(1)+'%');
      console.log('  distinct record_name:', new Set(songs.map(s=>s.record_name)).size);
      console.log('  distinct team in records:', new Set(recs.map(r=>r.team)).size);
    }
  }
})().catch(e=>{console.error('ERR',e);});
