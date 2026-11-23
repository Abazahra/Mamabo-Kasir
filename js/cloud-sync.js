import {all,put,remove,uid,applyCloudRows} from './db.js?v=sync-pull-1';
let client=null,storeId=null,session=null,busy=false,clientConfigKey=null,authSubscription=null,syncStarted=false;
function notifyQueue(){all('syncQueue').then(rows=>window.dispatchEvent(new CustomEvent('mambo-sync-update',{detail:{pending:rows.length}}))).catch(()=>{});}
const $=s=>document.querySelector(s);
const ENTITIES=new Set(['products','suppliers','movements','transactions','shifts','auditLogs','categories','customers','opnames','settings','receivables','promos','returns','purchases','payables','supplierPayments']);
function status(s){const el=document.querySelector('#syncStatus');if(el){el.dataset.state=s;el.textContent=s==='syncing'?'Menyinkronkan':s==='online'?'Online':'Offline';}}
export function getCloudConfig(){return JSON.parse(localStorage.getItem('mambo_cloud_config')||'{}');}
export async function configureCloud(url,key,store=''){if(!url||!key)throw Error('URL dan publishable/anon key wajib diisi.');const configKey=url.trim()+'|'+key.trim();storeId=String(store||'').trim()||null;if(!client||clientConfigKey!==configKey){if(client&&authSubscription)authSubscription.unsubscribe();const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2');client=createClient(url.trim(),key.trim(),{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});clientConfigKey=configKey;const {data:{subscription}}=client.auth.onAuthStateChange((_event,nextSession)=>{session=nextSession;if(session)Promise.resolve().then(()=>syncNow());});authSubscription=subscription;}localStorage.setItem('mambo_cloud_config',JSON.stringify({url:url.trim(),key:key.trim(),storeId:storeId||''}));const {data,error}=await client.auth.getSession();if(error)throw error;session=data.session;status(navigator.onLine?'online':'offline');return !!session;}
async function ensureClient(){if(client&&storeId)return;const c=getCloudConfig();if(!c.url||!c.key||!c.storeId)return;await configureCloud(c.url,c.key,c.storeId);}
export async function cloudSignIn(email,password,storeName='MAMBO KASIR'){await ensureClient();if(!client)throw Error('Konfigurasi Supabase belum diisi.');const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;session=data.session;if(!storeId){const boot=await client.rpc('mambo_owner_bootstrap',{p_store_name:storeName});if(boot.error)throw boot.error;storeId=boot.data?.store_id||null;if(!storeId)throw Error('Supabase tidak mengembalikan Store ID.');const cfg=getCloudConfig();cfg.storeId=storeId;localStorage.setItem('mambo_cloud_config',JSON.stringify(cfg));}await syncNow();return data.user;}
export async function cloudRegisterOwner(url,key,email,password,storeName){await configureCloud(url,key,'');if(!client)throw Error('Konfigurasi Supabase belum diisi.');const {data,error}=await client.auth.signUp({email,password});if(error)throw error;session=data.session||null;if(!session){localStorage.setItem('mambo_cloud_config',JSON.stringify({url:url.trim(),key:key.trim(),storeId:''}));return {needsConfirmation:true};}const boot=await client.rpc('mambo_owner_bootstrap',{p_store_name:storeName});if(boot.error)throw boot.error;storeId=boot.data?.store_id||null;if(!storeId)throw Error('Supabase tidak mengembalikan Store ID.');const cfg=getCloudConfig();cfg.storeId=storeId;localStorage.setItem('mambo_cloud_config',JSON.stringify(cfg));await syncNow();return {needsConfirmation:false,storeId};}
export async function cloudSignOut(){if(client)await client.auth.signOut();session=null;status(navigator.onLine?'online':'offline');}
export async function syncNow(){if(busy||!navigator.onLine)return;if(!client||!session||!storeId){status(navigator.onLine?'online':'offline');const el=document.querySelector('#syncStatus');if(el&&navigator.onLine)el.title='Internet tersedia; konfigurasi/login Supabase belum aktif.';return;}busy=true;status('syncing');try{const queue=(await all('syncQueue')).sort((a,b)=>a.createdAt-b.createdAt);for(const item of queue){if(!ENTITIES.has(item.entity)){await remove('syncQueue',item.id);continue;}const row={store_id:storeId,entity:item.entity,record_id:String(item.recordId),payload:item.payload||{},deleted:item.operation==='delete',updated_at:new Date().toISOString()};const {error}=await client.from('mambo_sync_records').upsert(row,{onConflict:'store_id,entity,record_id'});if(error)throw error;await remove('syncQueue',item.id);notifyQueue();}let page=0,allRows=[];while(true){const {data,error}=await client.from('mambo_sync_records').select('entity,record_id,payload,deleted').eq('store_id',storeId).range(page*500,page*500+499);if(error)throw error;allRows=allRows.concat(data||[]);if(!data||data.length<500)break;page++;}const result=await applyCloudRows(allRows);status('online');notifyQueue();window.dispatchEvent(new CustomEvent('mambo-cloud-pulled',{detail:result}));}catch(e){console.warn('Supabase sync:',e.message);status('offline');}finally{busy=false;}}
export async function startCloudSync(){if(syncStarted)return;syncStarted=true;try{await ensureClient();}catch(e){console.warn(e);}const tick=()=>{if(navigator.onLine)syncNow();else status('offline');};window.addEventListener('online',tick);window.addEventListener('offline',()=>status('offline'));document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});if(navigator.onLine)tick();else status('offline');setInterval(tick,20000);}
export async function cloudStatus(){await ensureClient();return {configured:!!client,authenticated:!!session,storeId};}
export async function pendingSyncCount(){return (await all('syncQueue')).length;}
export async function cloudPull(){await ensureClient();if(!client||!session)throw Error('Login cloud diperlukan.');const {data,error}=await client.from('mambo_sync_records').select('entity,record_id,payload,deleted').eq('store_id',storeId);if(error)throw error;return data||[];}


// Publikasi katalog hanya mengirim kolom aman; data HPP, stok, transaksi, dan payload internal tidak pernah dikirim.
export async function publishPublicCatalog(products,categories,settings,mode='selected'){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Supabase sebagai pemilik toko diperlukan untuk menerbitkan katalog.');
 const visible=products.filter(p=>mode==='all'||(mode==='selected'&&p.publicVisible===true));
 const categoryName=id=>categories.find(c=>c.id===id)?.name||'Lainnya';
 const rows=[];
 for(const p of visible){
  let image_url=null;
  if(p.photo){
   const ext=String(p.photoType||'image/jpeg').split('/')[1]?.replace(/[^a-z0-9]/gi,'')||'jpg';
   const path=storeId+'/'+p.id+'.'+ext;
   const {error:uploadError}=await client.storage.from('mambo-product-images').upload(path,new Blob([p.photo],{type:p.photoType||'image/jpeg'}),{upsert:true,contentType:p.photoType||'image/jpeg',cacheControl:'3600'});
   if(uploadError)throw uploadError;
   image_url=client.storage.from('mambo-product-images').getPublicUrl(path).data.publicUrl;
  }
  rows.push({store_id:storeId,product_id:String(p.id),sku:String(p.sku||''),name:String(p.name||''),category_name:categoryName(p.categoryId),price:Number(p.price||0),image_url,updated_at:new Date().toISOString()});
 }
 const {error:settingsError}=await client.from('mambo_public_catalog_settings').upsert({store_id:storeId,store_name:String(settings.storeName||'MAMBO KASIR'),whatsapp:String(settings.catalogWhatsapp||settings.phone||''),tagline:String(settings.catalogTagline||'Pesan produk favorit Anda')},{onConflict:'store_id'});
 if(settingsError)throw settingsError;
 if(rows.length){const {error}=await client.from('mambo_public_catalog_products').upsert(rows,{onConflict:'store_id,product_id'});if(error)throw error;const keep=rows.map(x=>x.product_id);const {error:deleteError}=await client.from('mambo_public_catalog_products').delete().eq('store_id',storeId).not('product_id','in','('+keep.join(',')+')');if(deleteError)throw deleteError;}else{const {error:deleteError}=await client.from('mambo_public_catalog_products').delete().eq('store_id',storeId);if(deleteError)throw deleteError;}
 return {published:rows.length};
}

export async function createCashierPairCode(label='Perangkat Kasir'){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan terlebih dahulu.');
 const {data,error}=await client.rpc('mambo_owner_create_pair_code',{p_store_id:storeId,p_label:label});
 if(error)throw error;
 return String(data||'');
}


// Pengelolaan akun karyawan: seluruh operasi divalidasi RPC di sisi database.
async function requireOwnerCloud(){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan. Buka Pengaturan > Integrasi Supabase Cloud.');
 return {client,storeId};
}
export async function staffAccountList(){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_list',{p_store_id:storeId});if(error)throw error;return Array.isArray(data)?data:[];}
export async function staffAccountCreate(username,name,role,pin){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_create',{p_store_id:storeId,p_username:username,p_display_name:name,p_app_role:role,p_pin:pin});if(error)throw error;return data;}
export async function staffAccountUpdate(id,username,name,role,active){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_update',{p_store_id:storeId,p_staff_id:id,p_username:username,p_display_name:name,p_app_role:role,p_active:active});if(error)throw error;return data;}
export async function staffAccountResetPin(id,pin){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_reset_pin',{p_store_id:storeId,p_staff_id:id,p_pin:pin});if(error)throw error;return data;}
