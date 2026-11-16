const tokenKey='pennybuys-admin-session-token';
const loginPanel=document.querySelector('#admin-login');
const dashboard=document.querySelector('#admin-dashboard');
const tokenInput=document.querySelector('#admin-token');
const loginMessage=document.querySelector('#login-message');
const serviceStatus=document.querySelector('#service-status');
const productList=document.querySelector('#product-list');
const productCount=document.querySelector('#product-count');
const subscriberList=document.querySelector('#subscriber-list');
const subscriberCount=document.querySelector('#subscriber-count');
const subscriberMessage=document.querySelector('#subscriber-message');
const adminReviewList=document.querySelector('#admin-review-list');
const adminReviewCount=document.querySelector('#admin-review-count');
const adminReviewMessage=document.querySelector('#admin-review-message');
const productForm=document.querySelector('#product-form');
const productMessage=document.querySelector('#product-message');
const imageInput=productForm.elements.images;
const videoInput=productForm.elements.video;
const existingMedia=document.querySelector('#existing-media');
const removeVideoWrap=document.querySelector('#remove-video-wrap');
const imageList=document.querySelector('#existing-image-list');
const videoPreview=document.querySelector('#existing-video-preview');
let adminToken=sessionStorage.getItem(tokenKey)||'';
let catalogProducts=[];
let editingId='';
let mediaItems=[];
let currentVideoUrl='';
let serviceStatusTimer;
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function showLogin(message=''){
  loginPanel.hidden=false;dashboard.hidden=true;document.querySelector('#admin-logout').hidden=true;
  loginMessage.textContent=message;loginMessage.classList.remove('success');
}
function showDashboard(){
  loginPanel.hidden=true;dashboard.hidden=false;document.querySelector('#admin-logout').hidden=false;
  document.querySelector('#admin-user-state').textContent='MongoDB secured';
  if(location.hash)requestAnimationFrame(()=>document.querySelector(location.hash)?.scrollIntoView({behavior:'smooth',block:'start'}));
}
async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{...(options.headers||{}),'x-admin-token':adminToken}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
  if(path==='/api/products'&&response.headers.get('X-Catalog-Source')==='demo')throw new Error('MongoDB is unreachable. The products shown in the storefront are demo fallback data, so edits and deletes cannot be saved. Check MONGODB_URI and the Railway MongoDB connection.');
  return data;
}
function renderProducts(products){
  catalogProducts=products;
  productCount.textContent=products.length;
  document.querySelector('#nav-product-count').textContent=products.length;
  const query=(document.querySelector('#product-search')?.value||'').trim().toLocaleLowerCase('en-GB');
  const filtered=products.filter(product=>!query||`${product.name} ${product.category} ${product.group||''} ${product.description||''}`.toLocaleLowerCase('en-GB').includes(query));
  productList.innerHTML=filtered.length?filtered.map(product=>`<article class="inventory-card"><img src="${escapeHTML(product.image)}" alt="" loading="lazy"><div><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.category)}${product.video?' | video':''}</p><small>Stock: ${Number(product.inventory??0)} | ${Number(product.weightKg??0.5)} kg | ${product.freeDelivery?'Free delivery | ':''}${Number(product.gallery?.length||0)+1} image${product.gallery?.length?'s':''}</small></div><strong>GBP ${Number(product.price).toFixed(2)}</strong><div class="inventory-actions"><button class="quiet-button" type="button" data-edit-id="${escapeHTML(product.id)}" aria-label="Edit ${escapeHTML(product.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4zM14.8 5.7l3.5 3.5"/></svg><span>Edit</span></button><button class="delete-button" type="button" data-delete-id="${escapeHTML(product.id)}" aria-label="Delete ${escapeHTML(product.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg><span>Delete</span></button></div></article>`).join(''):'<div class="inventory-empty">'+(products.length?'No products match that search. Try another name or category.':'No products yet.')+'</div>';
  window.dispatchEvent(new CustomEvent('pennybuys:adminproductschange',{detail:{products}}));
}
async function loadProducts(){renderProducts(await api('/api/products'));}
async function loadSubscribers(){
  subscriberMessage.textContent='Loading subscribers...';
  try{const data=await api('/api/admin/newsletter-subscriptions');const subscriptions=data.subscriptions||[];subscriberCount.textContent=subscriptions.length;document.querySelector('#nav-subscriber-count').textContent=subscriptions.length;subscriberList.innerHTML=subscriptions.length?subscriptions.map(item=>`<article class="subscriber-row"><a href="mailto:${encodeURIComponent(item.email)}">${escapeHTML(item.email)}</a><time>${item.subscribedAt?new Date(item.subscribedAt).toLocaleDateString('en-GB'):'?'}</time></article>`).join(''):'<div class="inventory-empty">No newsletter subscribers yet.</div>';subscriberMessage.textContent='';window.dispatchEvent(new CustomEvent('pennybuys:adminsubscriberschange',{detail:{count:subscriptions.length}}));}
  catch(error){subscriberList.replaceChildren();subscriberMessage.textContent=error.message;}
}
async function loadReviews(){
  adminReviewMessage.textContent='Loading reviews...';
  try{
    const data=await api('/api/admin/reviews');
    const reviews=data.reviews||[];
    adminReviewCount.textContent=reviews.length;
    document.querySelector('#nav-review-count').textContent=reviews.length;
    document.querySelector('#overview-reviews').textContent=reviews.length;
    adminReviewList.innerHTML=reviews.length?reviews.map(review=>{
      const product=catalogProducts.find(item=>item.id===review.productId);
      return `<article class="admin-review-card"><div class="admin-review-card-top"><div><span>${escapeHTML(product?.name||'Product removed')}</span><b class="review-stars" aria-label="${Number(review.rating)} out of 5 stars">${'★'.repeat(Number(review.rating))}${'☆'.repeat(5-Number(review.rating))}</b></div><time>${review.createdAt?new Date(review.createdAt).toLocaleDateString('en-GB'):'Recently'}</time></div><strong>${escapeHTML(review.name)}</strong><p>${escapeHTML(review.text)}</p><div class="admin-review-card-actions"><a href="product.html?id=${encodeURIComponent(review.productId)}#review-heading" target="_blank" rel="noopener">View on storefront <span aria-hidden="true">↗</span></a><button type="button" class="delete-button" data-admin-delete-review="${escapeHTML(review.reviewId)}">Delete review</button></div></article>`;
    }).join(''):'<div class="inventory-empty">No customer reviews yet.</div>';
    adminReviewMessage.textContent='';
  }catch(error){adminReviewList.replaceChildren();adminReviewMessage.textContent=error.message;}
}
async function loadCommercials(){
  const form=document.querySelector('#commercials-form');
  if(!form)return;
  const message=document.querySelector('#commercials-message');
  try{
    const config=await api('/api/admin/commercials');
    form.elements.discountEnabled.checked=config.discount?.enabled===true;
    form.elements.discountTitle.value=config.discount?.title||'';
    form.elements.discountPercent.value=config.discount?.percent||10;
    form.elements.intervalMinutes.value=config.discount?.intervalMinutes||(Number(config.discount?.intervalHours)||24)*60;
    form.elements.deliveryEnabled.checked=config.freeDelivery?.enabled===true;
    form.elements.deliveryTitle.value=config.freeDelivery?.title||'';
    form.elements.itemCount.value=config.freeDelivery?.itemCount||3;
    form.elements.weightDeliveryEnabled.checked=config.weightDelivery?.enabled===true;
    form.elements.ratePerKg.value=config.weightDelivery?.ratePerKg??0;
    form.elements.announcements.value=Array.isArray(config.announcements)?config.announcements.join('\n'):'';
    message.textContent='';
  }catch(error){message.textContent=error.message;}
}
async function connectAdmin(candidate){
  adminToken=candidate;
  const status=await api('/api/admin/status');
  if(!status.mongoConnected)throw new Error(`Product management needs a live MongoDB connection. ${status.mongoMessage||'Check MONGODB_URI and the database network access list.'}`);
  sessionStorage.setItem(tokenKey,adminToken);
  showDashboard();
  const ready=status.mongoConnected&&status.cloudinaryConfigured;
  window.clearTimeout(serviceStatusTimer);
  serviceStatus.hidden=false;
  serviceStatus.classList.remove('is-disappearing');
  serviceStatus.classList.toggle('ready',ready);
  serviceStatus.innerHTML=`<strong>${ready?'Services ready':'Setup needed'}</strong><span>MongoDB: ${status.mongoConnected?'connected':escapeHTML(status.mongoMessage||'not connected')}</span><span>Cloudinary: ${status.cloudinaryConfigured?'configured':'not configured'}</span>${status.cloudinaryConfigured?'':'<span>Set Cloudinary credentials in your server environment before uploading.</span>'}`;
  if(ready)serviceStatusTimer=window.setTimeout(()=>{serviceStatus.classList.add('is-disappearing');window.setTimeout(()=>{serviceStatus.hidden=true},420)},6000);
  await loadProducts();
  await loadSubscribers();
  await loadReviews();
  await loadCommercials();
  window.dispatchEvent(new Event('pennybuys:adminready'));
}
function cancelEdit(){
  editingId='';productForm.reset();productForm.elements.group.value='';
  productForm.dataset.editId='';imageInput.required=false;removeVideoWrap.hidden=true;existingMedia.hidden=true;
  mediaItems=[];currentVideoUrl='';imageList.replaceChildren();videoPreview.replaceChildren();
  document.querySelector('#form-title').textContent='Add a product';
  document.querySelector('#save-product').textContent='Upload and add product';
  document.querySelector('#cancel-edit').hidden=true;
  document.querySelector('#image-preview').replaceChildren();
  productMessage.textContent='';productMessage.classList.remove('success');
  window.dispatchEvent(new Event('pennybuys:productcancel'));
}
function editProduct(product){
  editingId=product.id;productForm.dataset.editId=product.id;
  productForm.elements.name.value=product.name||'';
  productForm.elements.price.value=product.price??'';
  productForm.elements.inventory.value=product.inventory??0;
  productForm.elements.weightKg.value=product.weightKg??0.5;
  productForm.elements.freeDelivery.checked=product.freeDelivery===true;
  productForm.elements.description.value=product.description||'';
  productForm.elements.deliveryReturns.value=product.deliveryReturns||'';
  const categorySelect=productForm.elements.category;
  let option=[...categorySelect.options].find(item=>item.value===product.category);
  if(!option){option=new Option(product.category,product.category);option.dataset.group=product.group||'';categorySelect.add(option)}
  categorySelect.value=product.category||'';productForm.elements.group.value=product.group||option.dataset.group||'';
  imageInput.required=false;imageInput.value='';videoInput.value='';productForm.elements.removeVideo.checked=false;
  mediaItems=[product.image,...(Array.isArray(product.gallery)?product.gallery:[])].filter(Boolean).map(url=>({kind:'existing',url}));
  currentVideoUrl=product.video||'';
  document.querySelector('#image-preview').replaceChildren();renderMediaEditor();
  document.querySelector('#form-title').textContent=`Edit ${product.name}`;
  document.querySelector('#save-product').textContent='Save product changes';
  document.querySelector('#cancel-edit').hidden=false;
  productMessage.textContent='';productMessage.classList.remove('success');
  window.dispatchEvent(new Event('pennybuys:productedit'));
  productForm.scrollIntoView({behavior:'smooth',block:'start'});
}
function renderMediaEditor(){
  existingMedia.hidden=!mediaItems.length&&!currentVideoUrl&&!videoInput.files.length;
  imageList.innerHTML=mediaItems.map((item,index)=>`<article class="media-item"><img src="${escapeHTML(item.kind==='existing'?item.url:item.preview)}" alt="Product image ${index+1}" loading="lazy"><div class="media-item-info"><b>${index===0?'Storefront preview':`Image ${index+1}`}</b><span>${item.kind==='existing'?'Current image':'New upload'}</span></div><div class="media-item-actions"><button type="button" class="quiet-button" data-media-action="up" data-index="${index}" aria-label="Move image ${index+1} earlier" ${index===0?'disabled':''}>Up</button><button type="button" class="quiet-button" data-media-action="down" data-index="${index}" aria-label="Move image ${index+1} later" ${index===mediaItems.length-1?'disabled':''}>Down</button><button type="button" class="delete-button" data-media-action="remove" data-index="${index}">Remove</button></div></article>`).join('');
  if(videoInput.files[0]){
    const src=URL.createObjectURL(videoInput.files[0]);videoPreview.innerHTML=`<div class="media-video-card"><video controls playsinline preload="metadata" src="${src}"></video><div><b>New video selected</b><button class="delete-button" type="button" data-video-remove>Remove video</button></div></div>`;
  }else if(currentVideoUrl){
    videoPreview.innerHTML=`<div class="media-video-card"><video controls playsinline preload="metadata" src="${escapeHTML(currentVideoUrl)}"></video><div><b>Current product video</b><button class="delete-button" type="button" data-video-remove>Remove video</button></div></div>`;
  }else videoPreview.replaceChildren();
}
existingMedia.addEventListener('click',event=>{
  const action=event.target.closest('[data-media-action]');
  if(action){const index=Number(action.dataset.index);if(action.dataset.mediaAction==='remove')mediaItems.splice(index,1);else{const target=index+(action.dataset.mediaAction==='up'?-1:1);if(target>=0&&target<mediaItems.length)[mediaItems[index],mediaItems[target]]=[mediaItems[target],mediaItems[index]]}renderMediaEditor();return;}
  if(event.target.closest('[data-video-remove]')){currentVideoUrl='';videoInput.value='';productForm.elements.removeVideo.checked=true;renderMediaEditor();}
});
document.querySelector('#admin-login-form').addEventListener('submit',async event=>{
  event.preventDefault();loginMessage.textContent='Checking access...';
  try{await connectAdmin(tokenInput.value.trim());loginMessage.textContent='';}
  catch(error){showLogin(error.message);adminToken='';sessionStorage.removeItem(tokenKey);}
});
document.querySelector('#admin-logout').addEventListener('click',()=>{sessionStorage.removeItem(tokenKey);adminToken='';showLogin('You have signed out.')});
document.querySelector('#commercials-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const message=document.querySelector('#commercials-message');
  const submit=form.querySelector('[type="submit"]');
  submit.disabled=true;message.textContent='Saving commercial settings...';message.classList.remove('success');
  const body={discount:{enabled:form.elements.discountEnabled.checked,title:form.elements.discountTitle.value.trim(),percent:Number(form.elements.discountPercent.value),intervalMinutes:Number(form.elements.intervalMinutes.value)},freeDelivery:{enabled:form.elements.deliveryEnabled.checked,title:form.elements.deliveryTitle.value.trim(),itemCount:Number(form.elements.itemCount.value)},weightDelivery:{enabled:form.elements.weightDeliveryEnabled.checked,ratePerKg:Number(form.elements.ratePerKg.value)},announcements:form.elements.announcements.value.split(/\r?\n/).map(message=>message.trim()).filter(Boolean)};
  try{await api('/api/admin/commercials',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});message.textContent='Commercial settings saved.';message.classList.add('success');window.dispatchEvent(new Event('pennybuys:commercialschanged'));}
  catch(error){message.textContent=error.message;}
  finally{submit.disabled=false;}
});
document.querySelector('#refresh-subscribers').addEventListener('click',loadSubscribers);
document.querySelector('#refresh-reviews').addEventListener('click',loadReviews);
adminReviewList.addEventListener('click',async event=>{
  const button=event.target.closest('[data-admin-delete-review]');
  if(!button||!window.confirm('Remove this review from the storefront?'))return;
  button.disabled=true;
  try{await api(`/api/admin/reviews/${encodeURIComponent(button.dataset.adminDeleteReview)}`,{method:'DELETE'});await loadReviews();}
  catch(error){adminReviewMessage.textContent=error.message;button.disabled=false;}
});
document.querySelector('#refresh-products').addEventListener('click',async event=>{
  event.currentTarget.disabled=true;
  try{await loadProducts();}catch(error){productMessage.textContent=error.message;}
  event.currentTarget.disabled=false;
});
document.querySelector('#cancel-edit').addEventListener('click',cancelEdit);
window.addEventListener('pennybuys:startnewproduct',cancelEdit);
let pendingDeleteProduct=null;
const deleteDialog=document.querySelector('#delete-product-dialog');
const confirmDeleteButton=document.querySelector('#confirm-delete-product');
productList.addEventListener('click',async event=>{
  const editButton=event.target.closest('[data-edit-id]');
  if(editButton){const product=catalogProducts.find(item=>item.id===editButton.dataset.editId);if(product)editProduct(product);return;}
  const deleteButton=event.target.closest('[data-delete-id]');
  if(!deleteButton)return;
  const product=catalogProducts.find(item=>item.id===deleteButton.dataset.deleteId);
  if(!product)return;
  pendingDeleteProduct=product;
  document.querySelector('#delete-product-name').textContent=product.name;
  document.querySelector('#delete-message').textContent='';
  deleteDialog.showModal();
});
window.addEventListener('pennybuys:adminproductsearch',()=>renderProducts(catalogProducts));
confirmDeleteButton.addEventListener('click',async()=>{
  const product=pendingDeleteProduct;
  if(!product)return;
  confirmDeleteButton.disabled=true;
  document.querySelector('#delete-message').textContent='Deleting product...';
  try{
    const response=await api(`/api/products/${encodeURIComponent(product.id)}`,{method:'DELETE'});
    if(editingId===product.id)cancelEdit();
    renderProducts(response.products);productMessage.textContent=`${product.name} was deleted.`;productMessage.classList.add('success');
    deleteDialog.close();
  }catch(error){document.querySelector('#delete-message').textContent=error.message;}
  finally{confirmDeleteButton.disabled=false;}
});
deleteDialog.addEventListener('close',()=>{pendingDeleteProduct=null});
document.querySelectorAll('.admin-workflow a').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.admin-workflow a').forEach(item=>item.removeAttribute('aria-current'));link.setAttribute('aria-current','location')}));
if('IntersectionObserver'in window){const sectionObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;const link=document.querySelector(`.admin-workflow a[href="#${entry.target.id}"]`);if(link){document.querySelectorAll('.admin-workflow a').forEach(item=>item.removeAttribute('aria-current'));link.setAttribute('aria-current','location')}}),{rootMargin:'-18% 0px -68% 0px'});['inventory-section','product-editor','newsletter-subscribers'].forEach(id=>{const section=document.getElementById(id);if(section)sectionObserver.observe(section)})}
productForm.elements.category.addEventListener('change',event=>{
  productForm.elements.group.value=event.currentTarget.selectedOptions[0]?.dataset.group||'';
});
imageInput.addEventListener('change',event=>{
  const uploads=[...event.currentTarget.files].slice(0,5).map(file=>({kind:'upload',file,preview:URL.createObjectURL(file)}));
  mediaItems=mediaItems.filter(item=>item.kind==='existing').concat(uploads);
  document.querySelector('#image-preview').replaceChildren();renderMediaEditor();
});
videoInput.addEventListener('change',()=>{if(videoInput.files[0]){currentVideoUrl='';productForm.elements.removeVideo.checked=false;}renderMediaEditor()});
productForm.addEventListener('submit',async event=>{
  event.preventDefault();productMessage.classList.remove('success');
  for(const field of productForm.querySelectorAll('[required]'))if(!field.checkValidity()){const step=field.closest('[data-form-step]');if(step)window.PennyBuysAdminWizard?.goToStep(Number(step.dataset.formStep));field.reportValidity();return;}
  if(!mediaItems.length){productMessage.textContent='Keep at least one product image. The first image is used as the storefront preview.';imageInput.focus();return;}
  if(mediaItems.length>5){productMessage.textContent='Keep no more than five product images. Remove an image or upload fewer files.';return;}
  productMessage.textContent=editingId?'Saving product changes...':'Uploading media and saving product...';
  const button=document.querySelector('#save-product');button.disabled=true;
  try{
    const method=editingId?'PUT':'POST';
    const endpoint=editingId?`/api/products/${encodeURIComponent(editingId)}`:'/api/products';
    const formData=new FormData(productForm);formData.delete('images');
    let uploadIndex=0;
    const imagePlan=mediaItems.map(item=>item.kind==='existing'?{kind:'existing',url:item.url}:{kind:'upload',index:uploadIndex++});
    formData.set('imagePlan',JSON.stringify(imagePlan));
    mediaItems.filter(item=>item.kind==='upload').forEach(item=>formData.append('images',item.file));
    const response=await api(endpoint,{method,body:formData});
    window.STORE_PRODUCTS=response.products;
    const message=editingId?`${response.product.name} was updated.`:`${response.product.name} was added to the catalog.`;
    cancelEdit();productMessage.textContent=message;productMessage.classList.add('success');
    renderProducts(response.products);
  }catch(error){productMessage.textContent=error.message;}
  button.disabled=false;
});

if(adminToken){connectAdmin(adminToken).catch(error=>{sessionStorage.removeItem(tokenKey);adminToken='';showLogin(error.message)})}else showLogin();
