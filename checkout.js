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
let deliveryConfig={};
let activeOffer=null;
let promotionsPromise=Promise.resolve();
const empty=document.querySelector('#checkout-empty');
const content=document.querySelector('#checkout-content');
if(!lines.length){empty.hidden=false;}else{
  content.hidden=false;
  function renderCheckoutPrices(){
    const deliveryInfo=window.PennyBuysDelivery.calculate(lines,itemCount?deliveryConfig:{},itemCount,freeDeliveryCount);
    const delivery=deliveryInfo.amount;
    const discount=activeOffer?Math.round(subtotal*Math.min(90,Number(activeOffer.percent)||0))/100:0;
    document.querySelector('#checkout-items').innerHTML=lines.map(({product,qty})=>`<div class="checkout-item"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.alt)}"><div><b>${escapeHTML(product.name)}</b><small>Qty ${qty}</small></div><strong>${money(product.price*qty)}</strong></div>`).join('');
    document.querySelector('#checkout-subtotal').textContent=money(subtotal);
    document.querySelector('#checkout-discount-row').hidden=!discount;
    document.querySelector('#checkout-discount-label').textContent=activeOffer?`${activeOffer.title} · You save`:'Saved offer';
    document.querySelector('#checkout-discount').textContent=discount?`−${money(discount)}`:'';
    document.querySelector('#checkout-delivery').textContent=delivery?money(delivery):'Free';
    document.querySelector('#checkout-delivery-label').textContent=deliveryInfo.label;
    document.querySelector('#checkout-total').textContent=money(Math.max(0,subtotal-discount)+delivery);
    document.querySelector('#checkout-summary-note').textContent=deliveryInfo.weightPricing?`Basket weight ${deliveryInfo.allWeight.toFixed(2)} kg · ${deliveryInfo.chargeableWeight.toFixed(2)} kg charged at ${money(deliveryInfo.rate)}/kg.`:freeDeliveryCount?`Free delivery on orders over £35 or when you pick ${freeDeliveryCount} items.`:'Free UK delivery on orders over £35.';
  }
  renderCheckoutPrices();
  window.addEventListener('pennybuys:currencychange',renderCheckoutPrices);
  promotionsPromise=Promise.all([fetch('/api/commercials/active',{cache:'no-store'}),fetch('/api/account/offers',{cache:'no-store'})]).then(async([campaignResponse,offerResponse])=>{
    const campaign=campaignResponse.ok?await campaignResponse.json():{};
    deliveryConfig=campaign;
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
    const data=Object.fromEntries(new FormData(event.currentTarget).entries());
    if(document.querySelector('#checkout-push-optin')?.checked){try{await window.PennyBuysPush.subscribe({email:data.email.trim()})}catch(error){console.warn('Order push notifications were not enabled:',error.message)}}
    const now=new Date().toISOString();
    const deliveryInfo=window.PennyBuysDelivery.calculate(lines,deliveryConfig,itemCount,freeDeliveryCount);
    const delivery=deliveryInfo.amount;
    const discount=activeOffer?Math.round(subtotal*Math.min(90,Number(activeOffer.percent)||0))/100:0;
    const order={
      id:`PB-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,
      createdAt:now,status:'processing',trackingNumber:'',
      customer:{name:data.name.trim(),email:data.email.trim(),phone:data.phone.trim()},
      address:{line1:data.address.trim(),line2:data.address2.trim(),city:data.city.trim(),postcode:data.postcode.trim(),country:'United Kingdom'},
      paymentMethod:data.payment,
      items:lines.map(({product,qty})=>({id:product.id,name:product.name,image:product.image,price:product.price,qty,weightKg:Number(product.weightKg)||0.5,freeDelivery:product.freeDelivery===true})),
      subtotal,discount,offerTitle:activeOffer?.title||'',delivery,deliveryWeightKg:deliveryInfo.allWeight,chargeableDeliveryWeightKg:deliveryInfo.chargeableWeight,total:Math.max(0,subtotal-discount)+delivery,
      history:[{status:'processing',at:now}]
    };
    const savedResponse=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order})});
    const savedData=await savedResponse.json().catch(()=>({}));
    if(!savedResponse.ok)throw new Error(savedData.error||'Your order could not be saved. Please try again.');
    Object.assign(order,savedData.order);
    if(activeOffer){
      const response=await fetch('/api/account/offers/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({offerId:activeOffer.offerId})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)console.warn('The saved offer could not be marked as redeemed:',result.error||response.status);
    }
    const orders=readOrders();orders.unshift(order);localStorage.setItem(ordersKey,JSON.stringify(orders));localStorage.removeItem(bagKey);
    const modal=document.querySelector('#order-success');
    document.querySelector('#success-message').textContent=`Order ${order.id} is now being processed. Keep your order number to check delivery updates.`;
    document.querySelector('#success-track-link').href=`order.html?id=${encodeURIComponent(order.id)}&key=${encodeURIComponent(order.accessKey||'')}`;
    modal.hidden=false;document.querySelector('#success-track-link').focus();
  }catch(error){window.alert(error.message);submit.disabled=false;}
});
function closeSuccess(){document.querySelector('#order-success').hidden=true;}
document.querySelector('#success-close').addEventListener('click',closeSuccess);
document.querySelector('#order-success').addEventListener('click',event=>{if(event.target.id==='order-success')closeSuccess()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeSuccess()});
