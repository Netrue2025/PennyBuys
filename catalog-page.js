const catalogProducts=window.STORE_PRODUCTS;
const params=new URLSearchParams(window.location.search);
const searchTerm=params.get('q')?.trim()||'';
const category=params.get('category')||'';
const resultGrid=document.querySelector('#catalog-grid');
const resultCount=document.querySelector('#catalog-result-count');
const emptyState=document.querySelector('#catalog-empty');
const sortControl=document.querySelector('#catalog-sort');
const categoryNames={Bags:'Bags & accessories',Travel:'Travel essentials',Home:'Home & living','Under £20':'Gifts under £20'};
const termAliases={
  bag:['bags','handbag','handbags','purse','crossbody','tote','pouch'],
  bags:['bag','handbag','handbags','purse','crossbody','tote','pouch'],
  gift:['gifts','present','presents','stocking','jewellery','jewelry','candle','gloves','pouch'],
  gifts:['gift','present','presents','stocking','jewellery','jewelry','candle','gloves','pouch'],
  present:['presents','gift','gifts','stocking'],
  presents:['present','gift','gifts','stocking'],
  jewel:['jewellery','jewelry','case','organiser','organizer'],
  travel:['weekender','cosmetic','wash','organiser','organizer','bag'],
  home:['candle','desk','tray','living','comfort'],
  organise:['organiser','organizer','case','pouch'],
  winter:['gloves','cosy','warm','accessory','accessories']
};
const productKeywords={
  crossbody:'handbag purse crossbody shoulder fashion everyday',
  'jewellery-case':'jewellery jewelry organiser organizer case gift present travel',
  'cosmetic-pouch':'cosmetic wash bag toiletry organiser organizer pouch travel weekender gift',
  candle:'candle home cosy cozy decor gift present',
  'weekend-tote':'tote bag handbag weekend travel canvas shopper',
  gloves:'winter warm touchscreen gloves gift stocking',
  'desk-organiser':'desk tray organiser organizer home office gift present',
  'mini-pouch':'pouch bag purse small gift stocking travel'
};
function normalized(value){return value.toLocaleLowerCase('en-GB').replace(/[’']/g,'').replace(/[^a-z0-9£\s]/g,' ').replace(/\s+/g,' ').trim()}
function money(value){return window.PennyBuysCurrency?.format(value)||`£${value.toFixed(2)}`}
function selectedProducts(){
  const query=normalized(searchTerm);
  const hasPriceLimit=/under\s*(?:£\s*)?20|below\s*(?:£\s*)?20|less than\s*(?:£\s*)?20/.test(query);
  const tokens=query.split(' ').filter(word=>word&&!['under','below','less','than','the','for','and','a','an','20'].includes(word));
  const searchable=tokens.flatMap(word=>[word,...(termAliases[word]||[])]);
  return catalogProducts.filter(product=>{
    if(category==='Bags'&&product.group!=='Bags')return false;
    if(category==='Travel'&&product.group!=='Travel')return false;
    if(category==='Home'&&product.group!=='Home')return false;
    if((category==='Under £20'||hasPriceLimit)&&product.price>=20)return false;
    if(!searchable.length)return true;
    const text=normalized(`${product.name} ${product.category} ${product.group} ${product.badge} ${productKeywords[product.id]||''}`);
    return searchable.some(term=>text.includes(normalized(term)));
  });
}
function sortedProducts(list){
  const copy=[...list];
  if(sortControl.value==='price-low')return copy.sort((a,b)=>a.price-b.price);
  if(sortControl.value==='price-high')return copy.sort((a,b)=>b.price-a.price);
  if(sortControl.value==='rating')return copy.sort((a,b)=>Number(b.rating)-Number(a.rating));
  return copy;
}
function renderCatalog(){
  const found=sortedProducts(selectedProducts());
  const currentCategory=categoryNames[category]||'';
  const heading=searchTerm?`Search results for “${searchTerm}”`:currentCategory||'Shop all products';
  document.querySelector('#catalog-title').textContent=heading;
  document.querySelector('#catalog-breadcrumb-current').textContent=heading;
  document.title=`${heading} — PennyBuys`;
  document.querySelector('#catalog-description').textContent=searchTerm?`Products related to ${searchTerm}, picked from our current collection.`:currentCategory?`Browse all ${currentCategory.toLowerCase()} in our current collection.`:'Explore the latest thoughtful finds for everyday living.';
  document.querySelector('#catalog-search-input').value=searchTerm;
  document.querySelector('#catalog-search-category').value=categoryNames[category]?category:'All categories';
  document.querySelectorAll('.catalog-chips [data-category-link]').forEach(link=>link.classList.toggle('active',link.dataset.categoryLink===category));
  resultCount.textContent=`${found.length} ${found.length===1?'find':'finds'}${searchTerm?' related to your search':''}`;
  emptyState.hidden=found.length!==0;
  resultGrid.hidden=found.length===0;
  resultGrid.innerHTML=found.map(product=>`<article class="product-card">
    <div class="product-image"><a class="product-detail-link" href="product.html?id=${encodeURIComponent(product.id)}" aria-label="View ${product.name}"><img src="${product.image}" alt="${product.alt}" loading="lazy"></a><span class="product-badge ${product.oldPrice?'sale':''}">${product.badge}</span><button class="quick-add" data-catalog-add="${product.id}">Add to bag&nbsp; +</button></div>
    <div class="product-info"><div class="product-category">${product.category}</div><h2 class="product-name"><a href="product.html?id=${encodeURIComponent(product.id)}">${product.name}</a></h2><div class="product-bottom"><div class="product-price">${money(product.price)} ${product.oldPrice?`<span class="old-price">${money(product.oldPrice)}</span>`:''}</div><div class="rating">★ ${product.rating} <span>(${product.reviews})</span></div></div></div>
  </article>`).join('');
}
function updateBagCount(){
  try{const bag=JSON.parse(localStorage.getItem('pennybuys-bag')||'[]');document.querySelector('.catalog-basket .bag-count').textContent=bag.reduce((sum,line)=>sum+line.qty,0)}catch{document.querySelector('.catalog-basket .bag-count').textContent='0'}
}
let toastTimer;
function addToBag(id,button){
  try{const bag=JSON.parse(localStorage.getItem('pennybuys-bag')||'[]');const line=bag.find(item=>item.id===id);if(line)line.qty++;else bag.push({id,qty:1});localStorage.setItem('pennybuys-bag',JSON.stringify(bag));updateBagCount();const product=catalogProducts.find(item=>item.id===id);const message=document.querySelector('.catalog-toast');message.textContent=`${product.name} added to your basket`;message.classList.add('is-visible');if(button){const label=button.dataset.defaultLabel||button.textContent;button.dataset.defaultLabel=label;button.classList.add('is-added');button.textContent='Added';window.setTimeout(()=>{button.classList.remove('is-added');button.textContent=label},1300)}clearTimeout(toastTimer);toastTimer=setTimeout(()=>message.classList.remove('is-visible'),2200)}catch{window.alert('Your browser could not save the shopping basket. Please try again.')}
}
document.querySelector('#catalog-search-form').addEventListener('submit',event=>{
  event.preventDefault();const chosen=document.querySelector('#catalog-search-category').value;
  const next=new URLSearchParams();const term=document.querySelector('#catalog-search-input').value.trim();if(term)next.set('q',term);if(categoryNames[chosen])next.set('category',chosen);
  window.location.href=`catalog.html${next.size?`?${next.toString()}`:''}`;
});
sortControl.addEventListener('change',renderCatalog);
resultGrid.addEventListener('click',event=>{const button=event.target.closest('[data-catalog-add]');if(button)addToBag(button.dataset.catalogAdd,button)});
document.querySelectorAll('[data-category-link]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();const chosen=event.currentTarget.dataset.categoryLink;window.location.href=chosen?`catalog.html?category=${encodeURIComponent(chosen)}`:'catalog.html'}));
document.querySelector('.menu-toggle').addEventListener('click',event=>{const menu=document.querySelector('.mobile-menu');const open=!menu.classList.contains('open');menu.classList.toggle('open',open);menu.setAttribute('aria-hidden',String(!open));event.currentTarget.setAttribute('aria-expanded',String(open))});
document.querySelector('.browse-categories').addEventListener('click',()=>document.querySelector('.catalog-chips').scrollIntoView({behavior:'smooth',block:'center'}));
sortControl.value='featured';
renderCatalog();
updateBagCount();
window.addEventListener('pennybuys:currencychange',renderCatalog);
