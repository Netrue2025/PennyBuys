const products=window.STORE_PRODUCTS||[];
const bagKey='pennybuys-bag';
const ordersKey='pennybuys-orders';
const money=value=>window.PennyBuysCurrency?.format(value)||`£${Number(value).toFixed(2)}`;
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function readBag(){try{return JSON.parse(localStorage.getItem(bagKey)||'[]')}catch{return []}}
function readOrders(){try{return JSON.parse(localStorage.getItem(ordersKey)||'[]')}catch{return []}}
const bag=readBag().filter(line=>products.some(product=>product.id===line.id)&&Number(line.qty)>0);
const basketCount=document.querySelector('[data-basket-count]');if(basketCount)basketCount.textContent=bag.reduce((sum,line)=>sum+Number(line.qty),0);
const lines=bag.map(line=>({product:products.find(product=>product.id===line.id),qty:Number(line.qty)}));
const subtotal=lines.reduce((sum,line)=>sum+line.product.price*line.qty,0);
const itemCount=lines.reduce((sum,line)=>sum+line.qty,0);
let freeDeliveryCount=0;
let activeOffer=null;
let promotionsPromise=Promise.resolve();
const empty=document.querySelector('#checkout-empty');
const content=document.querySelector('#checkout-content');
if(!lines.length){empty.hidden=false;}else{
  content.hidden=false;
  function renderCheckoutPrices(){
    const delivery=subtotal>=35||(freeDeliveryCount>0&&itemCount>=freeDeliveryCount)?0:3.95;
    const discount=activeOffer?Math.round(subtotal*Math.min(90,Number(activeOffer.percent)||0))/100:0;
    document.querySelector('#checkout-items').innerHTML=lines.map(({product,qty})=>`<div class="checkout-item"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.alt)}"><div><b>${escapeHTML(product.name)}</b><small>Qty ${qty}</small></div><strong>${money(product.price*qty)}</strong></div>`).join('');
    document.querySelector('#checkout-subtotal').textContent=money(subtotal);
    document.querySelector('#checkout-discount-row').hidden=!discount;
    document.querySelector('#checkout-discount-label').textContent=activeOffer?`${activeOffer.title} · You save`:'Saved offer';
    document.querySelector('#checkout-discount').textContent=discount?`−${money(discount)}`:'';
    document.querySelector('#checkout-delivery').textContent=delivery?money(delivery):'Free';
    document.querySelector('#checkout-total').textContent=money(Math.max(0,subtotal-discount)+delivery);
    document.querySelector('#checkout-summary-note').textContent=freeDeliveryCount?`Free delivery on orders over £35 or when you pick ${freeDeliveryCount} items.`:'Free UK delivery on orders over £35.';
  }
  renderCheckoutPrices();
  window.addEventListener('pennybuys:currencychange',renderCheckoutPrices);
  promotionsPromise=Promise.all([fetch('/api/commercials/active',{cache:'no-store'}),fetch('/api/account/offers',{cache:'no-store'})]).then(async([campaignResponse,offerResponse])=>{
    const campaign=campaignResponse.ok?await campaignResponse.json():{};
    const saved=offerResponse.ok?await offerResponse.json():{};
    freeDeliveryCount=campaign.freeDelivery?.enabled?Math.max(1,Number(campaign.freeDelivery.itemCount)||3):0;
    activeOffer=(saved.offers||[]).find(offer=>offer.status==='accepted')||null;
    renderCheckoutPrices();
  }).catch(()=>{});
}
document.querySelector('#checkout-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!lines.length||!event.currentTarget.reportValidity())return;
  const submit=event.currentTarget.querySelector('[type="submit"]');
  if(submit.disabled)return;
  submit.disabled=true;
  try{
    await promotionsPromise;
    if(activeOffer){
      const response=await fetch('/api/account/offers/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({offerId:activeOffer.offerId})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'Your saved offer could not be applied. Refresh your basket and try again.');
    }
    const data=Object.fromEntries(new FormData(event.currentTarget).entries());
    const now=new Date().toISOString();
    const delivery=subtotal>=35||(freeDeliveryCount>0&&itemCount>=freeDeliveryCount)?0:3.95;
    const discount=activeOffer?Math.round(subtotal*Math.min(90,Number(activeOffer.percent)||0))/100:0;
    const order={
      id:`PB-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,
      createdAt:now,status:'processing',trackingNumber:'',
      customer:{name:data.name.trim(),email:data.email.trim(),phone:data.phone.trim()},
      address:{line1:data.address.trim(),line2:data.address2.trim(),city:data.city.trim(),postcode:data.postcode.trim(),country:'United Kingdom'},
      paymentMethod:data.payment,
      items:lines.map(({product,qty})=>({id:product.id,name:product.name,image:product.image,price:product.price,qty})),
      subtotal,discount,offerTitle:activeOffer?.title||'',delivery,total:Math.max(0,subtotal-discount)+delivery,
      history:[{status:'processing',at:now}]
    };
    const orders=readOrders();orders.unshift(order);localStorage.setItem(ordersKey,JSON.stringify(orders));localStorage.removeItem(bagKey);
    const modal=document.querySelector('#order-success');
    document.querySelector('#success-message').textContent=`Order ${order.id} is now being processed. Keep your order number to check delivery updates.`;
    document.querySelector('#success-track-link').href=`order.html?id=${encodeURIComponent(order.id)}`;
    modal.hidden=false;document.querySelector('#success-track-link').focus();
  }catch(error){window.alert(error.message);submit.disabled=false;}
});
function closeSuccess(){document.querySelector('#order-success').hidden=true;}
document.querySelector('#success-close').addEventListener('click',closeSuccess);
document.querySelector('#order-success').addEventListener('click',event=>{if(event.target.id==='order-success')closeSuccess()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeSuccess()});
