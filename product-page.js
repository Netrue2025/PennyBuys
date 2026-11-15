const products=window.STORE_PRODUCTS||[];
const id=new URLSearchParams(location.search).get('id');
const product=products.find(item=>item.id===id);
const money=value=>`£${Number(value).toFixed(2)}`;
const bagKey='morrow-market-bag';
const bagCount=document.querySelector('.commerce-bag-count');
function readBag(){try{return JSON.parse(localStorage.getItem(bagKey)||'[]')}catch{return []}}
function updateBagCount(){bagCount.textContent=readBag().reduce((sum,item)=>sum+Number(item.qty||0),0)}
function addProduct(productId,qty=1){const bag=readBag();const line=bag.find(item=>item.id===productId);if(line)line.qty+=qty;else bag.push({id:productId,qty});localStorage.setItem(bagKey,JSON.stringify(bag));updateBagCount()}
updateBagCount();
if(!product){document.querySelector('#product-missing').hidden=false;document.querySelector('.detail-information').hidden=true;document.querySelector('.related-section').hidden=true;}
else{
  document.querySelector('#product-detail').hidden=false;
  document.title=`${product.name} — PennyBuys`;
  document.querySelector('#product-crumb').textContent=product.name;
  document.querySelector('#detail-image').src=product.image;
  document.querySelector('#detail-image').alt=product.alt;
  document.querySelector('#detail-badge').textContent=product.badge;
  document.querySelector('#detail-category').textContent=product.category;
  document.querySelector('#detail-name').textContent=product.name;
  document.querySelector('#detail-rating').textContent=product.rating;
  document.querySelector('#detail-reviews').textContent=`(${product.reviews} reviews)`;
  document.querySelector('#detail-price').innerHTML=`${money(product.price)} ${product.oldPrice?`<del>${money(product.oldPrice)}</del>`:''}`;
  const details={
    crossbody:{description:'Your new everyday companion: a lovely, easy-to-style crossbody with room for the things you like to keep close.',points:['Comfortable adjustable shoulder strap','Secure main compartment','Lightweight for all-day wear'],care:'Wipe gently with a soft, damp cloth. Allow to air dry.'},
    'jewellery-case':{description:'Keep your little treasures together at home and away with this compact, thoughtfully arranged jewellery case.',points:['Compact travel-friendly shape','Separate spaces for small pieces','A thoughtful gift for someone special'],care:'Keep dry and wipe clean with a soft cloth.'},
    'cosmetic-pouch':{description:'A roomy wash bag for weekend escapes and everyday routines, with space for your favourite essentials.',points:['Easy-to-pack shape','Room for daily toiletries','A handy travel companion'],care:'Wipe clean and leave open to dry fully.'},
    candle:{description:'Settle into a slower moment with a softly scented soy candle made for cosy evenings and little rituals.',points:['Soy wax blend','Lovely for gifting','Designed for relaxed evenings'],care:'Trim the wick before each use. Never leave a lit candle unattended.'},
    'weekend-tote':{description:'A dependable carry-all for market mornings, day trips and everything you pick up along the way.',points:['Spacious everyday design','Comfortable shoulder carry','Folds away between trips'],care:'Spot clean gently. Do not bleach.'},
    gloves:{description:'Keep your hands cosy while staying connected with touchscreen-friendly fingertips for everyday use.',points:['Touchscreen-friendly fingertips','Soft, comfortable feel','A useful cold-weather gift'],care:'Follow the garment label. Air dry after washing.'},
    'desk-organiser':{description:'Give your everyday bits a tidy little home and make a calmer corner for work, notes and plans.',points:['Keeps small desk essentials together','Simple, versatile style','A useful home-office gift'],care:'Dust or wipe with a soft dry cloth.'},
    'mini-pouch':{description:'A little zip pouch for small essentials, whether you pop it in your handbag, tote or travel bag.',points:['Compact and easy to carry','Zip closure keeps items together','Useful for travel or daily errands'],care:'Wipe gently with a soft, damp cloth. Allow to air dry.'}
  }[product.id]||{description:product.alt,points:['Thoughtfully selected for everyday use','A lovely gift or treat for yourself','Ready to become one of your everyday favourites'],care:'Wipe clean gently and store in a cool, dry place.'};
  document.querySelector('#detail-description').textContent=details.description;
  document.querySelector('#detail-full-description').textContent=details.description;
  document.querySelector('#detail-highlights').innerHTML=details.points.map(point=>`<li>${point}</li>`).join('');
  document.querySelector('#detail-care').textContent=details.care;
  const related=products.filter(item=>item.id!==product.id&&(item.group===product.group||item.category===product.category)).slice(0,4);
  document.querySelector('#related-grid').innerHTML=related.map(item=>`<a class="related-card" href="product.html?id=${encodeURIComponent(item.id)}"><img src="${item.image}" alt="${item.alt}" loading="lazy"><span>${item.category}</span><b>${item.name}</b><strong>${money(item.price)}</strong></a>`).join('');
  let qty=1;
  document.querySelectorAll('[data-qty-step]').forEach(button=>button.addEventListener('click',()=>{qty=Math.max(1,Math.min(20,qty+Number(button.dataset.qtyStep)));document.querySelector('#detail-qty').value=qty;document.querySelector('#detail-qty').textContent=qty}));
  document.querySelector('#detail-add').addEventListener('click',()=>{addProduct(product.id,qty);const message=document.querySelector('#detail-added');message.textContent=`${qty} × ${product.name} added to your bag.`;document.querySelector('#detail-add').textContent='Added to bag ✓';setTimeout(()=>document.querySelector('#detail-add').textContent='Add to bag',1400)});
}
