import {all,put,atomic,uid} from './db.js?v=operational-normalization-2';
import {sharedDrawerSnapshot as deviceDrawerSnapshot,appendSharedDrawerEvent,resolveSharedDrawerEvent,flushPendingSharedDrawerEvents,supervisorSharedDrawerControl,syncSharedDrawerSourceRecord} from './device-pairing.js?v=shared-drawer-9';
import {cloudStatus,sharedDrawerSnapshot as ownerDrawerSnapshot,openSharedDrawer,closeSharedDrawer,appendOwnerDrawerEvent,resolveOwnerDrawerEvent,flushPendingOwnerDrawerEvents,reviewSharedDrawerPendingEvents,syncOwnerSharedDrawerSourceRecord} from './cloud-sync.js?v=photo-version-3';
const $=s=>document.querySelector(s), rp=n=>'Rp '+Math.round(n||0).toLocaleString('id-ID'), now=()=>new Date().toLocaleString('id-ID',{timeZone:'Asia/Jakarta'});
let cart=[],disc=0,discType='rp',tax=false,round=0,customerId='';
const photoCache=new Map();
function productPhoto(p){if(p?.photoUrl)return p.photoUrl;if(!p?.photo)return '';if(typeof p.photo==='string')return p.photo;const key=p.id+':'+(p.updatedAt||'');if(!photoCache.has(key))photoCache.set(key,URL.createObjectURL(new Blob([p.photo],{type:p.photoType||'image/jpeg'})));return photoCache.get(key);}
const toast=s=>{const t=$('#toast');t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)};
const totals=()=>{const sub=cart.reduce((a,x)=>a+x.price*x.qty,0),d=discType==='pct'?sub*disc/100:disc,net=Math.max(0,sub-d),vat=tax?net*.11:0,raw=net+vat;return{sub,d,vat,total:round?Math.ceil(raw/round)*round:Math.round(raw)}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deviceContext=()=>{try{return JSON.parse(localStorage.getItem('mambo_paired_device')||'null');}catch{return null;}};
const currentDeviceId=()=>deviceContext()?.deviceId||null;
const shiftForUser=(rows,user)=>{const id=currentDeviceId();return rows.find(s=>s.userId===user.id&&s.status==='open'&&(id?s.deviceId===id:!s.deviceId));};
export async function mountPOS(root,user){
 let ps=await all('products'),cats=await all('categories'),cs=await all('customers'),shifts=await all('shifts'),shift=shiftForUser(shifts,user);const pairedDevice=!!currentDeviceId();let ownerSharedDrawer=false,ownerCloudActive=false,shiftCheckError='';if(pairedDevice){if(!navigator.onLine){shift=null;shiftCheckError='Perangkat sedang offline. Status laci bersama belum dapat diperiksa.';}else{try{await flushPendingSharedDrawerEvents();if(JSON.parse(localStorage.getItem('mambo_pending_drawer_events')||'[]').length)throw Error('Ada pergerakan kas yang belum tersinkron. Buka menu Shift & Laci Kas untuk memeriksa.');const shared=await deviceDrawerSnapshot();shift=shared?.open?{id:shared.drawer_id,shared:true}:null;}catch(e){shift=null;shiftCheckError=e?.message||'Sesi Kasir tidak aktif atau status laci gagal diperiksa.';}}}else if(user.role==='owner'&&navigator.onLine){try{const cloud=await cloudStatus();if(cloud.authenticated&&cloud.storeId){ownerCloudActive=true;const pendingResult=await flushPendingOwnerDrawerEvents();if(pendingResult.pending)throw Error('Ada pergerakan kas Owner yang belum tersinkron.');const shared=await ownerDrawerSnapshot();if(shared?.open){shift={id:shared.drawer_id,shared:true};ownerSharedDrawer=true;}else shift=null;}}catch(e){if(ownerCloudActive)shift=null;shiftCheckError=e?.message||'Status laci bersama gagal diperiksa.';}}
 root.innerHTML=`<div class="pos-head"><div><h1>Mesin Kasir</h1><p class="sub">Scan barcode atau cari produk, lalu masukkan ke keranjang</p></div><div class="actions"><button class="secondary" id="hold">F2 · Tahan</button><button class="secondary" id="recall">F4 · Panggil</button></div></div>${shift?'':`<div class="notice">${shiftCheckError?'Status laci bersama belum dapat diverifikasi. Jangan lanjutkan transaksi. Detail: '+esc(shiftCheckError):'Shift/laci kas belum dibuka. Buka menu Shift & Laci Kas terlebih dahulu.'}</div>`}<div class="pos-layout"><section class="panel pos-left"><div class="toolbar"><input id="scan" placeholder="Scan barcode / cari SKU / nama lalu Enter"><select id="cat"><option value="">Semua kategori</option>${cats.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div id="catalog" class="pos-products"></div><h3>Keranjang</h3><div id="cart"></div></section><aside class="panel pos-right"><h3>Ringkasan Belanja</h3><label>Pelanggan</label><select id="customer"><option value="">Pelanggan Umum</option>${cs.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><div class="field"><label>Diskon total</label><div class="toolbar"><input id="discount" type="number" min="0" value="0"><select id="discountType"><option value="rp">Rp</option><option value="pct">%</option></select></div></div><label><input type="checkbox" id="tax"> PPN 11%</label><label>Pembulatan</label><select id="round"><option value="0">Tidak ada</option><option value="100">Rp 100</option><option value="500">Rp 500</option></select><div id="totals"></div><div class="grand-total" id="grand"></div><button class="primary full" id="pay">F12 · BAYAR</button></aside></div>`;
 const draw=()=>{const q=$('#scan').value.toLowerCase(),c=$('#cat').value;$('#catalog').innerHTML=ps.filter(p=>!p.hiddenFromPOS&&(!c||p.categoryId===c)&&[p.name,p.sku,p.barcode].join(' ').toLowerCase().includes(q)).map(p=>`<button class="pos-product" data-p="${p.id}">${p.photo?`<img class="pos-product-photo" src="${productPhoto(p)}" alt="${esc(p.name)}">`:'<span class="pos-product-photo-placeholder">Foto belum tersedia</span>'}<b>${esc(p.name)}</b><small>${esc(p.sku)} · Stok ${p.stock}</small><strong>${rp(p.price)}</strong></button>`).join('')||'<div class="empty">Produk tidak ditemukan</div>';};
 const drawCart=()=>{const t=totals();$('#cart').innerHTML=cart.map((x,i)=>`<div class="cart-row"><div><b>${esc(x.name)}</b><small>${rp(x.price)} × ${x.qty}</small></div><div><button data-minus="${i}">−</button> ${x.qty} <button data-plus="${i}">+</button> <button data-remove="${i}">×</button></div></div>`).join('')||'<div class="empty">Keranjang kosong</div>';$('#totals').innerHTML=`<p>Subtotal <b>${rp(t.sub)}</b></p><p>Diskon <b>− ${rp(t.d)}</b></p><p>PPN <b>${rp(t.vat)}</b></p>`;$('#grand').textContent=rp(t.total);};
 const add=p=>{if(p.bundle?.length){for(const b of p.bundle){const child=ps.find(x=>x.id===b.productId);if(!child){toast('Komponen paket tidak ditemukan');return;}add({...child,qty:b.qty});}return;}let x=cart.find(x=>x.id===p.id);if(x)x.qty++;else cart.push({id:p.id,name:p.name,sku:p.sku,price:Number(p.price),cost:Number(p.cost||0),qty:1});drawCart();};
 $('#scan').onkeydown=e=>{if(e.key!=='Enter')return;e.preventDefault();const q=e.target.value.trim().toLowerCase(),visible=ps.filter(x=>!x.hiddenFromPOS),p=visible.find(x=>x.barcode===q||x.sku.toLowerCase()===q)||visible.find(x=>x.name.toLowerCase().includes(q));if(p){add(p);e.target.value='';draw();}else toast('Produk tidak ditemukan');};$('#scan').oninput=draw;$('#cat').onchange=draw;$('#catalog').onclick=e=>{const b=e.target.closest('[data-p]');if(b)add(ps.find(p=>p.id===b.dataset.p));};
 $('#cart').onclick=e=>{const b=e.target.closest('button');if(!b)return;const i=Number(b.dataset.plus??b.dataset.minus??b.dataset.remove);if(b.dataset.plus!==undefined)cart[i].qty++;if(b.dataset.minus!==undefined)cart[i].qty=Math.max(1,cart[i].qty-1);if(b.dataset.remove!==undefined)cart.splice(i,1);drawCart();};
 $('#customer').onchange=e=>customerId=e.target.value;$('#discount').oninput=e=>{disc=Math.max(0,Number(e.target.value));drawCart()};$('#discountType').onchange=e=>{discType=e.target.value;drawCart()};$('#tax').onchange=e=>{tax=e.target.checked;drawCart()};$('#round').onchange=e=>{round=Number(e.target.value);drawCart()};
 $('#hold').onclick=async()=>{if(!cart.length)return toast('Keranjang kosong');const h=await all('heldCarts');if(h.length>=10)return toast('Maksimal 10 transaksi tertahan');await put('heldCarts',{id:uid(),label:'Antrean '+now(),cart,customerId,disc,discType,tax,round});cart=[];drawCart();toast('Transaksi ditahan');};
 $('#recall').onclick=async()=>{const h=await all('heldCarts');if(!h.length)return toast('Tidak ada antrean');const n=Number(prompt(h.map((x,i)=>(i+1)+'. '+x.label).join('\n')+'\nPilih nomor'));const item=h[n-1];if(!item)return;cart=item.cart;customerId=item.customerId;disc=item.disc;discType=item.discType;tax=item.tax;round=item.round;await atomic(['heldCarts'],s=>s.heldCarts.delete(item.id));drawCart();toast('Transaksi dipanggil');};
 $('#pay').onclick=async()=>{if(!cart.length)return toast('Keranjang kosong');if(!shift)return toast('Laci kas bersama belum dibuka oleh Owner atau belum dapat diverifikasi.');if(pairedDevice&&!navigator.onLine)return toast('Penjualan HP kasir memerlukan koneksi untuk mencatat laci kas bersama.');const t=totals(),dlg=document.createElement('div');dlg.className='modal-backdrop';dlg.innerHTML=`<section class="modal"><h2>Pembayaran · ${rp(t.total)}</h2><div class="field"><label>Metode pembayaran</label><select id="method"><option>Tunai</option><option>QRIS</option><option>Transfer Bank</option><option>Kartu Debit/Kredit</option><option>Kasbon</option><option>Split Payment</option></select></div><div class="field"><label>Nominal dibayar</label><input id="amount" type="number" min="0" value="${t.total}"></div><div class="actions" id="cashQuick">${[10000,20000,50000,100000].map(n=>`<button class="secondary" data-cash="${n}">${rp(n)}</button>`).join('')}</div><div class="field"><label>Referensi / 4 digit kartu</label><input id="ref" maxlength="40"></div><div id="split" class="hidden"><input id="split2" type="number" placeholder="Nominal metode kedua"><select id="method2"><option>QRIS</option><option>Transfer Bank</option><option>Tunai</option></select><input id="split3" type="number" placeholder="Nominal metode ketiga"><select id="method3"><option>Transfer Bank</option><option>QRIS</option><option>Tunai</option></select></div><p id="change">Kembalian: Rp 0</p><p id="payError" class="error"></p><div class="modal-actions"><button class="secondary" id="cancel">Batal</button><button class="primary" id="confirm">Selesaikan</button></div></section>`;document.body.append(dlg);
 const amount=dlg.querySelector('#amount'),method=dlg.querySelector('#method');const calc=()=>dlg.querySelector('#change').textContent='Kembalian: '+rp(Math.max(0,Number(amount.value)-t.total));amount.oninput=calc;dlg.querySelector('#cashQuick').onclick=e=>{const b=e.target.closest('[data-cash]');if(b){amount.value=b.dataset.cash;calc()}};method.onchange=()=>dlg.querySelector('#split').classList.toggle('hidden',method.value!=='Split Payment');dlg.querySelector('#cancel').onclick=()=>dlg.remove();
 dlg.querySelector('#confirm').onclick=async()=>{try{let pays=[],m=method.value;if(m==='Split Payment'){pays=[{method:'Tunai',amount:Number(amount.value)},{method:dlg.querySelector('#method2').value,amount:Number(dlg.querySelector('#split2').value||0)}];if(Number(dlg.querySelector('#split3').value)>0)pays.push({method:dlg.querySelector('#method3').value,amount:Number(dlg.querySelector('#split3').value)});if(pays.reduce((a,x)=>a+x.amount,0)<t.total)throw Error('Nominal split kurang');}else if(m==='Kasbon'){const c=cs.find(x=>x.id===customerId);if(!c)throw Error('Pilih pelanggan untuk kasbon');const ar=await all('receivables'),balance=ar.filter(x=>x.customerId===c.id&&x.status!=='paid').reduce((a,x)=>a+x.balance,0);if(!c.creditLimit||balance+t.total>c.creditLimit)throw Error('Limit kasbon tidak cukup atau belum diatur');pays=[{method:m,amount:t.total}];}else{if(Number(amount.value)<t.total)throw Error('Pembayaran kurang');pays=[{method:m,amount:Number(amount.value),reference:dlg.querySelector('#ref').value}];}
 const customer=cs.find(x=>x.id===customerId),id=uid(),receipt='MB-'+Date.now(),stamp=now(),deviceId=currentDeviceId(),latestProducts=await all('products'),latestById=new Map(latestProducts.map(p=>[String(p.id),p])),items=cart.map(x=>{const current=latestById.get(String(x.id));return{...x,cost:Number(current?.cost??x.cost??0)};});const cashDrawerAmount=pays.filter(x=>String(x.method||'').toLowerCase()==='tunai').reduce((sum,x)=>sum+Number(x.amount||0),0),sharedCash=(pairedDevice||ownerSharedDrawer)&&cashDrawerAmount>0;
 let drawerEvent=null,drawerKey=null,drawerResolved=false;
 if(sharedCash){
  if(!navigator.onLine)throw Error('Transaksi tunai laci bersama memerlukan koneksi internet.');
  drawerEvent={eventId:id,type:'cash_sale',amount:Math.min(t.total,cashDrawerAmount),sourceRecordId:id,note:'Penjualan '+receipt};
  drawerKey=pairedDevice?'mambo_pending_drawer_events':'mambo_pending_owner_drawer_events';
  const pending=JSON.parse(localStorage.getItem(drawerKey)||'[]');
  if(pending.length)throw Error('Masih ada pergerakan kas yang belum tersinkron. Selesaikan terlebih dahulu.');
  pending.push(drawerEvent);localStorage.setItem(drawerKey,JSON.stringify(pending));
  try{if(pairedDevice)await appendSharedDrawerEvent(drawerEvent);else await appendOwnerDrawerEvent(drawerEvent,user.name);}
  catch(drawerError){/* Keep the durable event intent: a network error may occur after the server committed it. Reconciliation will retry idempotently. */throw Error('Pencatatan kas belum dapat dipastikan. Transaksi belum disimpan; periksa koneksi dan sinkronisasi laci. '+(drawerError.message||drawerError));}
 }
 try{
 await atomic(['products','transactions','movements','shifts','receivables'],stores=>{const reqs=items.map(item=>{const r=stores.products.get(item.id);r.onsuccess=()=>{const p=r.result;if(!p||p.stock<item.qty){try{stores.products.transaction.abort()}catch{}return;}p.stock-=item.qty;stores.products.put(p);stores.movements.put({id:uid(),productId:p.id,productName:p.name,type:'penjualan',delta:-item.qty,note:'Struk '+receipt,time:stamp});};});stores.transactions.put({id,receipt,userId:user.id,userName:user.name,deviceId,deviceLabel:deviceContext()?.label||null,shiftId:shift.id,sharedDrawer:!!shift.shared,customerId:customer?.id||null,customerName:customer?.name||'Pelanggan Umum',items,total:t.total,subtotal:t.sub,discount:t.d,tax:t.vat,payments:pays,time:stamp,status:'paid'});const sr=stores.shifts.get(shift.id);sr.onsuccess=()=>{const s=sr.result;if(s){s.sales=(s.sales||0)+t.total;s.cashSales=(s.cashSales||0)+Math.min(t.total,pays.filter(x=>x.method==='Tunai').reduce((a,x)=>a+x.amount,0));stores.shifts.put(s)}};if(m==='Kasbon')stores.receivables.put({id:uid(),transactionId:id,customerId:customer.id,customerName:customer.name,amount:t.total,balance:t.total,status:'open',time:stamp});});
  if(sharedCash){try{
   const savedTransaction=(await all('transactions')).find(row=>String(row.id)===String(id));
   if(!savedTransaction)throw Error('Transaksi lokal belum ditemukan untuk rekonsiliasi laci.');
   if(pairedDevice)await syncSharedDrawerSourceRecord('transactions',savedTransaction);
   else await syncOwnerSharedDrawerSourceRecord('transactions',savedTransaction);
   if(pairedDevice)await resolveSharedDrawerEvent(id,'confirmed');else await resolveOwnerDrawerEvent(id,'confirmed');
   drawerResolved=true;
  }catch(resolveError){/* Keep local queue and pending ledger event; reconciliation retries. */}}
 }catch(localError){
  if(sharedCash){try{if(pairedDevice)await resolveSharedDrawerEvent(id,'reversed');else await resolveOwnerDrawerEvent(id,'reversed');}catch(resolveError){/* Pending server event blocks drawer close. */}}
  throw localError;
 }
 if(sharedCash&&drawerResolved)localStorage.setItem(drawerKey,JSON.stringify(JSON.parse(localStorage.getItem(drawerKey)||'[]').filter(x=>x.eventId!==id)));
 dlg.remove();cart=[];toast('Transaksi tersimpan');mountPOS(root,user);
 const receiptData={receipt,items,total:t.total,subtotal:t.sub,discount:t.d,tax:t.vat,payments:pays,customer:customer?.name||'Pelanggan Umum',cashier:user.name,stamp};
 const done=document.createElement('div');done.className='modal-backdrop';done.innerHTML=`<section class="modal"><h2>Transaksi Berhasil</h2><p>Pembayaran ${rp(t.total)} sudah tersimpan.</p><p class="muted">Pilih tindakan berikut. Struk tidak dicetak otomatis.</p><div class="modal-actions"><button class="secondary" id="finishNoPrint">Selesai</button><button class="secondary" id="shareReceiptWA">Kirim e-Struk WA</button><button class="primary" id="printReceiptNow">Cetak / PDF</button></div></section>`;document.body.append(done);
 done.querySelector('#finishNoPrint').onclick=()=>done.remove();
 done.querySelector('#printReceiptNow').onclick=()=>{done.remove();receiptPrint(receiptData);};
 done.querySelector('#shareReceiptWA').onclick=()=>shareReceiptWhatsApp(receiptData);
 }catch(err){dlg.querySelector('#payError').textContent=err.message||'Pembayaran gagal';}};
 };
 draw();drawCart();$('#scan').focus();window.onkeydown=e=>{if(e.key==='F1'){e.preventDefault();$('#scan')?.focus()}else if(e.key==='F2'){e.preventDefault();$('#hold')?.click()}else if(e.key==='F4'){e.preventDefault();$('#recall')?.click()}else if(e.key==='F8'){e.preventDefault();$('#customer')?.focus()}else if(e.key==='F9'){e.preventDefault();$('#discount')?.focus()}else if(e.key==='F12'){e.preventDefault();$('#pay')?.click()}};
}

async function shareReceiptWhatsApp(t){
 const settings=(await all('settings'))[0]||{};
 const money=n=>rp(Number(n)||0);
 const width=900,pad=64,line=42,items=t.items||[],payments=t.payments||[];
 const ctxCanvas=document.createElement('canvas'),ctx=ctxCanvas.getContext('2d');
 const logoImage=new Image();logoImage.src=new URL('../assets/mambo-app-icon.svg?v=brand-1',import.meta.url).href;
 try{await logoImage.decode();}catch(error){console.warn('Logo struk tidak dapat dimuat:',error);}
 const wrap=(text,max,font)=>{ctx.font=font;const words=String(text??'').split(' ');const out=[];let row='';for(const word of words){const test=row?row+' '+word:word;if(ctx.measureText(test).width>max&&row){out.push(row);row=word;}else row=test;}if(row)out.push(row);return out.length?out:[''];};
 let height=pad+160+70+44+4*line+28;
 for(const item of items)height+=Math.max(2,wrap(item.name||'Produk',width-pad*2,'bold 34px Arial').length)*line+line*2+18;
 height+=line*8+payments.length*line+120;
 ctxCanvas.width=width;ctxCanvas.height=height;
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
 let y=pad;
 const center=(text,size,bold=false,color='#111827')=>{ctx.font=(bold?'bold ':'')+size+'px Arial';ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(text,width/2,y);y+=size+18;};
  const left=(text,size=30,bold=false,color='#111827')=>{ctx.font=(bold?'bold ':'')+size+'px Arial';ctx.fillStyle=color;ctx.textAlign='left';ctx.fillText(String(text??''),pad,y);y+=size+12;};
  const rule=()=>{ctx.strokeStyle='#aab2bd';ctx.setLineDash([8,7]);ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(width-pad,y);ctx.stroke();ctx.setLineDash([]);y+=24;};
  const pair=(label,value)=>{ctx.font='30px Arial';ctx.fillStyle='#475569';ctx.textAlign='left';ctx.fillText(label,pad,y);ctx.font='bold 30px Arial';ctx.fillStyle='#111827';ctx.textAlign='right';ctx.fillText(value,width-pad,y);y+=line;};
  const headerTop=y,logoSize=120,logoX=pad,brandX=pad+logoSize+28,brandWidth=width-pad-brandX;
  if(logoImage.complete&&logoImage.naturalWidth)ctx.drawImage(logoImage,logoX,headerTop,logoSize,logoSize);
  ctx.fillStyle='#111827';ctx.textAlign='left';ctx.font='bold 43px Arial';ctx.fillText(settings.storeName||'MAMBO KASIR',brandX,headerTop+42,brandWidth);
  let brandY=headerTop+72;
  if(settings.address){ctx.font='24px Arial';ctx.fillStyle='#475569';ctx.fillText(settings.address,brandX,brandY,brandWidth);brandY+=27;}
  if(settings.phone){ctx.font='24px Arial';ctx.fillStyle='#475569';ctx.fillText('Telp. '+settings.phone,brandX,brandY,brandWidth);brandY+=27;}
  ctx.font='bold 23px Arial';ctx.fillStyle='#111827';ctx.fillText('BUKTI PEMBAYARAN',brandX,brandY,brandWidth);
  y=headerTop+148;
  rule();
 pair('No. Struk',t.receipt||'-');pair('Tanggal',t.stamp||'-');if(t.cashier)pair('Kasir',t.cashier);
 rule();left('RINCIAN BELANJA',25,true);
 for(const item of items){
  const names=wrap(item.name||'Produk',width-pad*2,'bold 34px Arial');
  ctx.font='bold 34px Arial';ctx.fillStyle='#111827';ctx.textAlign='left';
  for(const name of names){ctx.fillText(name,pad,y);y+=line;}
  pair((Number(item.qty)||0)+' × '+money(item.price),money((Number(item.qty)||0)*(Number(item.price)||0)));
  y+=8;
 }
 rule();pair('Subtotal',money(t.subtotal));
 if(Number(t.discount))pair('Diskon','− '+money(t.discount));
 if(Number(t.tax))pair('Pajak',money(t.tax));
 y+=8;ctx.fillStyle='#eef2ff';ctx.fillRect(pad,y,width-pad*2,78);
 ctx.font='bold 32px Arial';ctx.fillStyle='#111827';ctx.textAlign='left';ctx.fillText('TOTAL BAYAR',pad+18,y+50);
 ctx.font='bold 40px Arial';ctx.textAlign='right';ctx.fillText(money(t.total),width-pad-18,y+52);y+=112;
 left('PEMBAYARAN',25,true);
 for(const payment of payments)pair(payment.method||'Pembayaran',money(payment.amount));
 pair('Pelanggan',t.customer||'Pelanggan Umum');
 rule();center(settings.receiptFooter||'Terima kasih telah berbelanja',30,true);
 center('Barang yang sudah dibeli mohon diperiksa kembali.',22,false,'#475569');
 center('Bukti transaksi • '+(settings.storeName||'MAMBO KASIR'),20,false,'#64748b');
 const blob=await new Promise(resolve=>ctxCanvas.toBlob(resolve,'image/png'));
 if(!blob)throw new Error('Gambar struk gagal dibuat.');
 const file=new File([blob],'Struk-'+(t.receipt||'MAMBO')+'.png',{type:'image/png'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
 toast('Gambar struk diunduh. Buka WhatsApp dan lampirkan gambar dari folder Download.');
}
async function receiptPrint(t){
 const settings=(await all('settings'))[0]||{},width=Number(settings.receiptWidth)===80?80:58,paper=width===80?'72mm':'48mm',money=n=>rp(Number(n)||0);
 const items=(t.items||[]).map(x=>`<article class="item"><div class="name">${esc(x.name||'Produk')}</div>${x.sku?`<div class="sku">${esc(x.sku)}</div>`:''}<div class="row"><span>${Number(x.qty)||0} × ${money(x.price)}</span><b>${money((Number(x.qty)||0)*(Number(x.price)||0))}</b></div></article>`).join('');
 const payments=(t.payments||[]).map(x=>`<div class="row"><span>${esc(x.method||'Pembayaran')}</span><b>${money(x.amount)}</b></div>`).join('');
 const cash=(t.payments||[]).filter(x=>String(x.method||'').toLowerCase()==='tunai').reduce((a,x)=>a+Number(x.amount||0),0),change=Math.max(0,cash-Number(t.total||0));
 const w=window.open('','_blank','width=460,height=760');if(!w){toast('Izinkan pop-up untuk mencetak struk.');return;}
 const logoUrl=new URL('../assets/mambo-app-icon.svg?v=brand-1',import.meta.url).href;
 const logoTag='<img class="brand-logo" src="'+logoUrl+'" alt="Logo MAMBO KASIR">';
 w.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Struk ${esc(t.receipt||'')}</title><style>
 *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111}body{font:11px/1.4 Arial,Helvetica,sans-serif;width:${paper};max-width:100%;margin:0 auto;padding:4mm 3mm}
 .brand{text-align:center;padding:2mm 0 3mm;border-bottom:1px solid #222}.brand-logo{display:block;width:18mm;height:18mm;object-fit:contain;margin:0 auto 3mm;flex:none}.brand h1{font-size:17px;line-height:1.15;margin:0 0 4px;font-weight:800;text-transform:uppercase;letter-spacing:.5px}.brand p{font-size:9px;margin:1px 0;color:#333;overflow-wrap:anywhere}.tag{display:inline-block;border:1px solid #333;border-radius:20px;padding:2px 8px;margin-top:5px;font-size:8px;font-weight:bold;letter-spacing:1px}
 .meta{padding:7px 0;border-bottom:1px dashed #555}.row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}.row span{color:#444}.row b{white-space:nowrap}.item{padding:5px 0;border-bottom:1px dotted #bbb}.name{font-weight:bold;font-size:11px;overflow-wrap:anywhere}.sku{font-size:8px;color:#666}.section{font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin:8px 0 4px}.summary{padding:6px 0;border-bottom:1px dashed #555}.grand{display:flex;justify-content:space-between;align-items:center;background:#f1f1f1;border:1px solid #222;padding:8px 6px;margin:8px 0;font-weight:800}.grand b{font-size:15px;white-space:nowrap}.payments{padding:5px 0;border-bottom:1px dashed #555}.change{font-weight:bold}.customer{padding:6px 0;border-bottom:1px dashed #555}.footer{text-align:center;padding:10px 2px 2px}.footer strong{font-size:11px}.footer p{font-size:9px;color:#444;margin:3px 0}.note{font-size:8px;color:#666;margin-top:7px}
 @page{size:${width}mm auto;margin:0}@media print{html,body{width:${paper};min-width:${paper};margin:0;padding:0;background:#fff}body{padding:3mm 2.5mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
 </style></head><body><header class="brand">${logoTag}<h1>${esc(settings.storeName||'MAMBO KASIR')}</h1>${settings.address?`<p>${esc(settings.address)}</p>`:''}${settings.phone?`<p>Telp. ${esc(settings.phone)}</p>`:''}<span class="tag">BUKTI PEMBAYARAN</span></header>
 <section class="meta"><div class="row"><span>No. Struk</span><b>${esc(t.receipt||'-')}</b></div><div class="row"><span>Tanggal</span><b>${esc(t.stamp||'-')}</b></div>${t.cashier?`<div class="row"><span>Kasir</span><b>${esc(t.cashier)}</b></div>`:''}</section>
 <div class="section">Rincian Belanja</div>${items||'<p>Tidak ada rincian produk.</p>'}
 <section class="summary"><div class="row"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>${Number(t.discount)?`<div class="row"><span>Diskon</span><b>− ${money(t.discount)}</b></div>`:''}${Number(t.tax)?`<div class="row"><span>Pajak</span><b>${money(t.tax)}</b></div>`:''}</section>
 <div class="grand"><span>TOTAL BAYAR</span><b>${money(t.total)}</b></div><div class="section">Pembayaran</div><section class="payments">${payments||'<div class="row"><span>Status</span><b>Lunas</b></div>'}${change>0?`<div class="row change"><span>Kembalian</span><b>${money(change)}</b></div>`:''}</section>
 <section class="customer"><div class="row"><span>Pelanggan</span><b>${esc(t.customer||'Pelanggan Umum')}</b></div></section><footer class="footer"><strong>${esc(settings.receiptFooter||'Terima kasih telah berbelanja')}</strong><p>Barang yang sudah dibeli mohon diperiksa kembali.</p><p class="note">Bukti transaksi • ${esc(settings.storeName||'MAMBO KASIR')}</p></footer>
 <script>window.onload=()=>{const logo=document.querySelector(".brand-logo");let started=false;const print=()=>{if(started)return;started=true;setTimeout(()=>window.print(),300)};if(!logo||logo.complete){print();return}logo.addEventListener("load",print,{once:true});logo.addEventListener("error",print,{once:true});setTimeout(print,1500);}<\/script></body></html>`);w.document.close();
}
export async function mountShift(root,user){
 const shifts=await all('shifts'),s=shiftForUser(shifts,user),deviceId=currentDeviceId();
 const legacyOpen=deviceId?shifts.filter(x=>x.userId===user.id&&x.status==='open'&&!x.deviceId):[];
 root.innerHTML='<h1>Shift & Laci Kas</h1><p class="sub">Laci kas bersama toko dan aktivitas kas</p><section class="panel" id="shiftPanel"></section>';
 const p=$('#shiftPanel');
 if(user.sharedDrawerSession&&deviceId){
  if(navigator.onLine){try{await flushPendingSharedDrawerEvents();}catch{}}
  const pendingDrawer=JSON.parse(localStorage.getItem('mambo_pending_drawer_events')||'[]');if(pendingDrawer.length){p.innerHTML='<div class="notice"><b>Ada '+pendingDrawer.length+' pergerakan kas yang belum tersinkron.</b><p>Saldo laci belum dapat dipastikan. Periksa koneksi dan muat ulang menu sebelum mencatat aktivitas baru.</p></div>';return;}
  if(legacyOpen.length){p.innerHTML='<div class="notice"><b>Shift lama perlu diperiksa.</b><p>Ditemukan shift lama tanpa identitas perangkat. Sistem tidak akan memindahkan atau menutupnya otomatis. Selesaikan dari perangkat asal terlebih dahulu.</p></div>';return;}
  try{
   const snap=await deviceDrawerSnapshot();
   if(!snap?.open){
    if(user.role==='supervisor'){
     p.innerHTML='<div class="notice"><b>Laci kas bersama belum dibuka.</b><p>Supervisor dapat membuka laci hanya jika Owner mengaktifkan izinnya.</p></div><div class="field"><label>Modal awal laci</label><input id="supervisorOpening" type="number" min="0" value="100000"></div><button class="primary" id="supervisorOpenDrawer">Buka Laci (Supervisor)</button>';
     $('#supervisorOpenDrawer').onclick=async()=>{const amount=Number($('#supervisorOpening').value);if(!Number.isFinite(amount)||amount<0)return toast('Modal awal tidak valid');try{await supervisorSharedDrawerControl('open',amount);toast('Laci kas dibuka oleh Supervisor.');await mountShift(root,user);}catch(err){toast('Tidak dapat membuka laci: '+(err.message||err));}};return;
    }
    p.innerHTML='<div class="notice"><b>Laci kas bersama belum dibuka oleh Owner.</b><p>Kasir tidak dapat membuka atau menutup laci kas.</p></div>';return;
   }
   p.innerHTML='<div class="grid"><div class="stat"><span>Modal awal</span><strong>'+rp(snap.opening_cash)+'</strong></div><div class="stat"><span>Penjualan tunai bersama</span><strong>'+rp(snap.cash_sales)+'</strong></div><div class="stat"><span>Kas masuk</span><strong>'+rp(snap.cash_in)+'</strong></div><div class="stat"><span>Kas keluar</span><strong>'+rp(snap.cash_out)+'</strong></div></div><p>Laci dibuka: '+esc(snap.opened_at||'-')+' oleh '+esc(snap.opened_by||'Owner')+'</p><div class="grand-total">Saldo kas bersama: '+rp(snap.expected_cash)+'</div><div class="actions"><button class="secondary" id="cashIn">Kas Masuk</button><button class="secondary" id="cashOut">Kas Keluar</button><button class="secondary" id="refreshDrawer">Perbarui Saldo</button></div><p class="muted">Saldo berasal dari ledger server. '+(user.role==='supervisor'?'Izin buka/tutup mengikuti pengaturan Owner.':'Kasir tidak dapat membuka atau menutup laci.')+'</p>'+(user.role==='supervisor'?'<div class="field"><label>Uang fisik saat tutup</label><input id="supervisorCounted" type="number" min="0"></div><button class="danger" id="supervisorCloseDrawer">Tutup Laci (Supervisor)</button>':'')+'<div id="drawerEvents"></div>';
   $('#drawerEvents').innerHTML=(snap.events||[]).slice(-30).reverse().map(e=>'<p>'+esc(e.actor_name)+' · '+esc(e.event_type)+' · '+rp(e.amount)+' · '+esc(e.note||'')+'</p>').join('')||'<p class="muted">Belum ada aktivitas kas.</p>';
   $('#refreshDrawer').onclick=()=>mountShift(root,user);
   if(user.role==='supervisor')$('#supervisorCloseDrawer').onclick=async()=>{if(JSON.parse(localStorage.getItem('mambo_pending_drawer_events')||'[]').length)return toast('Masih ada kompensasi/pergerakan kas yang belum tersinkron. Laci tidak boleh ditutup.');const counted=Number($('#supervisorCounted').value);if(!Number.isFinite(counted)||counted<0)return toast('Isi uang fisik saat tutup');if(!confirm('Tutup laci kas bersama?'))return;try{const result=await supervisorSharedDrawerControl('close',null,counted);toast('Laci ditutup. Selisih: '+rp(result.difference));await mountShift(root,user);}catch(err){toast('Tidak dapat menutup laci: '+(err.message||err));}};
   for(const [id,type] of [['cashIn','cash_in'],['cashOut','cash_out']])$('#'+id).onclick=async()=>{const amount=Number(prompt('Nominal (Rp)'));if(!Number.isFinite(amount)||amount<=0)return toast('Nominal tidak valid');const note=prompt('Keterangan wajib diisi');if(!note?.trim())return toast('Keterangan wajib diisi');const event={eventId:uid(),type,amount,note:note.trim()},pending=JSON.parse(localStorage.getItem('mambo_pending_drawer_events')||'[]');pending.push(event);localStorage.setItem('mambo_pending_drawer_events',JSON.stringify(pending));try{await appendSharedDrawerEvent(event);localStorage.setItem('mambo_pending_drawer_events',JSON.stringify(JSON.parse(localStorage.getItem('mambo_pending_drawer_events')||'[]').filter(x=>x.eventId!==event.eventId)));toast('Pergerakan kas tercatat.');await mountShift(root,user);}catch(err){toast('Pergerakan kas menunggu sinkronisasi: '+(err.message||err));}};
  }catch(err){p.innerHTML='<div class="notice"><b>Laci kas bersama tidak dapat diverifikasi.</b><p>'+esc(err.message||err)+'</p><p>Jangan lanjutkan transaksi/pergerakan kas sebelum sesi dan koneksi server pulih.</p></div>';}
  return;
 }
 if(user.role==='owner'){
  try{
   const cloud=await cloudStatus();
   if(cloud.authenticated&&cloud.storeId){
    const pending=JSON.parse(localStorage.getItem('mambo_pending_owner_drawer_events')||'[]'),remain=[];for(const event of pending){try{await appendOwnerDrawerEvent(event,user.name);}catch{remain.push(event);}}localStorage.setItem('mambo_pending_owner_drawer_events',JSON.stringify(remain));
    if(remain.length){p.innerHTML='<div class="notice"><b>Ada '+remain.length+' pergerakan kas yang belum tersinkron.</b><p>Penutupan laci dikunci sampai seluruh pergerakan kas diterima server. Periksa koneksi lalu muat ulang menu.</p></div>';return;}
    const snap=await ownerDrawerSnapshot();
    if(!snap?.open){
     p.innerHTML='<h3>Buka Laci Kas Bersama</h3><div class="field"><label>Modal awal laci kas</label><input id="sharedOpening" type="number" min="0" value="100000"></div><button class="primary" id="openShared">Buka Laci Kas Bersama</button><p class="muted">Pembukaan dilakukan melalui akun Owner Supabase. Shift lokal lama tidak diubah.</p>';
     $('#openShared').onclick=async()=>{const amount=Number($('#sharedOpening').value);if(!Number.isFinite(amount)||amount<0)return toast('Modal awal tidak valid');try{await openSharedDrawer(amount,user.name);toast('Laci kas bersama dibuka.');await mountShift(root,user);}catch(err){toast('Gagal membuka laci: '+(err.message||err));}};
     return;
    }
    p.innerHTML='<div class="grid"><div class="stat"><span>Modal awal</span><strong>'+rp(snap.opening_cash)+'</strong></div><div class="stat"><span>Penjualan tunai bersama</span><strong>'+rp(snap.cash_sales)+'</strong></div><div class="stat"><span>Kas masuk</span><strong>'+rp(snap.cash_in)+'</strong></div><div class="stat"><span>Kas keluar</span><strong>'+rp(snap.cash_out)+'</strong></div></div><div class="grand-total">Saldo kas bersama: '+rp(snap.expected_cash)+'</div><p>Dibuka: '+esc(snap.opened_at)+' oleh '+esc(snap.opened_by)+'</p><h3>Aktivitas Laci Kas Bersama</h3><div class="actions"><button class="secondary" id="refreshOwnerDrawerEvents">Perbarui Pemeriksaan</button></div><div id="ownerDrawerEvents"></div><div class="actions"><button class="secondary" id="ownerCashIn">Kas Masuk</button><button class="secondary" id="ownerCashOut">Kas Keluar</button></div><div class="field"><label>Uang fisik saat tutup</label><input id="sharedCounted" type="number" min="0"></div><button class="danger" id="closeShared">Tutup Laci Kas Bersama</button><div id="sharedCloseResult"></div><p class="muted">Kasir tidak dapat menutup laci. Penutupan menghitung saldo ledger server.</p>';
    const renderOwnerDrawerEvents=async()=>{
 const review=await reviewSharedDrawerPendingEvents(),allEvents=review.snapshot?.events||[],pendingEvents=allEvents.filter(e=>e.resolution_status==='pending'),recentEvents=allEvents.filter(e=>e.resolution_status!=='pending').slice(-60),events=[...recentEvents,...pendingEvents].reverse();
 $('#ownerDrawerEvents').innerHTML=events.map(e=>{
  const pending=e.resolution_status==='pending',check=review.pending.find(x=>x.event_id===e.event_id);
  return '<article class="panel"><b>'+esc(e.actor_name)+'</b> · '+esc(e.event_type)+' · '+rp(e.amount)+'<p>'+esc(e.note||'')+'</p><p class="muted">'+(pending?'MENUNGGU KONFIRMASI':'confirmed'===e.resolution_status?'Terkonfirmasi':esc(e.resolution_status))+(pending?(check?.synced_record_valid?' · Record pusat cocok':check?.synced_record_found?' · RECORD DITEMUKAN TETAPI TIDAK COCOK':' · Record belum ditemukan di sinkronisasi pusat')+(check?.validation_reason?' — '+esc(check.validation_reason):''):'')+'</p>'+(pending?'<div class="actions">'+(check?.synced_record_valid?'<button class="primary" data-resolve-event="'+e.event_id+'" data-resolution="confirmed">Konfirmasi tersimpan</button>':check?.synced_record_found?'<span class="error">Penyelesaian otomatis dikunci karena data tidak cocok. Periksa transaksi secara manual.</span>':'<button class="danger" data-resolve-event="'+e.event_id+'" data-resolution="reversed">Batalkan setelah verifikasi</button>')+'</div>':'')+'</article>';
 }).join('')||'<p class="muted">Belum ada aktivitas.</p>';
 $('#ownerDrawerEvents').querySelectorAll('[data-resolve-event]').forEach(btn=>btn.onclick=async()=>{
  const resolution=btn.dataset.resolution;
  const message=resolution==='confirmed'?'Konfirmasi bahwa transaksi/pengeluaran ini benar-benar sudah tersimpan di data pusat?':'Pastikan transaksi/pengeluaran tidak tersimpan pada perangkat kasir mana pun. Pergerakan ini akan dibatalkan dari saldo laci. Lanjutkan?';
  if(!confirm(message))return;
  btn.disabled=true;
  try{await resolveOwnerDrawerEvent(btn.dataset.resolveEvent,resolution);toast(resolution==='confirmed'?'Pergerakan dikonfirmasi.':'Pergerakan dibatalkan.');await mountShift(root,user);}
  catch(err){btn.disabled=false;toast('Tidak dapat menyelesaikan pergerakan: '+(err.message||err));}
 });
};
$('#refreshOwnerDrawerEvents').onclick=async()=>{const btn=$('#refreshOwnerDrawerEvents');btn.disabled=true;try{await renderOwnerDrawerEvents();}catch(err){$('#ownerDrawerEvents').innerHTML='<div class="notice">Pemeriksaan pergerakan tertunda gagal: '+esc(err.message||err)+'</div>';}finally{btn.disabled=false;}};
try{await renderOwnerDrawerEvents();}catch(err){$('#ownerDrawerEvents').innerHTML='<div class="notice">Pemeriksaan pergerakan tertunda gagal: '+esc(err.message||err)+'</div>';}

    for(const [id,type] of [['ownerCashIn','cash_in'],['ownerCashOut','cash_out']])$('#'+id).onclick=async()=>{const amount=Number(prompt('Nominal (Rp)'));if(!Number.isFinite(amount)||amount<=0)return toast('Nominal tidak valid');const note=prompt('Keterangan wajib diisi');if(!note?.trim())return toast('Keterangan wajib diisi');const event={eventId:uid(),type,amount,note:note.trim()},pending=JSON.parse(localStorage.getItem('mambo_pending_owner_drawer_events')||'[]');pending.push(event);localStorage.setItem('mambo_pending_owner_drawer_events',JSON.stringify(pending));try{await appendOwnerDrawerEvent(event,user.name);localStorage.setItem('mambo_pending_owner_drawer_events',JSON.stringify(JSON.parse(localStorage.getItem('mambo_pending_owner_drawer_events')||'[]').filter(x=>x.eventId!==event.eventId)));toast('Pergerakan kas tercatat.');await mountShift(root,user);}catch(err){toast('Pergerakan kas menunggu sinkronisasi: '+(err.message||err));}};
 $('#closeShared').onclick=async()=>{if(JSON.parse(localStorage.getItem('mambo_pending_owner_drawer_events')||'[]').length)return toast('Masih ada pergerakan kas Owner yang belum tersinkron. Laci tidak boleh ditutup.');const counted=Number($('#sharedCounted').value);if(!Number.isFinite(counted)||counted<0)return toast('Isi jumlah uang fisik');if(!confirm('Tutup laci kas bersama untuk seluruh perangkat?'))return;try{const result=await closeSharedDrawer(counted,user.name);$('#sharedCloseResult').innerHTML='<h3>Ringkasan Penutupan</h3><p>Kas sistem: '+rp(result.expected_cash)+'</p><p>Kas fisik: '+rp(result.counted_cash)+'</p><h3>Selisih: '+rp(result.difference)+'</h3>';toast('Laci kas bersama ditutup.');}catch(err){toast('Gagal menutup laci: '+(err.message||err));}};
    return;
   }
  }catch(err){p.innerHTML='<div class="notice"><b>Status laci kas cloud tidak dapat diverifikasi.</b><p>'+esc(err.message||err)+'</p><p>Masuk ke Supabase Cloud sebagai Owner untuk mengelola laci kas bersama.</p></div>';return;}
 }
 if(!s){
  if(legacyOpen.length){p.innerHTML='<h3>Shift lama perlu diperiksa</h3><div class="notice">Shift lama tanpa identitas perangkat tidak akan dipindahkan atau ditutup otomatis.</div>';return;}
  p.innerHTML='<h3>Buka Shift</h3><div class="field"><label>Modal awal laci kas</label><input id="opening" type="number" min="0" value="100000"></div><button class="primary" id="openShift">Buka Shift</button>';
  $('#openShift').onclick=async()=>{const n=Number($('#opening').value);if(!Number.isFinite(n)||n<0)return toast('Modal awal tidak valid');await put('shifts',{id:uid(),userId:user.id,userName:user.name,deviceId:null,deviceLabel:'Perangkat Owner',openingCash:n,cashSales:0,sales:0,cashIn:0,cashOut:0,refund:0,status:'open',openedAt:now()});mountShift(root,user)};return;
 }
 const expected=s.openingCash+s.cashSales+s.cashIn-s.cashOut-s.refund;
 p.innerHTML='<div class="grid"><div class="stat"><span>Modal awal</span><strong>'+rp(s.openingCash)+'</strong></div><div class="stat"><span>Penjualan tunai</span><strong>'+rp(s.cashSales)+'</strong></div><div class="stat"><span>Kas masuk</span><strong>'+rp(s.cashIn)+'</strong></div><div class="stat"><span>Kas keluar</span><strong>'+rp(s.cashOut)+'</strong></div></div><p>Shift dibuka: '+esc(s.openedAt)+'</p><div class="actions"><button class="secondary" id="cashIn">Kas Masuk</button><button class="secondary" id="cashOut">Kas Keluar</button></div><div class="grand-total">Kas sistem: '+rp(expected)+'</div><div class="field"><label>Uang fisik saat tutup</label><input id="counted" type="number" min="0"></div><button class="danger" id="close">Tutup Shift</button><div id="summary"></div>';
 for(const [id,field] of [['cashIn','cashIn'],['cashOut','cashOut']])$('#'+id).onclick=async()=>{const amount=Number(prompt('Nominal (Rp)'));if(!Number.isFinite(amount)||amount<=0)return toast('Nominal tidak valid');const note=prompt('Keterangan wajib diisi');if(!note?.trim())return toast('Keterangan wajib diisi');await put('shifts',{...s,[field]:(s[field]||0)+amount,entries:[...(s.entries||[]),{type:field,amount,note,time:now()}]});mountShift(root,user)};
 $('#close').onclick=async()=>{const counted=Number($('#counted').value);if(!Number.isFinite(counted)||counted<0)return toast('Isi jumlah uang fisik');const closed={...s,status:'closed',countedCash:counted,expectedCash:expected,difference:counted-expected,closedAt:now()};await put('shifts',closed);$('#summary').innerHTML='<h2>Ringkasan Tutup Shift</h2><p>Kas sistem: '+rp(expected)+'</p><p>Kas fisik: '+rp(counted)+'</p><h2>Selisih: '+rp(counted-expected)+'</h2><p>Ditutup: '+esc(closed.closedAt)+'</p>';toast('Shift ditutup')};
}

export async function mountTransactionHistory(root,user){
 const [transactions,products,shifts,receivables]=await Promise.all(['transactions','products','shifts','receivables'].map(all));
 const activeShift=shiftForUser(shifts,user);
 const privileged=user.role==='owner'||user.role==='supervisor';
 const visible=transactions.filter(t=>t.status!=='void'&&(privileged||(t.userId===user.id&&(!currentDeviceId()||!t.deviceId||t.deviceId===currentDeviceId())))).sort((a,b)=>String(b.time||'').localeCompare(String(a.time||'')));
 const money=n=>rp(n);
 root.innerHTML='<h1>Riwayat Transaksi</h1><p class="sub">'+(privileged?'Riwayat transaksi seluruh kasir.':'Transaksi Anda pada shift yang masih terbuka.')+'</p><section class="panel"><div class="toolbar"><input id="historySearch" placeholder="Cari nomor struk atau pelanggan"><input id="historyDate" type="date">'+(user.role==='owner'?'<button class="primary" id="repairTransactionHpp">Perbaiki HPP Transaksi</button>':'')+'</div><p class="muted">Perbaikan mengisi HPP kosong/nol dari HPP produk saat ini berdasarkan ID produk atau SKU. HPP yang sudah tercatat tidak diubah.</p><div id="historyTable"></div></section>';
 const draw=()=>{
  const q=$('#historySearch').value.toLowerCase(),date=$('#historyDate').value;
  const rows=visible.filter(t=>(!q||[t.receipt,t.customerName,t.userName].join(' ').toLowerCase().includes(q))&&(!date||isoDate(t)===date));
  $('#historyTable').innerHTML=rows.length?'<div class="table-wrap"><table><thead><tr><th>Waktu</th><th>No. Struk</th><th>Kasir</th><th>Total</th><th>Status</th><th>Aksi</th></tr></thead><tbody>'+rows.map(t=>'<tr><td>'+esc(t.time)+'</td><td>'+esc(t.receipt)+'</td><td>'+esc(t.userName)+'</td><td>'+money(t.total)+'</td><td><span class="pill">'+(t.status==='paid'?'Lunas':esc(t.status))+'</span></td><td><button class="secondary" data-detail="'+t.id+'">Detail</button> <button class="secondary" data-print-tx="'+t.id+'">Cetak Struk</button> <button class="secondary" data-wa-tx="'+t.id+'">Kirim WA</button> '+((privileged||(activeShift&&t.shiftId===activeShift.id&&t.userId===user.id))?'<button class="primary" data-edit-tx="'+t.id+'">Koreksi Transaksi</button>':'')+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty">Belum ada transaksi pada cakupan ini.</div>';
 };
 draw();$('#historySearch').oninput=draw;$('#historyDate').onchange=draw;
 $('#repairTransactionHpp')?.addEventListener('click',async()=>{
  const currentProducts=await all('products'),byId=new Map(currentProducts.map(x=>[String(x.id),x])),bySku=new Map(currentProducts.map(x=>[String(x.sku||'').trim().toLowerCase(),x]));
  const txRows=await all('transactions');let missingLines=0,matchedLines=0,unmatchedLines=0,transactionsToUpdate=[];
  for(const tx of txRows){
   if(tx.status==='void'||!Array.isArray(tx.items))continue;
   let changed=false;
   const nextItems=tx.items.map(item=>{
    const oldCost=Number(item.cost);
    if(Number.isFinite(oldCost)&&oldCost>0)return item;
    missingLines++;
    const product=byId.get(String(item.id))||bySku.get(String(item.sku||'').trim().toLowerCase());
    const currentCost=Number(product?.cost);
    if(!product||!Number.isFinite(currentCost)||currentCost<=0){unmatchedLines++;return item;}
    matchedLines++;changed=true;return{...item,cost:currentCost};
   });
   if(changed)transactionsToUpdate.push({...tx,items:nextItems});
  }
  if(!missingLines)return toast('Tidak ditemukan HPP kosong atau nol pada transaksi.');
  if(!matchedLines)return toast('Ada '+missingLines+' baris HPP kosong, tetapi tidak ada yang cocok dengan HPP produk aktif. Tidak ada perubahan.');
  const preview='Baris HPP kosong/nol: '+missingLines+'\nDapat diperbaiki: '+matchedLines+'\nTidak ditemukan produk/HPP aktif: '+unmatchedLines+'\nTransaksi yang diperbarui: '+transactionsToUpdate.length+'\n\nHPP yang kosong akan diisi memakai HPP produk saat ini. HPP lama yang sudah positif tidak diubah. Omzet, Qty, pembayaran, stok, dan tanggal transaksi tidak diubah. Perubahan transaksi akan disinkronkan ke Cloud.';
  if(!confirm('PERBAIKI HPP TRANSAKSI LAMA?\n\n'+preview))return;
  try{
   for(const tx of transactionsToUpdate)await put('transactions',tx);
   toast('HPP diperbaiki pada '+transactionsToUpdate.length+' transaksi ('+matchedLines+' baris). Sinkronisasi akan mengirim pembaruan.');
   await mountTransactionHistory(root,user);
  }catch(e){toast('Perbaikan HPP gagal: '+(e.message||e));}
 });
 $('#historyTable').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  const tx=visible.find(t=>t.id===(b.dataset.detail||b.dataset.editTx||b.dataset.printTx||b.dataset.waTx));if(!tx)return;
  const receiptData={receipt:tx.receipt,items:tx.items||[],total:Number(tx.total)||0,subtotal:Number(tx.subtotal??tx.total)||0,discount:Number(tx.discount)||0,tax:Number(tx.tax)||0,payments:tx.payments||[],customer:tx.customerName||'Pelanggan Umum',cashier:tx.userName||'',stamp:tx.time||''};
  if(b.dataset.waTx){shareReceiptWhatsApp(receiptData);return;}
  if(b.dataset.printTx){receiptPrint(receiptData);return;}
  if(b.dataset.detail){
   const detail=document.createElement('div');detail.className='modal-backdrop';
   const detailItems=tx.items||[],hppTotal=detailItems.reduce((sum,i)=>sum+(Number(i.cost)||0)*(Number(i.qty)||0),0);
   const missingHpp=detailItems.filter(i=>i.cost===undefined||i.cost===null||!Number.isFinite(Number(i.cost))||Number(i.cost)<=0);
   detail.innerHTML='<section class="modal"><h2>Detail '+esc(tx.receipt)+'</h2><p>'+esc(tx.time)+' · '+esc(tx.userName)+'</p><div class="table-wrap"><table><thead><tr><th>Produk</th><th>Qty</th><th>Harga Jual</th><th>Jumlah</th><th>HPP/unit</th><th>Total HPP</th></tr></thead><tbody>'+detailItems.map(i=>{const qty=Number(i.qty)||0,cost=Number(i.cost)||0;return '<tr><td>'+esc(i.name)+'</td><td>'+qty+'</td><td>'+money(i.price)+'</td><td>'+money((Number(i.price)||0)*qty)+'</td><td>'+money(cost)+'</td><td>'+money(cost*qty)+'</td></tr>';}).join('')+'</tbody></table></div><h3>Total Penjualan: '+money(tx.total)+'</h3><h3>Total HPP: '+money(hppTotal)+'</h3><p class="muted">'+(missingHpp.length?'Perhatian: '+missingHpp.length+' baris memiliki HPP nol atau belum tercatat. Total HPP di atas belum dapat dianggap lengkap.':'Semua baris memiliki HPP positif dan total dihitung dari HPP/unit × Qty.')+'</p><div class="modal-actions"><button class="secondary" id="closeDetail">Tutup</button></div></section>';
   document.body.append(detail);detail.querySelector('#closeDetail').onclick=()=>detail.remove();return;
  }
  openEdit(tx,products,user,activeShift,privileged,draw,root);
 };
}

function openEdit(tx,products,user,activeShift,privileged,refresh,root){
 if(!privileged&&(!activeShift||tx.shiftId!==activeShift.id||tx.userId!==user.id)){toast('Kasir hanya dapat mengedit transaksi pada shift aktif miliknya.');return;}
 const wrap=document.createElement('div');wrap.className='modal-backdrop';
 wrap.innerHTML='<section class="modal"><h2>Koreksi Transaksi '+esc(tx.receipt)+'</h2><p class="muted">Ubah produk atau jumlah. Stok dan total akan dihitung ulang, serta koreksi dicatat.</p><div id="editLines"></div><div class="actions"><button class="secondary" id="addEditLine">＋ Tambah Produk</button></div><div id="editTotal" class="grand-total"></div><p id="editError" class="error"></p><div class="modal-actions"><button class="secondary" id="cancelEdit">Batal</button><button class="primary" id="saveEdit">Simpan Koreksi</button></div></section>';
 document.body.append(wrap);
 let lines=tx.items.map(i=>({id:i.id,qty:Number(i.qty)||1,price:Number(i.price)||0,cost:Number(i.cost)||0}));
 const options=()=>products.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' · '+esc(p.sku||'')+'</option>').join('');
 const draw=()=>{
  wrap.querySelector('#editLines').innerHTML=lines.map((line,i)=>'<div class="form-grid" style="align-items:end;margin:10px 0"><div class="field wide"><label>Produk</label><select data-line-product="'+i+'">'+options()+'</select></div><div class="field"><label>Jumlah</label><input type="number" min="1" step="1" value="'+line.qty+'" data-line-qty="'+i+'"></div><div class="field"><button class="danger" data-line-remove="'+i+'">Hapus baris</button></div></div>').join('');
  lines.forEach((line,i)=>{const s=wrap.querySelector('[data-line-product="'+i+'"]');if(s)s.value=line.id;});
  const sub=lines.reduce((a,l)=>a+l.price*l.qty,0),discount=Math.min(Number(tx.discount)||0,sub),rate=Number(tx.subtotal)>0?Number(tx.tax||0)/Math.max(1,Number(tx.subtotal)-Number(tx.discount||0)):0,tax=Number(tx.tax)?Math.round((sub-discount)*rate):0,rounding=Number(tx.total)-Math.max(0,Number(tx.subtotal)-Number(tx.discount||0)+Number(tx.tax||0)),total=Math.max(0,sub-discount+tax+rounding);
  wrap.querySelector('#editTotal').textContent='Perkiraan total: '+rp(total);
 };
 draw();
 wrap.querySelector('#addEditLine').onclick=()=>{if(!products.length)return;lines.push({id:products[0].id,qty:1,price:Number(products[0].price)||0,cost:Number(products[0].cost)||0});draw();};
 wrap.querySelector('#editLines').onchange=e=>{const s=e.target.closest('[data-line-product]'),q=e.target.closest('[data-line-qty]');if(s){const i=Number(s.dataset.lineProduct),p=products.find(x=>x.id===s.value);if(p)lines[i]={...lines[i],id:p.id,price:Number(p.price)||0,cost:Number(p.cost)||0};draw();}else if(q){const i=Number(q.dataset.lineQty);lines[i].qty=Math.max(1,Math.floor(Number(q.value)||1));draw();}};
 wrap.querySelector('#editLines').onclick=e=>{const b=e.target.closest('[data-line-remove]');if(b){lines.splice(Number(b.dataset.lineRemove),1);draw();}};
 wrap.querySelector('#cancelEdit').onclick=()=>wrap.remove();
 wrap.querySelector('#saveEdit').onclick=async()=>{
  const err=wrap.querySelector('#editError');err.textContent='';
  if(tx.sharedDrawer){err.textContent='Koreksi transaksi laci bersama sementara dikunci agar saldo fisik tidak berubah tanpa pencatatan penyesuaian server. Minta Owner menyelesaikan rekonsiliasi terlebih dahulu.';return;}
  if(!lines.length){err.textContent='Transaksi harus memiliki minimal satu produk.';return;}
  const latestShifts=await all('shifts'),currentShift=latestShifts.find(s=>s.id===tx.shiftId);
  if(!privileged&&(!currentShift||currentShift.status!=='open'||currentShift.id!==activeShift?.id)){err.textContent='Shift sudah ditutup. Kasir tidak dapat mengedit transaksi ini.';return;}
  const sub=lines.reduce((a,l)=>a+l.price*l.qty,0),discount=Math.min(Number(tx.discount)||0,sub),rate=Number(tx.subtotal)>0?Number(tx.tax||0)/Math.max(1,Number(tx.subtotal)-Number(tx.discount||0)):0,tax=Number(tx.tax)?Math.round((sub-discount)*rate):0,rounding=Number(tx.total)-Math.max(0,Number(tx.subtotal)-Number(tx.discount||0)+Number(tx.tax||0)),total=Math.max(0,sub-discount+tax+rounding);
  const newItems=lines.map(l=>{const p=products.find(x=>x.id===l.id);return{id:p.id,name:p.name,sku:p.sku,price:l.price,cost:l.cost,qty:l.qty};});
  const oldCash=(tx.payments||[]).filter(p=>p.method==='Tunai').reduce((a,p)=>a+Number(p.amount||0),0);
  let newPayments=(tx.payments||[]).map(p=>({...p}));
  if(newPayments.length===1&&newPayments[0].method==='Tunai'&&Number(newPayments[0].amount||0)<total){err.textContent='Nominal tunai yang tercatat kurang dari total baru. Minta Owner/Supervisor melakukan koreksi pembayaran.';return;}
  if(newPayments.length===1&&newPayments[0].method!=='Tunai')newPayments[0].amount=total;
  else if(newPayments.length>1){const base=newPayments.reduce((a,p)=>a+Number(p.amount||0),0)||1;let assigned=0;newPayments=newPayments.map((p,i)=>{const amount=i===newPayments.length-1?total-assigned:Math.round(total*Number(p.amount||0)/base);assigned+=amount;return{...p,amount};});}
  const newCash=Math.min(total,newPayments.filter(p=>p.method==='Tunai').reduce((a,p)=>a+Number(p.amount||0),0));
  const editRecord={at:now(),by:user.name,oldTotal:tx.total,newTotal:total,oldItems:tx.items,newItems};
  try{
   await atomic(['products','transactions','movements','shifts','receivables'],stores=>{
    const productReq=stores.products.getAll(),txReq=stores.transactions.get(tx.id),shiftReq=tx.shiftId?stores.shifts.get(tx.shiftId):null;
    let receivableReq=null;
    if((tx.payments||[]).some(p=>p.method==='Kasbon'))receivableReq=stores.receivables.getAll();
    let ready=0,failed=null;const reqs=[productReq,txReq,...(shiftReq?[shiftReq]:[]),...(receivableReq?[receivableReq]:[])];const expected=reqs.length;
    const finish=()=>{
     if(failed)return;
     if(++ready<expected)return;
     const current=txReq.result,s=shiftReq?.result,allProducts=productReq.result||[];
     if(!current||current.status!=='paid'){failed=new Error('Transaksi tidak ditemukan atau tidak dapat dikoreksi.');stores.products.transaction.abort();return;}
     if(!privileged&&(!s||s.status!=='open'||s.id!==activeShift?.id)){failed=new Error('Shift sudah ditutup.');stores.products.transaction.abort();return;}
     const delta=new Map();
     for(const item of current.items||[])delta.set(String(item.id),(delta.get(String(item.id))||0)+Number(item.qty||0));
     for(const item of newItems)delta.set(String(item.id),(delta.get(String(item.id))||0)-Number(item.qty||0));
     for(const [id,change] of delta){const p=allProducts.find(x=>String(x.id)===id);if(!p){failed=new Error('Produk '+id+' tidak ditemukan.');stores.products.transaction.abort();return;}if(Number(p.stock||0)+change<0){failed=new Error('Stok '+p.name+' tidak mencukupi untuk koreksi.');stores.products.transaction.abort();return;}}
     for(const [id,change] of delta){if(!change)continue;const p=allProducts.find(x=>String(x.id)===id);p.stock=Number(p.stock||0)+change;stores.products.put(p);stores.movements.put({id:uid(),productId:p.id,productName:p.name,type:'koreksi_penjualan',delta:change,note:'Koreksi struk '+current.receipt+' oleh '+user.name,time:now()});}
     if(s){s.sales=Number(s.sales||0)+(total-Number(current.total||0));s.cashSales=Number(s.cashSales||0)+(newCash-oldCash);stores.shifts.put(s);}
     const updated={...current,items:newItems,subtotal:sub,discount,tax,total,payments:newPayments,editedAt:now(),editedBy:user.name,editHistory:[...(current.editHistory||[]),editRecord]};
     stores.transactions.put(updated);
     if(receivableReq){const ars=receivableReq.result||[],ar=ars.find(x=>x.transactionId===current.id);if(ar){const change=total-Number(current.total||0);stores.receivables.put({...ar,amount:total,balance:Math.max(0,Number(ar.balance||0)+change),lastEditedAt:now()});}}
    };
    for(const req of reqs){req.onsuccess=finish;req.onerror=()=>{failed=req.error;try{stores.products.transaction.abort();}catch{}};}
   });
   wrap.remove();toast('Koreksi transaksi tersimpan.');await mountTransactionHistory(root,user);
  }catch(e){err.textContent=e.message||'Koreksi gagal disimpan.';}
 };
}
