const fs=require('fs');
// Heskestad: flame height and plume centreline for Qc=26.6 MW, D=4.51 m
const Q=38000,Qc=26600,D=4.51,z0=-1.02*D+0.083*Math.pow(Q,0.4),L=0.235*Math.pow(Q,0.4)-1.02*D;
const heskestad=z=>24.9*Math.pow(Qc,2/3)*Math.pow(z-z0,-5/3);
console.log('Heskestad flame height',L.toFixed(1),'virtual origin',z0.toFixed(2));
for(const f of fs.readdirSync('results').filter(x=>x.startsWith(process.argv[2]||'cal-')&&x.endsWith('.json'))){const r=JSON.parse(fs.readFileSync('results/'+f));console.log(r.name,'peak speed',r.peakSpeed,'wall',r.wallSeconds);
console.log('  '+r.centreline.filter(s=>[1.25,4.25,7.25,10.25,12.25,14.25,16.25,18.25,20.25].includes(s.y)).map(s=>`${s.y}m:${s.peak}/${s.y>L?Math.round(heskestad(s.y)):'flame'}`).join('  '))}
