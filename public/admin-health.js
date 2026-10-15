/* Presentation of the existing adminPlatformHealth response; no fallback figures. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BBAdminHealth=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function summarize(data,records){
    if(!data||!data.health||Array.isArray(data.health)||typeof data.health!=='object')throw Error('Connection data unavailable');
    const counts={connected:0,expired:0,disconnected:0,other:0};
    for(const row of Object.values(data.health)){
      if(!row||Object.keys(counts).some(key=>!Number.isInteger(row[key])||row[key]<0))throw Error('Invalid connection counts');
      for(const key of Object.keys(counts))counts[key]+=row[key];
    }
    const total=Object.values(counts).reduce((a,b)=>a+b,0);
    if(!Number.isInteger(data.totalConnections)||data.totalConnections!==total)throw Error('Incomplete connection counts');
    const percent=total?Math.round(counts.connected/total*100):null;
    const description=(total?counts.connected+' of '+total+' saved connections marked connected.':'No saved connections yet.')+(data.truncated?' Limited sample; more connections may exist.':'')+' This is connection status, not overall system uptime.';
    const ids=new Set([...records.map(p=>p.id),...Object.keys(data.health)]);
    const platforms=[...ids].map(id=>{
      const record=records.find(p=>p.id===id),row=data.health[id],manual=record?.deliveryMode==='manual';
      const attention=row?row.expired+row.disconnected+row.other:0;
      return {id,name:record?.name||id,mode:manual?'Manual':record?.deliveryMode==='auto'?'Auto-post':'Not available',
        status:manual?'Manual':!row||!row.total?'No data':attention?'Needs attention':'Connected',
        badge:manual||!row||!row.total?'off':attention?'needs':'live',
        description:manual?'You post it; no automatic connection required.':!row||!row.total?'No saved connection records.':row.connected+' connected; '+attention+' need attention.'};
    });
    return {counts,total,percent,description,platforms,truncated:!!data.truncated};
  }
  return {summarize};
});
