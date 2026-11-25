export function validatePendingDrawerRecord(event,row){
 if(!event||!row)return {valid:false,reason:'Record belum ditemukan pada sinkronisasi pusat.'};
 if(row.deleted)return {valid:false,reason:'Record pusat ditandai terhapus.'};
 const payload=row.payload||{};
 const sourceId=String(event.source_record_id??'');
 const identityMatches=!!sourceId&&String(row.record_id??'')===sourceId&&String(payload.id??'')===sourceId;
 const deviceMatches=!event.device_id||String(payload.deviceId??'')===String(event.device_id);
 const actorMatches=!event.device_id||String(payload.userId??'')===String(event.actor_id);
 let amountMatches=false,statusMatches=false;
 if(event.event_type==='cash_sale'){
  const cashPaid=(Array.isArray(payload.payments)?payload.payments:[])
   .filter(p=>String(p.method||'').trim().toLowerCase()==='tunai')
   .reduce((sum,p)=>sum+Number(p.amount||0),0);
  const total=Number(payload.total||0),expectedAmount=Math.min(total,cashPaid);
  amountMatches=Number.isFinite(total)&&Number.isFinite(cashPaid)&&Math.abs(expectedAmount-Number(event.amount))<0.01;
  statusMatches=payload.status==='paid'&&expectedAmount>0;
 }else if(event.event_type==='cash_expense'){
  const recordAmount=Number(payload.amount);
  amountMatches=Number.isFinite(recordAmount)&&Math.abs(recordAmount-Number(event.amount))<0.01;
  statusMatches=payload.source==='cash';
 }else return {valid:false,reason:'Jenis pergerakan belum didukung untuk pemeriksaan otomatis.'};
 const valid=identityMatches&&deviceMatches&&actorMatches&&amountMatches&&statusMatches;
 const reason=valid?'Record pusat cocok dengan jenis, nominal, kasir, dan perangkat.':
  !identityMatches?'Identitas record tidak cocok dengan referensi pergerakan kas.':
  !deviceMatches?'Perangkat pada record tidak cocok dengan perangkat pembuat pergerakan.':
  !actorMatches?'Kasir pada record tidak cocok dengan pembuat pergerakan.':
  !amountMatches?'Nominal record tidak cocok dengan nominal pergerakan kas.':
  'Status atau sumber pembayaran record tidak sesuai.';
 return {valid,reason};
}
