const products=window.STORE_PRODUCTS||[];
const id=new URLSearchParams(location.search).get('id');
const product=products.find(item=>item.id===id);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>window.PennyBuysCurrency?.format(value)||`£${Number(value).toFixed(2)}`;
const bagKey='pennybuys-bag';
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
  const detailImage=document.querySelector('#detail-image');
  const demoGallery=products.filter(item=>item.id!==product.id&&(item.group===product.group||item.category===product.category)).map(item=>item.image);
  const productImages=[product.image,...(Array.isArray(product.gallery)?product.gallery:Array.isArray(product.images)?product.images:demoGallery)].filter((image,index,array)=>typeof image==='string'&&image&&array.indexOf(image)===index).slice(0,5);
  const productMedia=productImages.map(src=>({type:'image',src}));
  if(product.video)productMedia.push({type:'video',src:product.video,poster:product.image});
  const thumbnails=document.querySelector('#detail-thumbnails');
  const detailVideo=document.querySelector('#detail-video');
  const imageControls=document.querySelector('#detail-image-controls');
  const imagePosition=document.querySelector('#detail-image-position');
  let activeMediaIndex=0;
  const showMedia=index=>{
    activeMediaIndex=(index+productMedia.length)%productMedia.length;
    const media=productMedia[activeMediaIndex];
    detailVideo.pause();
    if(media.type==='video'){
      detailImage.hidden=true;detailVideo.hidden=false;detailVideo.src=media.src;detailVideo.poster=media.poster;detailVideo.load();
    }else{
      detailVideo.hidden=true;detailVideo.removeAttribute('src');detailVideo.load();detailImage.hidden=false;detailImage.src=media.src;detailImage.alt=`${product.alt} — view ${activeMediaIndex+1}`;
    }
    imagePosition.textContent=`${activeMediaIndex+1} / ${productMedia.length}`;
    imageControls.hidden=productMedia.length<2;
    thumbnails.querySelectorAll('button').forEach((button,buttonIndex)=>{button.classList.toggle('is-active',buttonIndex===activeMediaIndex);button.setAttribute('aria-pressed',String(buttonIndex===activeMediaIndex))});
  };
  thumbnails.innerHTML=productMedia.map((media,index)=>`<button class="detail-thumbnail${media.type==='video'?' detail-thumbnail-video':''}${index===0?' is-active':''}" type="button" aria-label="View ${product.name}, ${media.type==='video'?'video':'image '+(index+1)}" aria-pressed="${index===0}" data-media-index="${index}"><img src="${media.type==='video'?media.poster:media.src}" alt="" loading="lazy">${media.type==='video'?'<span class="thumbnail-play" aria-hidden="true">▶</span><span class="thumbnail-video-label">Video</span>':''}</button>`).join('');
  thumbnails.addEventListener('click',event=>{const button=event.target.closest('[data-media-index]');if(button)showMedia(Number(button.dataset.mediaIndex))});
  document.querySelector('#detail-previous').addEventListener('click',()=>showMedia(activeMediaIndex-1));
  document.querySelector('#detail-next').addEventListener('click',()=>showMedia(activeMediaIndex+1));
  showMedia(0);
  document.querySelector('#detail-badge').textContent=product.badge;
  document.querySelector('#detail-category').textContent=product.category;
  document.querySelector('#detail-name').textContent=product.name;
  document.querySelector('#detail-rating').textContent=product.rating;
  document.querySelector('#detail-reviews').textContent=`(${product.reviews} reviews)`;
  document.querySelector('#detail-price').innerHTML=`${money(product.price)} ${product.oldPrice?`<del>${money(product.oldPrice)}</del>`:''}`;
  if(product.freeDelivery===true){const deliveryNote=document.querySelector('.detail-service p');if(deliveryNote)deliveryNote.innerHTML='<b>Free delivery</b> on this product';}
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
  const productDescription=product.description||details.description;
  document.querySelector('#detail-description').textContent=productDescription;
  document.querySelector('#detail-delivery-returns').textContent=product.deliveryReturns||document.querySelector('#detail-delivery-returns').textContent;
  document.querySelector('#detail-full-description').textContent=productDescription;
  document.querySelector('#detail-highlights').innerHTML=details.points.map(point=>`<li>${point}</li>`).join('');
  document.querySelector('#detail-care').textContent=details.care;
  const renderRelated=()=>{const related=products.filter(item=>item.id!==product.id&&(item.group===product.group||item.category===product.category)).slice(0,4);document.querySelector('#related-grid').innerHTML=related.map(item=>`<a class="related-card" href="product.html?id=${encodeURIComponent(item.id)}"><img src="${item.image}" alt="${item.alt}" loading="lazy"><span>${item.category}</span><b>${item.name}</b><strong>${money(item.price)}</strong></a>`).join('')};
  renderRelated();
  window.addEventListener('pennybuys:currencychange',()=>{document.querySelector('#detail-price').innerHTML=`${money(product.price)} ${product.oldPrice?`<del>${money(product.oldPrice)}</del>`:''}`;renderRelated()});
  window.addEventListener('pennybuys:productavailabilitychange',event=>{const isAvailable=event.detail.products.some(item=>item.id===product.id);document.querySelector('#product-detail').hidden=!isAvailable;document.querySelector('.detail-information').hidden=!isAvailable;document.querySelector('.related-section').hidden=!isAvailable;document.querySelector('#product-missing').hidden=isAvailable;renderRelated()});
  const reviewList=document.querySelector('#product-reviews');
  const reviewMessage=document.querySelector('#review-message');
  const reviewDialog=document.querySelector('#review-dialog');
  const reviewForm=document.querySelector('#review-form');
  const reviewSigninPrompt=document.querySelector('#review-signin-prompt');
  const reviewSigninLink=document.querySelector('#review-signin-link');
  let activeCustomer=null;
  const reviewSession=()=>activeCustomer;
  const loadCustomerSession=async()=>{try{const response=await fetch('/api/auth/session',{cache:'no-store'});const data=await response.json();activeCustomer=response.ok?data.user:null;}catch{activeCustomer=null}return activeCustomer};
  let editingReviewId='';
  const setReviewDialogMode=(review=null)=>{
    const session=reviewSession();
    editingReviewId=review?.reviewId||'';
    document.querySelector('#review-dialog-title').textContent=review?'Edit your review':'Share a review';
    reviewForm.querySelector('[type=submit]').textContent=review?'Save changes':'Publish review';
    reviewForm.hidden=!session?.email;
    reviewSigninPrompt.hidden=Boolean(session?.email);
    reviewSigninLink.href=`signin.html?return=${encodeURIComponent(`product.html?id=${product.id}`)}`;
    reviewMessage.textContent='';
    reviewForm.reset();
    if(session?.email){reviewForm.elements.name.value=review?.name||session.name||'';reviewForm.elements.name.readOnly=true;if(review){reviewForm.elements.rating.value=String(review.rating);reviewForm.elements.text.value=review.text}}
    reviewDialog.showModal();
  };
  document.querySelector('#open-review-modal').addEventListener('click',async()=>{await loadCustomerSession();setReviewDialogMode()});
  document.querySelector('.review-dialog-close').addEventListener('click',()=>reviewDialog.close());
  document.querySelector('#review-cancel').addEventListener('click',()=>reviewDialog.close());
  reviewDialog.addEventListener('click',event=>{if(event.target===reviewDialog)reviewDialog.close()});
  const renderReviews=(reviews,summary=null)=>{
    const count=Number(summary?.count??reviews.length);
    const average=count?(summary?Number(summary.rating):reviews.reduce((sum,review)=>sum+Number(review.rating),0)/count):0;
    const displayRating=count?average.toFixed(1):'5.0';
    document.querySelector('#review-average').textContent=`${displayRating} / 5`;
    document.querySelector('#review-count').textContent=`${count} ${count===1?'review':'reviews'}`;
    product.rating=displayRating;product.reviews=count;
    document.querySelector('#detail-rating').textContent=displayRating;
    document.querySelector('#detail-reviews').textContent=`(${count} ${count===1?'review':'reviews'})`;
    reviewList.innerHTML=count?reviews.map(review=>`<article class="customer-review"><div class="customer-review-top"><strong>${escapeHTML(review.name)}</strong><span class="review-stars" aria-label="${Number(review.rating)} out of 5 stars">${'★'.repeat(Number(review.rating))}${'☆'.repeat(5-Number(review.rating))}</span></div><time>${review.createdAt?new Date(review.createdAt).toLocaleDateString('en-GB'):'Recently'}${review.updatedAt?' · edited':''}</time><p>${escapeHTML(review.text)}</p>${review.canManage?`<div class="customer-review-actions"><button type="button" data-edit-review="${escapeHTML(review.reviewId)}">Edit</button><button type="button" data-delete-review="${escapeHTML(review.reviewId)}">Delete</button></div>`:''}</article>`).join(''):'<p class="no-reviews">No customer reviews yet. Be the first to share your experience.</p>';
  };
  const fetchReviews=async()=>{
    const response=await fetch(`/api/products/${encodeURIComponent(product.id)}/reviews`,{cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Reviews are temporarily unavailable.');
    renderReviews(data.reviews||[],data.summary||null);
  };
  loadCustomerSession().then(fetchReviews).catch(error=>{reviewList.textContent=error.message;document.querySelector('#review-average').textContent=`${product.rating||'5.0'} / 5`;document.querySelector('#review-count').textContent=`${Number(product.reviews)||0} ${Number(product.reviews)===1?'review':'reviews'}`;document.querySelector('#detail-rating').textContent=product.rating||'5.0';});
  reviewList.addEventListener('click',async event=>{
    const editButton=event.target.closest('[data-edit-review]');
    if(editButton){const response=await fetch(`/api/products/${encodeURIComponent(product.id)}/reviews`,{cache:'no-store'});const data=await response.json().catch(()=>({}));const review=data.reviews?.find(item=>item.reviewId===editButton.dataset.editReview&&item.canManage);if(review)setReviewDialogMode(review);return;}
    const deleteButton=event.target.closest('[data-delete-review]');
    if(!deleteButton||!window.confirm('Delete your review?'))return;
    try{const response=await fetch(`/api/products/${encodeURIComponent(product.id)}/reviews/${encodeURIComponent(deleteButton.dataset.deleteReview)}`,{method:'DELETE'});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Your review could not be deleted.');await fetchReviews();}
    catch(error){window.alert(error.message)}
  });
  reviewForm.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;const submit=form.querySelector('button[type=submit]');const session=reviewSession();if(!session?.email){setReviewDialogMode();return;}submit.disabled=true;reviewMessage.textContent=editingReviewId?'Saving your changes...':'Publishing your review...';
    const values=Object.fromEntries(new FormData(form).entries());
    try{const url=`/api/products/${encodeURIComponent(product.id)}/reviews${editingReviewId?`/${encodeURIComponent(editingReviewId)}`:''}`;const response=await fetch(url,{method:editingReviewId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Your review could not be saved.');await fetchReviews();reviewDialog.close();}
    catch(error){reviewMessage.textContent=error.message;}
    finally{submit.disabled=false;}
  });
  let qty=1;
  document.querySelectorAll('[data-qty-step]').forEach(button=>button.addEventListener('click',()=>{qty=Math.max(1,Math.min(20,qty+Number(button.dataset.qtyStep)));document.querySelector('#detail-qty').value=qty;document.querySelector('#detail-qty').textContent=qty}));
  document.querySelector('#detail-add').addEventListener('click',()=>{addProduct(product.id,qty);const message=document.querySelector('#detail-added');message.textContent=`${qty} \u00d7 ${product.name} added to your basket.`;document.querySelector('#detail-add').textContent='Added to basket';setTimeout(()=>document.querySelector('#detail-add').textContent='Add to bag',1400)});
  document.querySelector('#detail-buy').addEventListener('click',()=>{addProduct(product.id,qty);location.href='checkout.html'});
}
