const products=window.STORE_PRODUCTS||[];
const deliveryCountry=document.querySelector('#delivery-country');
if(deliveryCountry&&Array.isArray(window.PENNYBUYS_COUNTRY_CODES)){
  const displayName=new Intl.DisplayNames(['en-GB'],{type:'region'});
  const countries=window.PENNYBUYS_COUNTRY_CODES.map(code=>({code,name:displayName.of(code)})).sort((a,b)=>a.name.localeCompare(b.name,'en-GB'));
  const unitedKingdom=countries.find(country=>country.code==='GB');
  const orderedCountries=[unitedKingdom,...countries.filter(country=>country.code!=='GB')];
  deliveryCountry.replaceChildren(...orderedCountries.map(country=>{const option=document.createElement('option');option.value=country.code;option.textContent=country.name;return option}));
  deliveryCountry.value='GB';
}
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
document.querySelector('#checkout-contact-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!lines.length||!event.currentTarget.reportValidity())return;
  const submit=event.currentTarget.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;
  try{
    const data=Object.fromEntries(new FormData(event.currentTarget).entries());
    if(document.querySelector('#checkout-push-optin')?.checked){try{await window.PennyBuysPush.subscribe({email:data.email.trim()})}catch(error){console.warn('Order push notifications were not enabled:',error.message)}}
    const response=await fetch('/api/stripe/checkout-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer:{name:data.name.trim(),email:data.email.trim(),phone:data.phone.trim()},address:{line1:data.addressLine1.trim(),line2:data.addressLine2.trim(),city:data.city.trim(),postcode:data.postcode.trim(),country:data.country},items:lines.map(({product,qty})=>({id:product.id,qty}))})});
    const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Secure checkout could not be started.');
    if(!result.client_secret||!result.publishable_key||!result.order_url)throw new Error('Stripe Checkout is not configured. Add STRIPE_PUBLISHABLE_KEY to the server environment.');
    if(typeof Stripe!=='function')throw new Error('Stripe.js did not load. Refresh the page and try again.');
    const stripe=Stripe(result.publishable_key);
    const appearance={theme:'stripe',labels:'auto',inputs:'spaced',variables:{borderRadius:'4px',colorBackground:'#ffffff',colorDanger:'#df1b41',colorPrimary:'#0570de',colorSuccess:'#00c853',colorText:'#30313d',fontFamily:'Roboto, sans-serif',fontSizeBase:'16px',spacingUnit:'4px'}};
    const checkout=stripe.initCheckoutFormSdk({clientSecret:Promise.resolve(result.client_secret),appearance,fonts:[{cssSrc:'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap'}]});
    const form=checkout.createForm({layout:'expanded'});
    document.querySelector('#checkout-contact-form').hidden=true;
    const panel=document.querySelector('#stripe-payment-panel');panel.hidden=false;
    form.mount('#stripe-checkout-form');
    const actionsResult=await checkout.loadActions();
    if(actionsResult.type!=='success')throw new Error(actionsResult.error?.message||'The secure payment form could not load.');
    form.on('confirm',async confirmEvent=>{
      try{
        const confirmResult=await actionsResult.actions.confirm({formConfirmEvent:confirmEvent});
        if(confirmResult.type==='error'){
          const error=document.querySelector('#stripe-checkout-error');error.textContent=confirmResult.error.message;error.hidden=false;return;
        }
        localStorage.removeItem(bagKey);
        window.location.assign(result.order_url);
      }catch(error){const message=document.querySelector('#stripe-checkout-error');message.textContent=error.message||'Payment could not be completed.';message.hidden=false}
    });
  }catch(error){window.alert(error.message);document.querySelector('#checkout-contact-form').hidden=false;document.querySelector('#stripe-payment-panel').hidden=true;submit.disabled=false;}
});
