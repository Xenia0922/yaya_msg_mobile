const https = require('https');
function get(url){return new Promise((res,rej)=>{const o={headers:{'User-Agent':'Mozilla/5.0'}};https.get(url,o,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async()=>{
  const t = await get('https://www.snh48.com/js/json_data_snh.js');
  const ai = t.indexOf('ix_songs_snh');
  const mi = t.indexOf('ix_mp3list_snh');
  console.log('ix_songs_snh at', ai, ' len to next var:', mi-ai);
  const seg = t.slice(ai, mi);
  console.log('SEGMENT:', seg.slice(0, 200));
  console.log('SEGMENT end:', seg.slice(-200));
  // Count occurrences of songs_name in this segment
  const cnt = (seg.match(/songs_name/g)||[]).length;
  console.log('songs_name count in segment:', cnt);
  // How does it end?
  console.log('ends with ";"?', seg.trim().endsWith(';'));
})().catch(e=>{console.error('ERR',e);});
