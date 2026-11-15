const products=window.STORE_PRODUCTS||[];
const bagKey='pennybuys-bag';
const ordersKey='pennybuys-orders';
const money=value=>`£${Number(value).toFixed(2)}`;
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function readBag(){try{return JSON.parse(localStorage.getItem(bagKey)||'[]')}catch{return []}}
function readOrders(){try{return JSON.parse(localStorage.getItem(ordersKey)||'[]')}catch{return []}}
const bag=readBag().filter(line=>products.some(product=>product.id===line.id)&&Number(line.qty)>0);
const lines=bag.map(line=>({product:products.find(product=>product.id===line.id),qty:Number(line.qty)}));
const subtotal=lines.reduce((sum,line)=>sum+line.product.price*line.qty,0);
const delivery=subtotal>=35?0:3.95;
const empty=document.querySelector('#checkout-empty');
const content=document.querySelector('#checkout-content');
if(!lines.length){empty.hidden=false;}else{
  content.hidden=false;
  document.querySelector('#checkout-items').innerHTML=lines.map(({product,qty})=>`<div class="checkout-item"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.alt)}"><div><b>${escapeHTML(product.name)}</b><small>Qty ${qty}</small></div><strong>${money(product.price*qty)}</strong></div>`).join('');
  document.querySelector('#checkout-subtotal').textContent=money(subtotal);
  document.querySelector('#checkout-delivery').textContent=delivery?money(delivery):'Free';
  document.querySelector('#checkout-total').textContent=money(subtotal+delivery);
}
document.querySelector('#checkout-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(!lines.length||!event.currentTarget.reportValidity())return;
  const data=Object.fromEntries(new FormData(event.currentTarget).entries());
  const now=new Date().toISOString();
  const order={
    id:`PB-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,
    createdAt:now,status:'processing',trackingNumber:'',
    customer:{name:data.name.trim(),email:data.email.trim(),phone:data.phone.trim()},
    address:{line1:data.address.trim(),line2:data.address2.trim(),city:data.city.trim(),postcode:data.postcode.trim(),country:'United Kingdom'},
    paymentMethod:data.payment,
    items:lines.map(({product,qty})=>({id:product.id,name:product.name,image:product.image,price:product.price,qty})),
    subtotal,delivery,total:subtotal+delivery,
    history:[{status:'processing',at:now}]
  };
  const orders=readOrders();orders.unshift(order);localStorage.setItem(ordersKey,JSON.stringify(orders));localStorage.removeItem(bagKey);
  const modal=document.querySelector('#order-success');
  document.querySelector('#success-message').textContent=`Order ${order.id} is now being processed. Keep your order number to check delivery updates.`;
  document.querySelector('#success-track-link').href=`order.html?id=${encodeURIComponent(order.id)}`;
  modal.hidden=false;document.querySelector('#success-track-link').focus();
});
function closeSuccess(){document.querySelector('#order-success').hidden=true;}
document.querySelector('#success-close').addEventListener('click',closeSuccess);
document.querySelector('#order-success').addEventListener('click',event=>{if(event.target.id==='order-success')closeSuccess()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeSuccess()});
