const products=window.STORE_PRODUCTS||[];
const bagKey='pennybuys-bag';
const money=value=>window.PennyBuysCurrency?.format(value)||`\u00a3${Number(value).toFixed(2)}`;
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const empty=document.querySelector('#basket-empty');
const content=document.querySelector('#basket-content');
let bag=[];
function readBag(){try{const stored=JSON.parse(localStorage.getItem(bagKey)||'[]');return Array.isArray(stored)?stored.filter(line=>products.some(product=>product.id===line.id)&&Number.isFinite(Number(line.qty))&&Number(line.qty)>0).map(line=>({id:line.id,qty:Math.min(99,Math.floor(Number(line.qty)))})):[]}catch{return []}}
function saveBag(){localStorage.setItem(bagKey,JSON.stringify(bag))}
function renderBasket(){
  bag=readBag();
  const lines=bag.map(line=>({line,product:products.find(product=>product.id===line.id)})).filter(item=>item.product);
  const count=lines.reduce((sum,item)=>sum+item.line.qty,0);
  document.querySelector('#basket-header-count').textContent=count;
  empty.hidden=lines.length>0;content.hidden=lines.length===0;
  if(!lines.length){saveBag();return;}
  document.querySelector('#basket-items').innerHTML=lines.map(({line,product})=>`<article class="basket-item">
    <a class="basket-item-image" href="product.html?id=${encodeURIComponent(product.id)}" aria-label="Preview ${escapeHTML(product.name)}"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.alt||product.name)}"></a>
    <div class="basket-item-details"><span class="basket-category">${escapeHTML(product.category)}</span><h2><a href="product.html?id=${encodeURIComponent(product.id)}">${escapeHTML(product.name)}</a></h2><span class="basket-unit-price">${money(product.price)} each</span>
      <div class="basket-quantity" aria-label="Quantity for ${escapeHTML(product.name)}"><button type="button" data-quantity="${escapeHTML(product.id)}" data-delta="-1" aria-label="Reduce ${escapeHTML(product.name)} quantity">&#8722;</button><output>${line.qty}</output><button type="button" data-quantity="${escapeHTML(product.id)}" data-delta="1" aria-label="Increase ${escapeHTML(product.name)} quantity">+</button></div>
    </div>
    <div class="basket-item-end"><strong>${money(product.price*line.qty)}</strong><button type="button" class="basket-remove" data-remove="${escapeHTML(product.id)}">Remove</button></div>
  </article>`).join('');
  const subtotal=lines.reduce((sum,item)=>sum+item.product.price*item.line.qty,0);
  const delivery=subtotal>=35?0:3.95;
  document.querySelector('#basket-subtotal').textContent=money(subtotal);
  document.querySelector('#basket-delivery').textContent=delivery?money(delivery):'Free';
  document.querySelector('#basket-total').textContent=money(subtotal+delivery);
  saveBag();
}
document.querySelector('#basket-items').addEventListener('click',event=>{
  const quantity=event.target.closest('[data-quantity]');
  if(quantity){const line=bag.find(item=>item.id===quantity.dataset.quantity);if(line){line.qty=Math.min(99,line.qty+Number(quantity.dataset.delta));if(line.qty<1)bag=bag.filter(item=>item!==line);saveBag();renderBasket()}return;}
  const remove=event.target.closest('[data-remove]');if(remove){bag=bag.filter(item=>item.id!==remove.dataset.remove);saveBag();renderBasket();}
});
window.addEventListener('storage',event=>{if(event.key===bagKey)renderBasket()});
window.addEventListener('pennybuys:currencychange',renderBasket);
renderBasket();
