/* Presentation of the existing adminPlatformHealth response; no fallback figures. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BBAdminHealth=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function connectionState(connection,records){
    const mode=records.find(p=>p.id===connection.platform)?.deliveryMode;
    if(mode!=='auto')return {status:mode==='manual'?'manual':'unknown',label:mode==='manual'?'Manual':'Unknown platform',badge:'off',review:false,reconnect:false};
    const states={connected:['Connected','live'],expired:['Expired','needs'],error:['Recorded error','needs'],disconnected:['Not connected','off'],pending:['Pending','info'],unknown:['Unknown','info']};
    const status=Object.hasOwn(states,connection.status)?connection.status:'unknown';
    return {status,label:states[status][0],badge:states[status][1],review:status!=='connected',reconnect:status==='expired'};
  }
  function summarize(data,records){
    if(!data||!data.health||Array.isArray(data.health)||typeof data.health!=='object')throw Error('Connection data unavailable');
    const counts={connected:0,expired:0,disconnected:0,other:0};
    let rawTotal=0,excluded=0;
    for(const [id,row] of Object.entries(data.health)){
      if(!row||Object.keys(counts).some(key=>!Number.isInteger(row[key])||row[key]<0))throw Error('Invalid connection counts');
      const rowTotal=Object.keys(counts).reduce((sum,key)=>sum+row[key],0);
      if(row.total!==rowTotal)throw Error('Incomplete platform counts');
      rawTotal+=rowTotal;
      if(records.find(p=>p.id===id)?.deliveryMode==='auto'){
        for(const key of Object.keys(counts))counts[key]+=row[key];
      }else excluded+=rowTotal;
    }
    const total=Object.values(counts).reduce((a,b)=>a+b,0);
    if(!Number.isInteger(data.totalConnections)||data.totalConnections!==rawTotal)throw Error('Incomplete connection counts');
    const percent=total?Math.round(counts.connected/total*100):null;
    const description=(total?counts.connected+' of '+total+' saved auto-post connections marked connected.':'No saved auto-post connections yet.')+' Manual destinations are excluded.'+(excluded?' '+excluded+' other saved records excluded.':'')+(data.truncated?' Limited sample; more connections may exist.':'')+' This is saved connection status, not provider uptime.';
    const ids=new Set([...records.map(p=>p.id),...Object.keys(data.health)]);
    const platforms=[...ids].map(id=>{
      const record=records.find(p=>p.id===id),row=data.health[id],manual=record?.deliveryMode==='manual';
      const auto=record?.deliveryMode==='auto';
      const status=manual?'Manual':!auto?'Unknown platform':!row||!row.total?'No data':row.expired?'Needs attention':row.other?'Needs review':row.disconnected?'Not connected':'Connected';
      return {id,name:record?.name||id,mode:manual?'Manual':record?.deliveryMode==='auto'?'Auto-post':'Not available',
        status,badge:status==='Connected'?'live':status==='Needs attention'?'needs':status==='Needs review'?'info':'off',
        description:manual?'You post it; no automatic connection required.':!auto?'Delivery mode unknown; excluded from auto-post counts.':!row||!row.total?'No saved connection records.':row.connected+' connected; '+row.expired+' expired; '+row.disconnected+' not connected; '+row.other+' other/unknown. Not a provider outage check.'};
    });
    return {counts,total,percent,description,platforms,truncated:!!data.truncated};
  }
  return {summarize,connectionState};
});
