const ordersKey='pennybuys-orders';
const statusSteps=[['processing','Order is being processed'],['packed','Packed and ready for delivery'],['in_transit','On the way for delivery'],['delivered','Delivered']];
const money=value=>window.PennyBuysCurrency?.format(value)||`£${Number(value).toFixed(2)}`;
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function readOrders(){try{return JSON.parse(localStorage.getItem(ordersKey)||'[]')}catch{return []}}
function formatDate(value){const date=new Date(value);return Number.isNaN(date.valueOf())?'':new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(date)}
const query=new URLSearchParams(location.search);
if(query.has('paid'))localStorage.removeItem('pennybuys-bag');
const lookup=document.querySelector('#order-lookup');
let visibleOrder=null;let activeLookup=null;let refreshTimer;
function showOrder(order){
  if(!order)return;
  visibleOrder=order;
  const awaitingPayment=order.paymentStatus==='pending'||order.status==='pending_payment';
  const current=Math.max(0,statusSteps.findIndex(step=>step[0]===order.status));
  document.querySelector('#order-result').hidden=false;document.querySelector('#order-error').hidden=true;
  document.querySelector('#order-number').textContent=order.id;
  document.querySelector('#order-status-title').textContent=awaitingPayment?'Payment is being confirmed':statusSteps[current][1];
  document.querySelector('#order-created').textContent=`Placed ${formatDate(order.createdAt)}`;
  const pill=document.querySelector('#order-status-pill');pill.textContent=awaitingPayment?'Payment pending':statusSteps[current][1];pill.dataset.status=order.status;
  document.querySelector('#order-progress').innerHTML=statusSteps.map(([key,label],index)=>`<div class="progress-step ${index<current?'complete':''} ${index===current?'current':''}"><span class="progress-dot">${index<current?'✓':index+1}</span><div><b>${label}</b><small>${order.history?.filter(item=>item.status===key).slice(-1).map(item=>formatDate(item.at))[0]|| (index===0?formatDate(order.createdAt):'')}</small></div></div>`).join('');
  const showTracking=['in_transit','delivered'].includes(order.status)&&order.trackingNumber;
  document.querySelector('#tracking-card').hidden=!showTracking;
  document.querySelector('#tracking-value').textContent=showTracking?order.trackingNumber:'';
  const address=order.address||{};
  document.querySelector('#order-address').textContent=[order.customer?.name,address.line1,address.line2,address.city,address.postcode,address.country].filter(Boolean).join(', ');
  document.querySelector('#order-lines').innerHTML=(order.items||[]).map(item=>`<div class="order-summary-line"><span>${escapeHTML(item.name)} × ${Number(item.qty)}</span><b>${money(item.price*item.qty)}</b></div>`).join('')+`<div class="order-summary-line"><span>Delivery</span><b>${Number(order.delivery)?money(order.delivery):'Free'}</b></div>`;
  document.querySelector('.order-total').textContent=`Total ${money(order.total)}${awaitingPayment?' · awaiting payment confirmation':''}`;
}
async function lookupOrder(id,email){
  try{const response=await fetch('/api/orders/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,email})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Order lookup failed.');return data.order}
  catch(error){const cached=readOrders().find(item=>item.id.toLowerCase()===id.toLowerCase()&&item.customer?.email.toLowerCase()===email.toLowerCase());if(cached)return cached;throw error}
}
async function refreshPrivateOrder(id,key){
  const response=await fetch(`/api/orders/${encodeURIComponent(id)}?key=${encodeURIComponent(key)}`,{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not refresh this order.');return data.order;
}
function startRefresh(){clearInterval(refreshTimer);refreshTimer=setInterval(async()=>{if(!visibleOrder||document.hidden)return;try{const latest=activeLookup?.key?await refreshPrivateOrder(activeLookup.id,activeLookup.key):activeLookup?await lookupOrder(activeLookup.id,activeLookup.email):null;if(latest){const changed=latest.status!==visibleOrder.status||latest.trackingNumber!==visibleOrder.trackingNumber||latest.paymentStatus!==visibleOrder.paymentStatus;visibleOrder=latest;if(changed)showOrder(latest);if(latest.paymentStatus==='paid')clearInterval(refreshTimer)}}catch{}},5000)}
lookup.addEventListener('submit',async event=>{event.preventDefault();const values=new FormData(lookup);const id=String(values.get('orderId')).trim();const email=String(values.get('email')).trim().toLowerCase();try{const order=await lookupOrder(id,email);activeLookup={id:order.id,email};showOrder(order);history.replaceState(null,'',`order.html?id=${encodeURIComponent(order.id)}`);startRefresh()}catch{document.querySelector('#order-result').hidden=true;document.querySelector('#order-error').hidden=false}});
const linkedOrderId=query.get('id');
const accessKey=query.get('key');
if(linkedOrderId&&accessKey){lookup.hidden=true;activeLookup={id:linkedOrderId,key:accessKey};refreshPrivateOrder(linkedOrderId,accessKey).then(order=>{showOrder(order);startRefresh()}).catch(()=>{lookup.hidden=false;document.querySelector('#order-result').hidden=true;document.querySelector('#order-error').hidden=false})}
else if(linkedOrderId){const order=readOrders().find(item=>item.id===linkedOrderId);if(order){lookup.hidden=true;showOrder(order)}}
if(linkedOrderId&&!accessKey){lookup.elements.orderId.value=linkedOrderId;const cached=readOrders().find(item=>item.id===linkedOrderId);if(cached?.accessKey){lookup.hidden=true;activeLookup={id:linkedOrderId,key:cached.accessKey};refreshPrivateOrder(linkedOrderId,cached.accessKey).then(order=>{showOrder(order);startRefresh()}).catch(()=>showOrder(cached))}}
window.addEventListener('pennybuys:currencychange',()=>{if(visibleOrder)showOrder(visibleOrder)});
