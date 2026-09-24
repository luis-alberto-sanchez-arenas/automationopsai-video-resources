(()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const number=value=>new Intl.NumberFormat('es-MX',{notation:Number(value)>=10000?'compact':'standard',maximumFractionDigits:1}).format(Number(value)||0);
  const token=()=>localStorage.getItem('automationops_admin_token')||'';
  const request=async(path,options={})=>{
    const response=await fetch(path,{...options,headers:{...(options.headers||{}),authorization:`Bearer ${token()}`}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
    return data;
  };
  function shell(){
    const publications=document.getElementById('publications');
    if(!publications||document.getElementById('analytics'))return;
    publications.insertAdjacentHTML('beforebegin',`<section id="analytics" class="panel insights">
      <div class="insights-head"><div><h2>Rendimiento del canal</h2><div class="sub">Datos reales de YouTube; periodo predeterminado de 28 días.</div></div><div class="insights-actions"><span id="analyticsUpdated" class="pill">Sin actualizar</span><button class="button secondary small" type="button" id="analyticsRefresh">Actualizar métricas</button></div></div>
      <div id="insightCards" class="insights-grid"><div class="empty">Esperando acceso al canal…</div></div>
      <div class="analytics-body"><div class="subpanel"><div class="subpanel-title"><h3>Videos con más vistas</h3><span id="managedTotals" class="sub"></span></div><div id="topVideos" class="empty">Sin datos.</div></div><div class="subpanel"><div class="subpanel-title"><h3>Incidencias de publicación</h3><span id="incidentCount" class="pill">0</span></div><div id="incidentList" class="empty">Sin incidencias.</div></div><div class="subpanel stale-topics"><div class="subpanel-title"><h3>Temas bloqueados por baja relevancia</h3><span id="staleCount" class="pill">0</span></div><div id="staleTopics" class="empty">Ningún video público lleva siete días con cero vistas.</div></div><div class="subpanel commitments"><div class="subpanel-title"><h3>Compromisos con la audiencia</h3><span id="commitmentCount" class="pill">0</span></div><div id="commitmentList" class="empty">Sin solicitudes detectadas.</div></div></div>
    </section>`);
    document.getElementById('analyticsRefresh').addEventListener('click',load);
  }
  function renderAnalytics(data){
    const period=data.period||{},channel=data.channel||{},delta=Number(period.subscriberDelta||0),deltaClass=delta>0?'positive':delta<0?'negative':'';
    document.getElementById('insightCards').innerHTML=`
      <article class="insight"><span>Suscriptores</span><strong>${number(channel.subscribers)}</strong><small>Total actual</small></article>
      <article class="insight"><span>Nuevos netos</span><strong class="${deltaClass}">${period.available?(delta>0?'+':'')+number(delta):'—'}</strong><small>${period.available?'Últimos 28 días':'Permiso pendiente'}</small></article>
      <article class="insight"><span>Vistas del canal</span><strong>${number(channel.views)}</strong><small>Total acumulado</small></article>
      <article class="insight"><span>Vistas recientes</span><strong>${period.available?number(period.views):'—'}</strong><small>Últimos 28 días</small></article>
      <article class="insight"><span>Comentarios</span><strong>${number(data.totals?.comments)}</strong><small>Videos administrados</small></article>`;
    const videos=data.topVideos||[];
    document.getElementById('topVideos').className=videos.length?'':'empty';
    document.getElementById('topVideos').innerHTML=videos.map((video,index)=>`<div class="video-rank"><span class="rank">${index+1}</span><a href="${esc(video.url)}" target="_blank" rel="noreferrer" title="${esc(video.title)}">${esc(video.title)}</a><span class="metric"><b>${number(video.views)}</b><small>Vistas</small></span><span class="metric"><b>${number(video.likes)}</b><small>Likes</small></span><span class="metric"><b>${number(video.comments)}</b><small>Comentarios</small></span></div>`).join('')||'Todavía no hay videos vinculados.';
    const stale=data.staleZeroViewVideos||[];
    document.getElementById('staleCount').textContent=String(stale.length);
    document.getElementById('staleTopics').className=stale.length?'':'empty';
    document.getElementById('staleTopics').innerHTML=stale.map(video=>`<div class="stale-topic"><a href="${esc(video.url)}" target="_blank" rel="noreferrer">${esc(video.title)}</a><span>${Math.floor(Number(video.ageDays)||0)} días · 0 vistas · excluido de nuevas propuestas</span></div>`).join('')||'Ningún video público lleva siete días con cero vistas.';
    document.getElementById('managedTotals').textContent=`${number(data.totals?.views)} vistas · ${number(data.totals?.likes)} likes`;
    document.getElementById('analyticsUpdated').textContent=`Actualizado ${new Date(data.updatedAt).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}`;
    const old=document.getElementById('analyticsPermission');if(old)old.remove();
    if(!period.available){document.getElementById('insightCards').insertAdjacentHTML('afterend',`<div id="analyticsPermission" class="analytics-note">Las métricas históricas necesitan el permiso de YouTube Analytics. <button class="button ghost small" type="button" id="analyticsOauth">Reautorizar métricas</button><div>${esc(period.error)}</div></div>`);document.getElementById('analyticsOauth').addEventListener('click',()=>window.oauth?.())}
  }
  function renderIncidents(data){
    const items=data.items||[];document.getElementById('incidentCount').textContent=String(data.total||0);
    const list=document.getElementById('incidentList');list.className=items.length?'':'empty';list.innerHTML=items.map(job=>`<div class="incident"><div class="incident-top"><div><b>${esc(job.title)}</b><span class="incident-meta">Intentos ${job.retryCount}/4${job.terminal?' · detenido':''}</span></div><button class="button secondary small retry-job" data-id="${esc(job.id)}" type="button">Reintentar</button></div><p>${esc(job.lastError||'Error sin detalle')}</p></div>`).join('')||'Sin incidencias.';
    list.querySelectorAll('.retry-job').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;button.textContent='Reintentando…';try{await request(`/api/jobs/${encodeURIComponent(button.dataset.id)}/retry`,{method:'POST'});await window.refreshAll?.();await load()}catch(error){button.disabled=false;button.textContent='Reintentar';window.notice?.(error.message,'error')}}));
  }
  function renderCommitments(data){
    const items=data.items||[],pending=items.filter(x=>x.status==='pending').length;document.getElementById('commitmentCount').textContent=pending?`${pending} pendiente${pending===1?'':'s'}`:`${items.length} atendido${items.length===1?'':'s'}`;
    const list=document.getElementById('commitmentList');list.className=items.length?'':'empty';list.innerHTML=items.map(item=>`<div class="commitment"><div><b>“${esc(item.trigger)}” · ${esc(item.sourceTitle)}</b><small>${item.requestCount} solicitud(es) de ${esc(item.commenters.join(', '))}${item.followUp?` · Entregado: <a href="${esc(item.followUp.url)}" target="_blank" rel="noreferrer">${esc(item.followUp.title)}</a>`:' · Se incorporará como prioridad editorial'}</small></div><span class="commitment-state ${item.status}">${item.status==='fulfilled'?'Entregado':'Pendiente'}</span></div>`).join('')||'Sin solicitudes detectadas.';
  }
  async function load(){
    shell();if(!token()){document.getElementById('insightCards').innerHTML='<div class="empty">Conecta el panel para consultar YouTube.</div>';return}
    const button=document.getElementById('analyticsRefresh');if(button){button.disabled=true;button.textContent='Consultando…'}
    const [analytics,incidents,commitments]=await Promise.allSettled([request('/api/analytics?days=28'),request('/api/jobs?page=1&pageSize=25&status=failed&sort=updatedAt&direction=desc'),request('/api/engagement')]);
    if(analytics.status==='fulfilled'&&analytics.value)renderAnalytics(analytics.value);else document.getElementById('insightCards').innerHTML=`<div class="empty">No se pudieron consultar las métricas: ${esc(analytics.reason?.message||'Sin conexión')}</div>`;
    if(incidents.status==='fulfilled')renderIncidents(incidents.value);else document.getElementById('incidentList').textContent='No se pudieron consultar las incidencias.';
    if(commitments.status==='fulfilled')renderCommitments(commitments.value);else document.getElementById('commitmentList').textContent='No se pudieron revisar los compromisos.';
    if(button){button.disabled=false;button.textContent='Actualizar métricas'}
  }
  document.addEventListener('DOMContentLoaded',()=>{shell();load();setInterval(()=>{if(document.visibilityState==='visible')load()},60000)});
})();
