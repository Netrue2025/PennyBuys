(() => {
const ordersKey='pennybuys-orders';
const selectedOrderIds=new Set();
let pendingDeleteIds=[];
const statuses=[['processing','Order is being processed'],['packed','Packed and ready for delivery'],['in_transit','On the way for delivery'],['delivered','Delivered']];
const money=value=>`£${Number(value).toFixed(2)}`;
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function readOrders(){try{return JSON.parse(localStorage.getItem(ordersKey)||'[]')}catch{return []}}
function saveOrders(orders){localStorage.setItem(ordersKey,JSON.stringify(orders))}
function formatDate(value){const date=new Date(value);return Number.isNaN(date.valueOf())?'':new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(date)}
function renderOrders(){
  const orders=readOrders();const list=document.querySelector('#admin-orders-list');
  document.querySelector('#admin-no-orders').hidden=orders.length>0;
  list.innerHTML=orders.map(order=>{
    const status=order.status||'processing';
    return `<article class="admin-order-card"><label class="admin-order-select"><input type="checkbox" class="order-history-select" value="${escapeHTML(order.id)}" ${selectedOrderIds.has(order.id)?'checked':''}><span>Select order</span></label><div class="admin-order-top"><div><span>ORDER</span><h2>${escapeHTML(order.id)}</h2><small>Placed ${escapeHTML(formatDate(order.createdAt))}</small></div><a href="order.html?id=${encodeURIComponent(order.id)}" target="_blank" rel="noopener">Customer status page ↗</a></div><div class="admin-order-customer"><b>${escapeHTML(order.customer?.name)}</b><span>${escapeHTML(order.customer?.email)}</span><span>${escapeHTML(order.customer?.phone)}</span><span>${escapeHTML([order.address?.line1,order.address?.city,order.address?.postcode].filter(Boolean).join(', '))}</span></div><div class="admin-order-items">${(order.items||[]).map(item=>`<span>${escapeHTML(item.name)} × ${Number(item.qty)}</span>`).join('')}<b>${money(order.total)}</b></div><form class="admin-update-form" data-order-id="${escapeHTML(order.id)}"><label>Delivery status<select name="status">${statuses.map(([key,label])=>`<option value="${key}" ${key===status?'selected':''}>${label}</option>`).join('')}</select></label><label>Tracking number <small>Shown to customer when status is “On the way for delivery”</small><input name="trackingNumber" maxlength="80" value="${escapeHTML(order.trackingNumber||'')}" placeholder="Enter carrier tracking number"></label><button type="submit" class="commerce-primary">Save update</button></form><p class="admin-update-message" role="status" aria-live="polite"></p></article>`;
  }).join('');
  const selectAll=document.querySelector('#select-all-orders');
  const selectedCount=orders.filter(order=>selectedOrderIds.has(order.id)).length;
  selectAll.checked=orders.length>0&&selectedCount===orders.length;selectAll.indeterminate=selectedCount>0&&selectedCount<orders.length;
  document.querySelector('#selected-order-count').textContent=`${selectedCount} selected`;
  document.querySelector('#delete-selected-orders').disabled=selectedCount===0;
  document.querySelector('#order-count').textContent=orders.length;
  document.querySelector('#nav-order-count').textContent=orders.length;
  window.dispatchEvent(new Event('pennybuys:admin-orders-change'));
}
const list=document.querySelector('#admin-orders-list');
list.addEventListener('change',event=>{const checkbox=event.target.closest('.order-history-select');if(!checkbox)return;if(checkbox.checked)selectedOrderIds.add(checkbox.value);else selectedOrderIds.delete(checkbox.value);renderOrders()});
document.querySelector('#select-all-orders').addEventListener('change',event=>{const ids=readOrders().map(order=>order.id);if(event.currentTarget.checked)ids.forEach(id=>selectedOrderIds.add(id));else ids.forEach(id=>selectedOrderIds.delete(id));renderOrders()});
document.querySelector('#delete-selected-orders').addEventListener('click',()=>{pendingDeleteIds=readOrders().filter(order=>selectedOrderIds.has(order.id)).map(order=>order.id);if(!pendingDeleteIds.length)return;document.querySelector('#delete-orders-message').textContent=`Permanently remove ${pendingDeleteIds.length} selected order${pendingDeleteIds.length===1?'':'s'} from this browser's order history?`;document.querySelector('#delete-orders-dialog').showModal()});
document.querySelector('#confirm-delete-orders').addEventListener('click',()=>{if(!pendingDeleteIds.length)return;const remove=new Set(pendingDeleteIds);saveOrders(readOrders().filter(order=>!remove.has(order.id)));remove.forEach(id=>selectedOrderIds.delete(id));pendingDeleteIds=[];document.querySelector('#delete-orders-dialog').close();renderOrders()});
document.querySelector('#delete-orders-dialog').addEventListener('close',()=>{pendingDeleteIds=[]});
list.addEventListener('submit',event=>{
  const form=event.target.closest('.admin-update-form');if(!form)return;event.preventDefault();
  const data=new FormData(form);const nextStatus=String(data.get('status'));const trackingNumber=String(data.get('trackingNumber')).trim();
  const message=form.parentElement.querySelector('.admin-update-message');
  if(nextStatus==='in_transit'&&!trackingNumber){message.textContent='Add a tracking number before marking this order as on the way.';return}
  const orders=readOrders();const order=orders.find(item=>item.id===form.dataset.orderId);if(!order)return;
  const now=new Date().toISOString();order.status=nextStatus;order.trackingNumber=trackingNumber;order.history=Array.isArray(order.history)?order.history:[];
  if(order.history.at(-1)?.status!==nextStatus)order.history.push({status:nextStatus,at:now});
  order.updatedAt=now;saveOrders(orders);renderOrders();
  const updated=document.querySelector(`[data-order-id="${CSS.escape(form.dataset.orderId)}"]`)?.parentElement.querySelector('.admin-update-message');if(updated)updated.textContent='Order update saved. The customer status page is up to date.';
  const label=statuses.find(([key])=>key===nextStatus)?.[1]||'Order updated';
  document.querySelector('#order-update-modal-message').textContent=`${order.id} is now marked “${label}”. The customer status page is up to date.`;
  document.querySelector('#order-update-dialog').showModal();
});
document.querySelector('#refresh-orders').addEventListener('click',renderOrders);
window.addEventListener('storage',event=>{if(event.key===ordersKey)renderOrders()});
renderOrders();
})();
