(() => {
  const tokenKey='pennybuys-admin-session-token';
  const selectedOrderIds=new Set();
  let pendingDeleteIds=[];
  const statuses=[['processing','Order is being processed'],['packed','Packed and ready for delivery'],['in_transit','On the way for delivery'],['delivered','Delivered']];
  const money=value=>window.PennyBuysCurrency?.format(value)||`£${Number(value).toFixed(2)}`;
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const list=document.querySelector('#admin-orders-list');
  let migrationPromise;
  async function api(path,options={}){const token=sessionStorage.getItem(tokenKey)||'';const response=await fetch(path,{...options,headers:{...(options.headers||{}),'x-admin-token':token}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);return data}
  function formatDate(value){const date=new Date(value);return Number.isNaN(date.valueOf())?'':new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(date)}
  function renderOrders(orders){
    document.querySelector('#admin-no-orders').hidden=orders.length>0;
    list.innerHTML=orders.map(order=>{
      const status=order.status||'processing';
      return `<article class="admin-order-card"><label class="admin-order-select"><input type="checkbox" class="order-history-select" value="${escapeHTML(order.id)}" ${selectedOrderIds.has(order.id)?'checked':''}><span>Select order</span></label><div class="admin-order-top"><div><span>ORDER</span><h2>${escapeHTML(order.id)}</h2><small>Placed ${escapeHTML(formatDate(order.createdAt))}</small></div><a href="order.html?id=${encodeURIComponent(order.id)}" target="_blank" rel="noopener">Customer status page ↗</a></div><div class="admin-order-customer"><b>${escapeHTML(order.customer?.name)}</b><span>${escapeHTML(order.customer?.email)}</span><span>${escapeHTML(order.customer?.phone)}</span><span>${escapeHTML([order.address?.line1,order.address?.city,order.address?.postcode].filter(Boolean).join(', '))}</span></div><div class="admin-order-items">${(order.items||[]).map(item=>`<span>${escapeHTML(item.name)} × ${Number(item.qty)}</span>`).join('')}<b>${money(order.total)}</b></div><form class="admin-update-form" data-order-id="${escapeHTML(order.id)}"><label>Delivery status<select name="status">${statuses.map(([key,label])=>`<option value="${key}" ${key===status?'selected':''}>${label}</option>`).join('')}</select></label><label>Tracking number <small>Shown to customer when status is on the way</small><input name="trackingNumber" maxlength="80" value="${escapeHTML(order.trackingNumber||'')}" placeholder="Enter carrier tracking number"></label><button type="submit" class="commerce-primary">Save update</button></form><p class="admin-update-message" role="status" aria-live="polite"></p></article>`;
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
  async function migrateBrowserOrders(){if(localStorage.getItem('pennybuys-orders-migrated-to-mongodb'))return;if(!migrationPromise)migrationPromise=(async()=>{let orders=[];try{orders=JSON.parse(localStorage.getItem('pennybuys-orders')||'[]')}catch{};await api('/api/admin/orders/import-browser-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orders:Array.isArray(orders)?orders:[]})});localStorage.setItem('pennybuys-orders-migrated-to-mongodb','yes')})();return migrationPromise}
  async function loadOrders(){try{await migrateBrowserOrders();const data=await api('/api/admin/orders');const existing=new Set((data.orders||[]).map(order=>order.id));for(const id of selectedOrderIds)if(!existing.has(id))selectedOrderIds.delete(id);renderOrders(data.orders||[])}catch(error){document.querySelector('#admin-no-orders').hidden=true;list.innerHTML=`<div class="inventory-empty">${escapeHTML(error.message)}</div>`}}
  list.addEventListener('change',event=>{const checkbox=event.target.closest('.order-history-select');if(!checkbox)return;if(checkbox.checked)selectedOrderIds.add(checkbox.value);else selectedOrderIds.delete(checkbox.value);loadOrders()});
  document.querySelector('#select-all-orders').addEventListener('change',async event=>{try{const {orders=[]}=await api('/api/admin/orders');if(event.currentTarget.checked)orders.forEach(order=>selectedOrderIds.add(order.id));else orders.forEach(order=>selectedOrderIds.delete(order.id));renderOrders(orders)}catch(error){list.innerHTML=`<div class="inventory-empty">${escapeHTML(error.message)}</div>`}});
  document.querySelector('#delete-selected-orders').addEventListener('click',()=>{pendingDeleteIds=[...selectedOrderIds];if(!pendingDeleteIds.length)return;document.querySelector('#delete-orders-message').textContent=`Permanently remove ${pendingDeleteIds.length} selected order${pendingDeleteIds.length===1?'':'s'} and their status history?`;document.querySelector('#delete-orders-dialog').showModal()});
  document.querySelector('#confirm-delete-orders').addEventListener('click',async event=>{const button=event.currentTarget;if(!pendingDeleteIds.length)return;button.disabled=true;try{await api('/api/admin/orders',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:pendingDeleteIds})});pendingDeleteIds.forEach(id=>selectedOrderIds.delete(id));pendingDeleteIds=[];document.querySelector('#delete-orders-dialog').close();await loadOrders()}catch(error){document.querySelector('#delete-orders-message').textContent=error.message}finally{button.disabled=false}});
  document.querySelector('#delete-orders-dialog').addEventListener('close',()=>{pendingDeleteIds=[]});
  list.addEventListener('submit',async event=>{const form=event.target.closest('.admin-update-form');if(!form)return;event.preventDefault();const data=new FormData(form);const message=form.parentElement.querySelector('.admin-update-message');const button=form.querySelector('[type="submit"]');button.disabled=true;try{await api(`/api/admin/orders/${encodeURIComponent(form.dataset.orderId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:String(data.get('status')),trackingNumber:String(data.get('trackingNumber')).trim()})});await loadOrders();document.querySelector(`[data-order-id="${CSS.escape(form.dataset.orderId)}"]`)?.parentElement.querySelector('.admin-update-message')?.replaceChildren('Order saved. The customer has been notified if browser alerts are enabled.');const label=statuses.find(([key])=>key===data.get('status'))?.[1]||'updated';document.querySelector('#order-update-modal-message').textContent=`${form.dataset.orderId} is now marked ${label}.`;document.querySelector('#order-update-dialog').showModal()}catch(error){message.textContent=error.message;button.disabled=false}});
  document.querySelector('#refresh-orders').addEventListener('click',loadOrders);
  window.addEventListener('storage',event=>{if(event.key===tokenKey)loadOrders()});
  window.addEventListener('pennybuys:currencychange',loadOrders);
  loadOrders();window.setInterval(()=>{if(!document.hidden)loadOrders()},30000);
})();
