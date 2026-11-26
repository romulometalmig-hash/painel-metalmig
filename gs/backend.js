// MM-BACKEND
// Caixa de correio Metalmig - cole em script.google.com e implante como Aplicativo da Web
const VERSAO='v265';
const PASTA='Backups Metalmig';
const PASTA_PED='Pedidos recebidos';   // pedidos dos representantes (PDF + dados)

function pasta_(){const it=DriveApp.getFoldersByName(PASTA);return it.hasNext()?it.next():DriveApp.createFolder(PASTA)}
function arq_(f,n){const it=f.getFilesByName(n);return it.hasNext()?it.next():null}
function grava_(f,n,t){const a=arq_(f,n);if(a)a.setContent(t);else f.createFile(n,t,MimeType.PLAIN_TEXT)}
function resp_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)}
function chaveRep_(cod){const s=Utilities.computeHmacSha256Signature(String(cod),CHAVE_MESTRA);return s.map(function(b){return('0'+(b&255).toString(16)).slice(-2)}).join('').slice(0,32)}
function fotoG_(f,txt,agora){try{const pr=PropertiesService.getScriptProperties(),ult=+pr.getProperty('fotoG_ts')||0,h=pr.getProperty('fotoG_hash')||'';
  if(agora-ult<2*3600*1000)return;const hs=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,txt));if(hs===h)return;
  const nome='gestor_foto_'+Utilities.formatDate(new Date(agora),'America/Sao_Paulo','yyyy-MM-dd_HHmm')+'.json';f.createFile(nome,txt,MimeType.PLAIN_TEXT);
  pr.setProperty('fotoG_ts',String(agora));pr.setProperty('fotoG_hash',hs);
  const lim=agora-30*864e5,it=f.searchFiles('title contains "gestor_foto_"');while(it.hasNext()){const a=it.next();if(a.getDateCreated().getTime()<lim)a.setTrashed(true)}}catch(x){}}
function limpaG_(f){const lim=Date.now()-30*864e5,it=f.searchFiles('title contains "gestor_sync_"');while(it.hasNext()){const a=it.next();if(a.getDateCreated().getTime()<lim)a.setTrashed(true)}}
function limpa_(f,cod){const lim=Date.now()-30*864e5,it=f.searchFiles('title contains "backup_'+cod+'_"');while(it.hasNext()){const a=it.next();if(a.getDateCreated().getTime()<lim)a.setTrashed(true)}}


// ---- sincronização do gestor entre aparelhos
function uni_(a,b){try{const x=JSON.parse(a),y=JSON.parse(b);if(Array.isArray(x)&&Array.isArray(y)&&x.every(function(i){return i&&i.id!=null})&&y.every(function(i){return i&&i.id!=null})){const m={};x.forEach(function(i){m[i.id]=i});y.forEach(function(i){m[i.id]=i});return JSON.stringify(Object.keys(m).map(function(k){return m[k]}))}}catch(e){}return null}
function mergeGsync_(cur,inc,last){
  cur=cur||{ls:{},ts:{}};cur.ls=cur.ls||{};cur.ts=cur.ts||{};inc=inc||{};const its=inc.ts||{},ils=inc.ls||{};
  Object.keys(its).forEach(function(k){
    const it=+its[k]||0,has=(k in cur.ts),ct=has?+cur.ts[k]:-1;
    if(!has){cur.ts[k]=it;if(ils[k]!=null)cur.ls[k]=ils[k];else delete cur.ls[k];return}
    const a=cur.ls[k],b=ils[k];
    if(a!=null&&b!=null&&a!==b&&it>=last&&ct>=last){      // os dois aparelhos mexeram: junta item por item
      const older=it>ct?a:b,newer=it>ct?b:a,u=uni_(older,newer);
      if(u!=null){cur.ls[k]=u;cur.ts[k]=Math.max(it,ct);return}
    }
    if(it>ct){cur.ts[k]=it;if(b!=null)cur.ls[k]=b;else delete cur.ls[k]}
  });
  return cur;
}

// ---- prospecção: o gestor entrega tarefas às internas e elas devolvem os contatos
function hk_(x){return [x.d,x.res,x.obs||'',x.ret||'',x.by||''].join('|')}
function mergeRetorno_(cur,inc){
  cur=cur||{};inc=inc||{};
  Object.keys(inc).forEach(function(id){
    const c=cur[id]=cur[id]||{hist:[],st:''},n=inc[id]||{},seen={};
    c.hist.forEach(function(x){seen[hk_(x)]=1});
    (n.hist||[]).forEach(function(x){if(!seen[hk_(x)]){c.hist.push(x);seen[hk_(x)]=1}});
    c.hist.sort(function(a,b){return String(a.d).localeCompare(String(b.d))});
    const fecha=function(t){return t==='pedido'||t==='sem'};
    if(fecha(n.st))c.st=n.st;else if(!fecha(c.st))c.st=n.st||c.st||'';
    if(n.ac&&(!c.ac||String(n.ac.t||'')>=String(c.ac.t||'')))c.ac=n.ac;   // aceite ou recusa da reativação
  });
  return cur;
}
// ---- reativação: avisa o gestor por e-mail quando chega pedido de cliente em acompanhamento
function avisoReat_(d,b,ant){
  if(ant)return;
  const idx=lerJson_(pasta_(),'reat_idx.json',{lista:[]}).lista||[];
  const cli=String(d.cli||'');
  for(var i=0;i<idx.length;i++){
    if(String(idx[i].cli)===cli){
      const para=Session.getEffectiveUser().getEmail();
      const assunto='Cliente reativado fez pedido: '+String(b.cliNome||cli);
      const corpo='O representante '+String(b.repNome||'')+' enviou o pedido nº '+String(b.num||'')+' de R$ '+Number(d.geral||0).toFixed(2).replace('.',',')+' para '+String(b.cliNome||cli)+'.\n\nEste cliente estava em acompanhamento na Reativação. Abra o painel do gestor para ver o status.';
      MailApp.sendEmail(para,assunto,corpo);
      return;
    }
  }
}
// ---- v265 · retaguarda: aviso por e-mail ao representante quando o pedido é digitado
function okRet_(k){return k===CHAVE_GESTOR||k===CHAVE_RETAG}
function mailOk_(m){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(m||'').trim())}
function moeda_(v){return 'R$ '+Number(v||0).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.')}
function esc_(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function emails_(f){const o={};Object.keys(EMAILS_INICIAIS).forEach(function(c){o[c]=EMAILS_INICIAIS[c]});const g=lerJson_(f,'emails_reps.json',{});Object.keys(g).forEach(function(c){o[c]=g[c]});return o}
function avisoDig_(r){
  const ts=new Date().toISOString();
  try{
    const em=emails_(pasta_());
    const para=String(em[String(r.rep)]||'').trim().toLowerCase(),cli=String(r.emCli||'').trim().toLowerCase();
    const okP=mailOk_(para),okC=mailOk_(cli);
    if(!okP&&!okC)return {st:'sem-email',ts:ts};
    const nome=String(r.repNome||'').replace(/\s*-?\s*INATIVO/i,'').trim().split(' ')[0]||'';
    const dono=Session.getEffectiveUser().getEmail();
    const erp=String(r.erp||'');
    var linhas='';(r.itens||[]).forEach(function(i){linhas+='<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">'+esc_(i.n)+'</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">'+esc_(i.q)+'</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">'+moeda_(i.p)+'</td></tr>'});
    const dados='<p>'+(erp?'<b>Nº do pedido na Metalmig:</b> '+esc_(erp)+'<br>':'')+'<b>Pedido nº:</b> '+esc_(r.num)+'<br>'+(r.fat?'<b>Faturamento:</b> '+esc_(r.fat)+'<br>':'')+(r.cob?'<b>Cobrança:</b> '+esc_(r.cob)+'<br>':'')+'<b>Total:</b> '+moeda_(r.geral)+'</p>'
      +(linhas?'<table style="border-collapse:collapse;width:100%;font-size:13.5px"><tr style="background:#f1f4f8"><th style="padding:5px 8px;text-align:left">Item</th><th style="padding:5px 8px;text-align:right">Qtd</th><th style="padding:5px 8px;text-align:right">Valor</th></tr>'+linhas+'</table>':'');
    const cab='<div style="font-family:Arial,sans-serif;font-size:15px;color:#1b2b3d;max-width:560px">',rod='<p style="color:#5d6f84;font-size:13px">Qualquer dúvida, responda este e-mail.</p><p>Metalmig</p></div>';
    if(okP)MailApp.sendEmail({to:para,cc:dono,subject:'✔ Pedido digitado – '+String(r.cliNome||'')+(erp?' (nº '+erp+')':''),htmlBody:cab+'<p>Olá'+(nome?', '+esc_(nome):'')+'!</p><p>O pedido do cliente <b>'+esc_(r.cliNome)+'</b> foi <b>digitado na Metalmig</b>.</p>'+dados+rod,name:'Metalmig',replyTo:dono});
    if(okC)MailApp.sendEmail({to:cli,cc:dono,subject:'Seu pedido foi recebido e digitado na Metalmig'+(erp?' (nº '+erp+')':''),htmlBody:cab+'<p>Olá!</p><p>O pedido de <b>'+esc_(r.cliNome)+'</b> foi <b>recebido e digitado na Metalmig</b>.</p>'+dados+rod,name:'Metalmig',replyTo:dono});
    return {st:'enviado',ts:ts,para:okP?para:'',cli:okC?cli:''};
  }catch(x){return {st:'erro',ts:ts,erro:String(x).slice(0,120)}}
}
// ---- pedidos recebidos
function pastaPed_(){const it=DriveApp.getFoldersByName(PASTA_PED);return it.hasNext()?it.next():DriveApp.createFolder(PASTA_PED)}
function lerIdx_(p){return lerJson_(p,'indice.json',[])}
function limpaNome_(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40)}
function lerJson_(f,nome,vazio){const a=arq_(f,nome);if(!a)return vazio;try{return JSON.parse(a.getBlob().getDataAsString())}catch(e){return vazio}}

// ---- equipe de vendas: cadastro dos vendedores e carteira, um arquivo por representante com time
function mergeEq_(cur,inc){
  cur=cur||{};inc=inc||{};cur.v=cur.v||{};cur.c=cur.c||{};cur.g=cur.g||{};
  const nw=function(a,b){return (+((b||{}).u)||0)>(+((a||{}).u)||0)};
  if(inc.g&&nw(cur.g,inc.g))cur.g=inc.g;
  Object.keys(inc.v||{}).forEach(function(id){if(nw(cur.v[id],inc.v[id]))cur.v[id]=inc.v[id]});
  Object.keys(inc.c||{}).forEach(function(k){const a=cur.c[k],b=inc.c[k];if(!a||(+b[1]||0)>(+a[1]||0))cur.c[k]=b});
  return cur;
}
function eqSync_(f,team,dados){
  const nome='equipe_'+team+'.json';const cur=mergeEq_(lerJson_(f,nome,{}),dados);
  grava_(f,nome,JSON.stringify(cur));return cur;
}
// ---- candidatos a representante (formulário -> painel). So o essencial sai daqui; CPF/banco/endereco so na ficha, ao tocar.
function candFolha_(){return SpreadsheetApp.openById(CAND_ID).getSheets()[0]}
function candCol_(h,re){for(var i=0;i<h.length;i++){if(re.test(String(h[i]).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()))return i}return -1}
function candLista_(){
  const sh=candFolha_(),v=sh.getDataRange().getDisplayValues();if(v.length<2)return [];
  const h=v[0],c={st:candCol_(h,/^contratado/),ts:candCol_(h,/carimbo/),nome:candCol_(h,/^nome completo/),cid:candCol_(h,/^cidade e uf/),tel:candCol_(h,/whats/),tempo:candCol_(h,/ha quanto tempo/),como:candCol_(h,/como voce conheceu/),reg:candCol_(h,/principal cidade/),cli:candCol_(h,/quantos clientes ativos/),cep:candCol_(h,/^cep/)};
  const mk=[];for(var i=0;i<h.length;i++){if(/\d.\s*marca/.test(String(h[i]).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()))mk.push(i)}
  const g=function(r,i){return i>=0?String(r[i]||'').trim():''};const out=[];
  for(var j=1;j<v.length;j++){const r=v[j];const nome=g(r,c.nome);if(!nome)continue;
    const marcas=mk.map(function(i){return g(r,i).split(/\s+-\s+|\(|,/)[0].trim()}).filter(function(m){return m&&!/^(0|n[aã]o.*)$/i.test(m)});
    out.push({row:j+1,st:g(r,c.st),ts:g(r,c.ts),nome:nome,cid:g(r,c.cid),tel:g(r,c.tel),tempo:g(r,c.tempo),como:g(r,c.como),reg:g(r,c.reg),cli:g(r,c.cli),cep:g(r,c.cep),marcas:marcas});
  }
  return out;
}
function candFicha_(nome){
  const sh=candFolha_(),v=sh.getDataRange().getDisplayValues(),h=v[0],ni=candCol_(h,/^nome completo/);
  const nz=function(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()};
  for(var j=v.length-1;j>=1;j--){if(nz(v[j][ni])===nz(nome)){const p=[];for(var i=0;i<h.length;i++){const x=String(v[j][i]||'').trim();if(String(h[i]).trim()&&x)p.push([String(h[i]).trim(),x])}return p}}
  return [];
}
function doPost(e){
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    const b=JSON.parse(e.postData.contents);
    const f=pasta_(),agora=Date.now(),hoje=Utilities.formatDate(new Date(),'America/Sao_Paulo','yyyy-MM-dd');
    if(b.t==='cand_get'){      // gestor: lista de candidatos (so dados basicos)
      if(b.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
      return resp_({ok:true,ts:agora,lista:candLista_()});
    }
    if(b.t==='cand_ficha'){    // gestor: ficha completa de um candidato (so ao tocar)
      if(b.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
      return resp_({ok:true,pares:candFicha_(b.nome)});
    }
    if(b.t==='gsync'){
      if(b.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
      const a=arq_(f,'gestor_sync.json');let cur={ls:{},ts:{}};if(a){try{cur=JSON.parse(a.getBlob().getDataAsString())}catch(x){}}
      cur=mergeGsync_(cur,b.dados,+b.last||0);const txt=JSON.stringify(cur);
      grava_(f,'gestor_sync.json',txt);
      const dn='gestor_sync_'+hoje+'.json';if(!arq_(f,dn))f.createFile(dn,txt,MimeType.PLAIN_TEXT);
      fotoG_(f,txt,agora);   // v195: foto datada a cada 2 horas, só se algo mudou
      limpaG_(f);return resp_({ok:true,ts:agora,dados:cur});
    }
    if(b.t==='reat_idx'){      // gestor informa quais clientes estão em acompanhamento (para o aviso por e-mail)
      if(b.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
      grava_(f,'reat_idx.json',JSON.stringify({ts:agora,lista:b.lista||[]}));return resp_({ok:true,ts:agora});
    }
    if(b.t==='tarefas'){      // gestor -> interna
      if(b.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
      const c=String(parseInt(b.rep,10));if(!/^\d+$/.test(c))return resp_({ok:false,erro:'rep'});
      grava_(f,'tarefas_'+c+'.json',JSON.stringify({ts:agora,dados:b.dados||[]}));return resp_({ok:true,ts:agora});
    }
    if(b.t==='retorno_get'){  // gestor le o que as internas fizeram
      if(b.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
      const out={},it=f.searchFiles('title contains "retorno_"');
      while(it.hasNext()){const a=it.next(),m=/^retorno_(\d+)\.json$/.exec(a.getName());if(m){try{out[m[1]]=JSON.parse(a.getBlob().getDataAsString())}catch(x){}}}
      return resp_({ok:true,ts:agora,retornos:out});
    }
    if(b.t==='equipe_ger'){    // gestor troca o cadastro da equipe de um representante
      if(b.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
      const tm=String(parseInt(b.team,10));if(!/^\d+$/.test(tm))return resp_({ok:false,erro:'team'});
      return resp_({ok:true,ts:agora,dados:eqSync_(f,tm,b.dados)});
    }
    if(b.t==='obj_set'){      // gestor envia os objetivos liberados (por representante) e os ajustes por cliente
      if(b.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
      const d=b.dados||{};grava_(f,'objetivos.json',JSON.stringify({ts:agora,reps:d.reps||{},cli:d.cli||{}}));return resp_({ok:true,ts:agora});
    }
    if(b.t==='marcar'){       // gestor ou retaguarda marca pedido como impresso / digitado (com nº do ERP e aviso por e-mail)
      if(!okRet_(b.k))return resp_({ok:false,erro:'chave'});
      const p=pastaPed_(),l=lerIdx_(p);let av=null,achou=false;
      for(let i=0;i<l.length;i++)if(l[i].key===b.key){
        achou=true;
        if(b.campo==='impresso')l[i].impresso=b.valor?new Date().toISOString():null;
        else if(b.campo==='digitado'){
          if(b.valor){l[i].digitado=new Date().toISOString();l[i].erp=String(b.erp||'').slice(0,30);l[i].por=String(b.por||'').slice(0,40);l[i].aviso=null;
            const ec=String(b.emCli||'').trim().toLowerCase();l[i].emCli=mailOk_(ec)?ec:'';
            const er=String(b.emRep||'').trim().toLowerCase();if(mailOk_(er)){const cm=emails_(f);cm[String(l[i].rep)]=er;grava_(f,'emails_reps.json',JSON.stringify(cm))}
            if(b.avisar){av=avisoDig_(l[i]);l[i].aviso=av}}
          else{l[i].digitado=null;l[i].erp='';l[i].por='';l[i].aviso=null;l[i].emCli=''}
        }else if(b.campo==='aviso'){if(l[i].digitado){const ec=String(b.emCli||'').trim().toLowerCase();if(mailOk_(ec))l[i].emCli=ec;const er=String(b.emRep||'').trim().toLowerCase();if(mailOk_(er)){const cm=emails_(f);cm[String(l[i].rep)]=er;grava_(f,'emails_reps.json',JSON.stringify(cm))}av=avisoDig_(l[i]);l[i].aviso=av}}
        break;
      }
      if(achou)grava_(p,'indice.json',JSON.stringify(l));
      return resp_({ok:achou,aviso:av});
    }
    if(b.t==='emails_set'){   // v265: e-mails dos representantes (para o aviso de pedido digitado)
      if(!okRet_(b.k))return resp_({ok:false,erro:'chave'});
      const cur=emails_(f),m=b.mapa||{};
      Object.keys(m).forEach(function(c){if(!/^\d+$/.test(c))return;const v=String(m[c]||'').trim().toLowerCase();if(!v)delete cur[c];else if(mailOk_(v))cur[c]=v});
      grava_(f,'emails_reps.json',JSON.stringify(cur));return resp_({ok:true,emails:cur});
    }
    const cod=String(parseInt(b.rep,10));
    const GT_={recado:1,visto_lista:1,gfotos:1,gfoto:1};   // pedidos que o gestor faz com a chave dele (sem representante)
    if(!(b.k===CHAVE_GESTOR&&GT_[b.t])&&(!/^\d+$/.test(cod)||b.k!==chaveRep_(cod)))return resp_({ok:false,erro:'chave'});
    if(b.t==='rsync'){        // v196: dados do representante na nuvem (celular e computador iguais)
      const c=String(parseInt(b.rep,10));if(!c||c==='NaN'||b.k!==chaveRep_(c))return resp_({ok:false,erro:'chave'});
      const nm='rep_sync_'+c+'.json',a=arq_(f,nm);let cur={ls:{},ts:{}};if(a){try{cur=JSON.parse(a.getBlob().getDataAsString())}catch(x){}}
      cur=mergeGsync_(cur,b.dados,+b.last||0);cur.visto=agora;const txt=JSON.stringify(cur);
      grava_(f,nm,txt);
      const dn='rep_sync_'+c+'_'+hoje+'.json';if(!arq_(f,dn))f.createFile(dn,txt,MimeType.PLAIN_TEXT);
      try{const lim=agora-30*864e5,it=f.searchFiles('title contains "rep_sync_'+c+'_"');while(it.hasNext()){const x=it.next();if(x.getDateCreated().getTime()<lim)x.setTrashed(true)}}catch(x){}
      return resp_({ok:true,ts:agora,dados:cur});
    }
    if(b.t==='recado'){       // v196: recado do gestor para o representante, com "li"
      const c=String(parseInt(b.rep,10));if(!c||c==='NaN')return resp_({ok:false,erro:'rep'});
      const gest=b.k===CHAVE_GESTOR;if(!gest&&b.k!==chaveRep_(c))return resp_({ok:false,erro:'chave'});
      const nm='recados_'+c+'.json';let L=lerJson_(f,nm,[]);if(!Array.isArray(L))L=[];
      if(b.acao==='enviar'){if(!gest)return resp_({ok:false,erro:'chave'});const tx=String(b.texto||'').slice(0,600).trim();if(!tx)return resp_({ok:false,erro:'vazio'});L.unshift({id:String(agora),t:agora,de:String(b.de||'Gestor').slice(0,30),texto:tx,li:0});L=L.slice(0,30);grava_(f,nm,JSON.stringify(L))}
      else if(b.acao==='li'&&!gest){const ids=b.ids||[];L.forEach(function(r){if(ids.indexOf(r.id)>=0&&!r.li)r.li=agora});grava_(f,nm,JSON.stringify(L))}
      else if(b.acao==='ler'&&!gest){const pv=lerJson_(f,'visto_'+c+'.json',{});pv.t=agora;pv.v=String(b.v||'').slice(0,12);pv.fila=+b.fila||0;pv.sync=+b.sync||0;pv.disp=String(b.disp||'').slice(0,20);grava_(f,'visto_'+c+'.json',JSON.stringify(pv))}
      return resp_({ok:true,ts:agora,lista:L});
    }
    if(b.t==='visto_lista'){  // gestor ve quando cada representante abriu a pagina pela ultima vez
      if(b.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
      const o={},it=f.searchFiles('title contains "visto_"');while(it.hasNext()){const x=it.next(),m=x.getName().match(/^visto_(\d+)\.json$/);if(m){try{o[m[1]]=JSON.parse(x.getBlob().getDataAsString())}catch(e){}}}
      const it2=f.searchFiles('title contains "rep_sync_"');while(it2.hasNext()){const x=it2.next(),m=x.getName().match(/^rep_sync_(\d+)\.json$/);if(m){o[m[1]]=o[m[1]]||{};o[m[1]].nuvem=x.getLastUpdated().getTime()}}
      return resp_({ok:true,visto:o,agora:agora});
    }
    if(b.t==='gfotos'||b.t==='gfoto'){   // v196: tela Restaurar do gestor (fotos datadas e cópias diárias)
      if(b.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
      if(b.t==='gfoto'){try{const x=DriveApp.getFileById(String(b.id));if(!/^gestor_(foto|sync)_/.test(x.getName()))return resp_({ok:false,erro:'nome'});return resp_({ok:true,nome:x.getName(),dados:JSON.parse(x.getBlob().getDataAsString())})}catch(x){return resp_({ok:false,erro:String(x)})}}
      const out=[],it=f.searchFiles('title contains "gestor_foto_" or title contains "gestor_sync_20"');
      while(it.hasNext()){const x=it.next();out.push({id:x.getId(),nome:x.getName(),t:x.getDateCreated().getTime(),tam:x.getSize()})}
      out.sort(function(p,q){return q.t-p.t});return resp_({ok:true,lista:out.slice(0,60)});
    }
    if(b.t==='ped'){          // representante envia pedido (ou nova versão dele)
      const p=pastaPed_(),d=b.dados||{},chave=cod+'-'+b.id,l=lerIdx_(p);
      let i=-1;for(let j=0;j<l.length;j++)if(l[j].key===chave){i=j;break}
      const ant=i>=0?l[i]:null;
      if(ant&&(+ant.ver||0)>=(+b.ver||0))return resp_({ok:true,repetido:true});
      const nome=limpaNome_(b.repNome).slice(0,18)+'_'+limpaNome_(b.num)+'_'+limpaNome_(b.cliNome)+(b.rev?'_rev'+b.rev:'');
      const pdf=p.createFile(Utilities.newBlob(Utilities.base64Decode(b.pdf),'application/pdf',nome+'.pdf'));
      const js=p.createFile(nome+'.metalmig.txt',JSON.stringify({metalmig:1,tipo:'pedidos',rep:+cod,repNome:b.repNome,mes:b.mes,gerado:b.gerado,pedidos:[d]}),MimeType.PLAIN_TEXT);
      if(ant){try{DriveApp.getFileById(ant.pdfId).setTrashed(true);DriveApp.getFileById(ant.jsonId).setTrashed(true)}catch(x){}}
      const reg={key:chave,ver:+b.ver||0,rep:+cod,repNome:b.repNome,id:b.id,num:b.num,rev:b.rev||0,data:b.data,hora:b.hora,cli:d.cli,cliNome:b.cliNome,cid:d.cid||'',geral:d.geral,liq:d.liq,pecas:d.pecas,fat:d.fat,cob:d.cob,frete:d.frete,obs:d.obs,vend:d.vend||'',vendNome:d.vendNome||'',itens:d.itens||[],recebido:new Date().toISOString(),pdfId:pdf.getId(),jsonId:js.getId(),impresso:null,digitado:null,revisado:!!ant};
      if(i>=0)l[i]=reg;else l.unshift(reg);
      grava_(p,'indice.json',JSON.stringify(l));
      try{avisoReat_(d,b,ant)}catch(x){}
      return resp_({ok:true,key:chave});
    }
    if(b.t==='ped_st'){       // v265: representante vê quais pedidos dele já foram digitados na Metalmig
      const st={};lerIdx_(pastaPed_()).forEach(function(r){if(String(r.rep)===cod&&r.digitado)st[r.id]={erp:r.erp||'',dig:r.digitado,por:r.por||''}});
      return resp_({ok:true,st:st});
    }
    if(b.t==='obj_get'){      // representante recebe só o que é dele
      const o=lerJson_(f,'objetivos.json',{ts:0,reps:{},cli:{}});return resp_({ok:true,ts:agora,dados:{ts:o.ts||0,reps:(o.reps||{})[cod]||{},cli:(o.cli||{})[cod]||{}}});
    }
    if(b.t==='equipe'){return resp_({ok:true,ts:agora,dados:eqSync_(f,cod,b.dados)})}   // gestor da equipe (ou vendedor) troca cadastro e carteira
    if(b.t==='tarefas_get'){return resp_({ok:true,ts:agora,dados:lerJson_(f,'tarefas_'+cod+'.json',{ts:0,dados:[]}).dados})}
    if(b.t==='retorno'){const cur=mergeRetorno_(lerJson_(f,'retorno_'+cod+'.json',{}),b.dados);grava_(f,'retorno_'+cod+'.json',JSON.stringify(cur));return resp_({ok:true,ts:agora,dados:cur})}
    const txt=JSON.stringify({rep:cod,nome:String(b.nome||''),ts:agora,tipo:b.t,dados:b.dados});
    if(b.t==='backup'){
      grava_(f,'backup_'+cod+'.json',txt);
      const dn='backup_'+cod+'_'+hoje+'.json';if(!arq_(f,dn))f.createFile(dn,txt,MimeType.PLAIN_TEXT);
      limpa_(f,cod);
    }else if(b.t==='pacote'){grava_(f,'pacote_'+cod+'.json',txt)}
    else return resp_({ok:false,erro:'tipo'});
    return resp_({ok:true,ts:agora});
  }catch(err){return resp_({ok:false,erro:String(err)})}
  finally{lock.releaseLock()}
}

function doGet(e){
  const p=e.parameter||{},f=pasta_();
  if(p.t==='backup'){          // restaurar o backup de um representante
    const cod=parseInt(p.rep,10);
    if(!(p.k===CHAVE_GESTOR||p.k===chaveRep_(cod)))return resp_({ok:false,erro:'chave'});
    const a=arq_(f,'backup_'+cod+'.json');
    return resp_({ok:true,backup:a?JSON.parse(a.getBlob().getDataAsString()):null});
  }
  if(p.a==='emails'){if(!okRet_(p.k))return resp_({ok:false,erro:'chave'});return resp_({ok:true,emails:emails_(f)})}
  if(p.a==='lista'||p.a==='pdf'||p.a==='ping'){
    if(!okRet_(p.k))return resp_({ok:false,erro:'chave'});
    const pp=pastaPed_();
    if(p.a==='lista')return resp_({ok:true,lista:lerIdx_(pp),agora:Date.now()});
    if(p.a==='ping')return resp_({ok:true,pasta:pp.getUrl()});
    try{const ff=DriveApp.getFileById(p.id);return resp_({ok:true,b64:Utilities.base64Encode(ff.getBlob().getBytes()),nome:ff.getName()})}catch(x){return resp_({ok:false,erro:String(x)})}
  }
  if(p.k!==CHAVE_GESTOR)return resp_({ok:false,erro:'chave'});
  const since=+p.since||0,out=[],it=f.searchFiles('title contains "pacote_"');
  while(it.hasNext()){const a=it.next();try{const o=JSON.parse(a.getBlob().getDataAsString());if(o.ts>since)out.push(o)}catch(x){}}
  return resp_({ok:true,agora:Date.now(),pacotes:out});
}

/** Rode esta função uma vez (▶ Executar) para o Google pedir as permissões e criar as pastas. */
function autorizar(){const a=pasta_(),b=pastaPed_();Logger.log('Planilha de candidatos: '+SpreadsheetApp.openById(CAND_ID).getName());Logger.log('Pastas prontas: '+a.getUrl()+' | '+b.getUrl()+' | e-mails disponíveis hoje: '+MailApp.getRemainingDailyQuota())}

/** v196 · Backup semanal por e-mail: manda a cópia dos dados do gestor para o seu Gmail (domingo, 7h). Rode instalarGatilhoSemanal() uma vez. */
function backupSemanal(){
  const f=pasta_(),a=arq_(f,'gestor_sync.json');if(!a)return;
  const hoje=Utilities.formatDate(new Date(),'America/Sao_Paulo','yyyy-MM-dd');
  MailApp.sendEmail({to:Session.getEffectiveUser().getEmail(),subject:'Backup semanal Metalmig · '+hoje,
    body:'Segue anexa a cópia dos dados do seu painel (visitas, recrutamento, representantes, etc.). Guarde este e-mail: se algum dia precisar, o arquivo pode ser devolvido ao painel pela tela Restaurar.\n\nMetalmig · Caixa automática',
    attachments:[Utilities.newBlob(a.getBlob().getDataAsString(),'application/json','gestor_sync_'+hoje+'.json')]});
}
function instalarGatilhoSemanal(){
  ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='backupSemanal')ScriptApp.deleteTrigger(t)});
  ScriptApp.newTrigger('backupSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).create();
  Logger.log('Backup semanal ligado: todo domingo por volta das 7h.');
}
