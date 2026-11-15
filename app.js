const products=window.STORE_PRODUCTS;
const grid=document.querySelector('#product-grid');
const tabs=[...document.querySelectorAll('.product-tabs button')];
document.querySelector('.drawer-header h2')?.insertAdjacentHTML('afterbegin','<svg class="bag-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg>');
const cartKey='morrow-market-bag';
let activeFilter='All';
let query='';
let bag=readBag();
let toastTimer;

function readBag(){try{return JSON.parse(localStorage.getItem(cartKey)||'[]')}catch{return []}}
function saveBag(){localStorage.setItem(cartKey,JSON.stringify(bag))}
function money(value){return `£${value.toFixed(2)}`}
function visibleProducts(){return products.filter(p=>{
  const matchesFilter=activeFilter==='All'||(activeFilter==='Under £20'?p.price<20:p.group===activeFilter);
  const haystack=`${p.name} ${p.category} ${p.group} ${p.badge}`.toLowerCase();
  return matchesFilter&&haystack.includes(query.toLowerCase());
})}
function renderProducts(){
  const shown=visibleProducts();
  grid.innerHTML=shown.length?shown.map(p=>`<article class="product-card">
    <div class="product-image"><a class="product-detail-link" href="product.html?id=${encodeURIComponent(p.id)}" aria-label="View ${p.name}"><img src="${p.image}" alt="${p.alt}" loading="lazy"></a><span class="product-badge ${p.oldPrice?'sale':''}">${p.badge}</span><button class="wish-button" aria-label="Save ${p.name}" aria-pressed="false">♡</button><button class="quick-add" data-add="${p.id}">Quick add&nbsp; +</button></div>
    <div class="product-info"><div class="product-category">${p.category}</div><h3 class="product-name"><a href="product.html?id=${encodeURIComponent(p.id)}">${p.name}</a></h3><div class="product-bottom"><div class="product-price">${money(p.price)} ${p.oldPrice?`<span class="old-price">${money(p.oldPrice)}</span>`:''}</div><div class="rating">★ ${p.rating} <span>(${p.reviews})</span></div></div></div>
  </article>`).join(''):`<div class="no-results"><b>No lovely finds just yet.</b><p>Try a different search or browse everything.</p><button class="text-link clear-search">Clear search <span>→</span></button></div>`;
}
function setFilter(filter){
  activeFilter=filter;
  tabs.forEach(tab=>{const active=tab.dataset.filter===filter;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active))});
  renderProducts();
  document.querySelector('#shop').scrollIntoView({behavior:'smooth'});
}
function toast(message){const el=document.querySelector('.toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2300)}
function updateBag(){
  const count=bag.reduce((sum,line)=>sum+line.qty,0);
  document.querySelector('.bag-count').textContent=count;
  document.querySelector('.drawer-count').textContent=`(${count})`;
  const items=document.querySelector('.cart-items');
  items.innerHTML=bag.map(line=>{const p=products.find(item=>item.id===line.id);if(!p)return '';return `<div class="cart-line"><img src="${p.image}" alt="${p.alt}"><div><h4>${p.name}</h4><small>${p.category}</small><div class="quantity"><button data-qty="${p.id}" data-change="-1" aria-label="Remove one ${p.name}">−</button><span>${line.qty}</span><button data-qty="${p.id}" data-change="1" aria-label="Add one ${p.name}">+</button></div></div><div><div class="line-price">${money(p.price*line.qty)}</div><button class="remove-line" data-remove="${p.id}">Remove</button></div></div>`}).join('');
  const total=bag.reduce((sum,line)=>sum+(products.find(p=>p.id===line.id)?.price||0)*line.qty,0);
  const remaining=Math.max(35-total,0);
  document.querySelector('.cart-subtotal').textContent=money(total);
  document.querySelector('.shipping-message').innerHTML=remaining?`You’re <b>${money(remaining)}</b> away from free UK delivery`:'Lovely! You’ve unlocked <b>free UK delivery</b>.';
  document.querySelector('.progress-track span').style.width=`${Math.min(total/35*100,100)}%`;
  document.querySelector('.cart-empty').style.display=count?'none':'block';
  document.querySelector('.cart-footer').classList.toggle('hidden',!count);
  saveBag();
}
function openBag(){document.querySelector('.cart-drawer').classList.add('open');document.querySelector('.overlay').classList.add('open');document.body.classList.add('drawer-open');document.querySelector('.cart-drawer').setAttribute('aria-hidden','false')}
function closeBag(){document.querySelector('.cart-drawer').classList.remove('open');document.querySelector('.overlay').classList.remove('open');document.body.classList.remove('drawer-open');document.querySelector('.cart-drawer').setAttribute('aria-hidden','true')}
function addToBag(id){const line=bag.find(item=>item.id===id);if(line)line.qty++;else bag.push({id,qty:1});updateBag();const p=products.find(item=>item.id===id);toast(`${p.name} added to your bag`)}
function navigateToCatalog({term='',category=''}={}){const params=new URLSearchParams();if(term.trim())params.set('q',term.trim());if(category)params.set('category',category);window.location.href=`catalog.html${params.size?`?${params.toString()}`:''}`}
function runSearch(value){navigateToCatalog({term:value});}

renderProducts();updateBag();
document.addEventListener('click',event=>{
  const add=event.target.closest('[data-add]');if(add){addToBag(add.dataset.add);return}
  const tab=event.target.closest('[data-filter]');if(tab){setFilter(tab.dataset.filter);return}
  const category=event.target.closest('[data-category]');if(category){event.preventDefault();navigateToCatalog({category:category.dataset.category});return}
  const nav=event.target.closest('[data-nav-filter]');if(nav){event.preventDefault();navigateToCatalog({category:nav.dataset.navFilter});document.querySelector('.mobile-menu').classList.remove('open');return}
  const wish=event.target.closest('.wish-button');if(wish){wish.classList.toggle('active');wish.textContent=wish.classList.contains('active')?'♥':'♡';wish.setAttribute('aria-pressed',String(wish.classList.contains('active')));toast(wish.classList.contains('active')?'Saved to your favourites':'Removed from your favourites');return}
  const change=event.target.closest('[data-qty]');if(change){const line=bag.find(item=>item.id===change.dataset.qty);if(line){line.qty+=Number(change.dataset.change);if(line.qty<1)bag=bag.filter(item=>item!==line);updateBag()}return}
  const remove=event.target.closest('[data-remove]');if(remove){bag=bag.filter(item=>item.id!==remove.dataset.remove);updateBag();return}
  const suggestion=event.target.closest('[data-search]');if(suggestion){runSearch(suggestion.dataset.search);return}
  if(event.target.closest('.clear-search')){query='';document.querySelector('#search-input').value='';renderProducts();return}
});
document.querySelector('.bag-button').addEventListener('click',openBag);
document.querySelector('.drawer-close').addEventListener('click',closeBag);
document.querySelector('.overlay').addEventListener('click',closeBag);
document.querySelectorAll('.continue-shopping,.continue-shopping-text').forEach(button=>button.addEventListener('click',closeBag));
document.querySelector('.checkout-button').addEventListener('click',()=>{window.location.href='checkout.html'});
document.querySelector('.account-button').addEventListener('click',()=>{window.location.href='order.html'});
document.querySelector('.search-close').addEventListener('click',()=>{document.querySelector('.search-panel').classList.remove('open');document.querySelector('.search-panel').setAttribute('aria-hidden','true')});
document.querySelector('#search-form').addEventListener('submit',event=>{event.preventDefault();runSearch(document.querySelector('#search-input').value)});
document.querySelector('#site-search-form').addEventListener('submit',event=>{event.preventDefault();const selected=event.currentTarget.querySelector('select').value;const category=selected==='Bags & accessories'?'Bags':selected==='Home & living'?'Home':selected==='Gifts'?'Under £20':'';navigateToCatalog({term:document.querySelector('#header-search-input').value,category})});
document.querySelector('.advanced-search').addEventListener('click',()=>{const panel=document.querySelector('.search-panel');panel.classList.add('open');panel.setAttribute('aria-hidden','false');document.querySelector('#search-input').focus()});
document.querySelector('.browse-categories').addEventListener('click',()=>document.querySelector('#categories').scrollIntoView({behavior:'smooth'}));
document.querySelector('#newsletter-form').addEventListener('submit',event=>{event.preventDefault();const email=document.querySelector('#email').value;document.querySelector('.newsletter-success').textContent=`You're on the list. See you in your inbox, ${email}!`;event.currentTarget.reset()});
document.querySelector('.menu-toggle').addEventListener('click',event=>{const menu=document.querySelector('.mobile-menu');const open=!menu.classList.contains('open');menu.classList.toggle('open',open);menu.setAttribute('aria-hidden',String(!open));event.currentTarget.setAttribute('aria-expanded',String(open))});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeBag();document.querySelector('.search-panel').classList.remove('open');document.querySelector('.mobile-menu').classList.remove('open')}});

const heroCarousel=document.querySelector('[data-carousel]');
if(heroCarousel){
  const slides=[...heroCarousel.querySelectorAll('.hero-slide')];
  const dots=[...heroCarousel.querySelectorAll('.hero-dots button')];
  const playPause=heroCarousel.querySelector('.hero-autoplay');
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let currentSlide=0;
  let manuallyPaused=reducedMotion.matches;
  let pointerInside=false;
  let focusInside=false;
  const renderSlide=index=>{
    currentSlide=(index+slides.length)%slides.length;
    slides.forEach((slide,i)=>{const active=i===currentSlide;slide.classList.toggle('is-active',active);slide.setAttribute('aria-hidden',String(!active));if(active)slide.removeAttribute('inert');else slide.setAttribute('inert','')});
    dots.forEach((dot,i)=>{const active=i===currentSlide;dot.classList.toggle('is-active',active);if(active)dot.setAttribute('aria-current','true');else dot.removeAttribute('aria-current')});
  };
  const syncAutoPlay=()=>{
    const paused=manuallyPaused||pointerInside||focusInside||document.hidden;
    playPause.innerHTML=manuallyPaused?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
    playPause.setAttribute('aria-label',manuallyPaused?'Resume automatic slides':'Pause automatic slides');
    playPause.setAttribute('aria-pressed',String(manuallyPaused));
    return !paused;
  };
  heroCarousel.querySelector('.hero-previous').addEventListener('click',()=>renderSlide(currentSlide-1));
  heroCarousel.querySelector('.hero-next').addEventListener('click',()=>renderSlide(currentSlide+1));
  dots.forEach((dot,index)=>dot.addEventListener('click',()=>renderSlide(index)));
  playPause.addEventListener('click',()=>{manuallyPaused=!manuallyPaused;if(!manuallyPaused){pointerInside=false;focusInside=false}syncAutoPlay()});
  heroCarousel.addEventListener('pointerenter',()=>{pointerInside=true;syncAutoPlay()});
  heroCarousel.addEventListener('pointerleave',()=>{pointerInside=false;syncAutoPlay()});
  heroCarousel.addEventListener('focusin',()=>{focusInside=true;syncAutoPlay()});
  heroCarousel.addEventListener('focusout',event=>{if(!heroCarousel.contains(event.relatedTarget)){focusInside=false;syncAutoPlay()}});
  document.addEventListener('visibilitychange',syncAutoPlay);
  window.setInterval(()=>{if(syncAutoPlay())renderSlide(currentSlide+1)},5000);
}
