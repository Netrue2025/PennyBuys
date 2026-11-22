const products=window.STORE_PRODUCTS||[];
const bagKey='pennybuys-bag';
const money=value=>window.PennyBuysCurrency?.format(value)||`£${Number(value).toFixed(2)}`;
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function readBag(){try{return JSON.parse(localStorage.getItem(bagKey)||'[]')}catch{return []}}
const bag=readBag().filter(line=>products.some(product=>product.id===line.id)&&Number(line.qty)>0);
const basketCount=document.querySelector('[data-basket-count]');if(basketCount)basketCount.textContent=bag.reduce((sum,line)=>sum+Number(line.qty),0);
const lines=bag.map(line=>({product:products.find(product=>product.id===line.id),qty:Number(line.qty)}));
const subtotal=lines.reduce((sum,line)=>sum+line.product.price*line.qty,0);
const itemCount=lines.reduce((sum,line)=>sum+line.qty,0);
let freeDeliveryCount=0,deliveryConfig={},activeOffer=null;
const empty=document.querySelector('#checkout-empty');
const content=document.querySelector('#checkout-content');
if(new URLSearchParams(location.search).has('cancelled'))window.alert('Payment was cancelled. Your basket is still here whenever you are ready.');
if(!lines.length){empty.hidden=false;}else{
  content.hidden=false;
  function renderCheckoutPrices(){
    const deliveryInfo=window.PennyBuysDelivery.calculate(lines,deliveryConfig,itemCount,freeDeliveryCount);
    const delivery=deliveryInfo.amount;
    const discount=activeOffer?subtotal*Math.min(90,Number(activeOffer.percent)||0)/100:0;
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
  Promise.all([fetch('/api/commercials/active',{cache:'no-store'}),fetch('/api/account/offers',{cache:'no-store'})]).then(async([campaignResponse,offerResponse])=>{
    const campaign=campaignResponse.ok?await campaignResponse.json():{};deliveryConfig=campaign;
    const saved=offerResponse.ok?await offerResponse.json():{};
    freeDeliveryCount=campaign.freeDelivery?.enabled?Math.max(1,Number(campaign.freeDelivery.itemCount)||3):0;
    activeOffer=(saved.offers||[]).find(offer=>offer.status==='accepted')||null;renderCheckoutPrices();
  }).catch(()=>{});
}
document.querySelector('#checkout-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!lines.length||!event.currentTarget.reportValidity())return;
  const submit=event.currentTarget.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;
  try{
    const data=Object.fromEntries(new FormData(event.currentTarget).entries());
    if(document.querySelector('#checkout-push-optin')?.checked){try{await window.PennyBuysPush.subscribe({email:data.email.trim()})}catch(error){console.warn('Order push notifications were not enabled:',error.message)}}
    const response=await fetch('/api/stripe/checkout-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer:{name:data.name.trim(),email:data.email.trim(),phone:data.phone.trim()},items:lines.map(({product,qty})=>({id:product.id,qty}))})});
    const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Secure checkout could not be started.');
    if(!result.url)throw new Error('Stripe did not return a checkout link. Please try again.');location.assign(result.url);
  }catch(error){window.alert(error.message);submit.disabled=false;}
});
