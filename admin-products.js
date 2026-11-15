const tokenKey='pennybuys-admin-session-token';
const loginPanel=document.querySelector('#admin-login');
const dashboard=document.querySelector('#admin-dashboard');
const tokenInput=document.querySelector('#admin-token');
const loginMessage=document.querySelector('#login-message');
const serviceStatus=document.querySelector('#service-status');
const productList=document.querySelector('#product-list');
const productCount=document.querySelector('#product-count');
const productForm=document.querySelector('#product-form');
const productMessage=document.querySelector('#product-message');
const imageInput=productForm.elements.images;
const videoInput=productForm.elements.video;
const existingMedia=document.querySelector('#existing-media');
const removeVideoWrap=document.querySelector('#remove-video-wrap');
let adminToken=sessionStorage.getItem(tokenKey)||'';
let catalogProducts=[];
let editingId='';
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function showLogin(message=''){
  loginPanel.hidden=false;dashboard.hidden=true;document.querySelector('#admin-logout').hidden=true;
  loginMessage.textContent=message;loginMessage.classList.remove('success');
}
function showDashboard(){
  loginPanel.hidden=true;dashboard.hidden=false;document.querySelector('#admin-logout').hidden=false;
}
async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{...(options.headers||{}),'x-admin-token':adminToken}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
  return data;
}
function renderProducts(products){
  catalogProducts=products;
  productCount.textContent=products.length;
  productList.innerHTML=products.length?products.map(product=>`<article class="inventory-card"><img src="${escapeHTML(product.image)}" alt="" loading="lazy"><div><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.category)}${product.video?' | video':''}</p><small>Stock: ${Number(product.inventory??0)} | ${Number(product.gallery?.length||0)+1} image${product.gallery?.length?'s':''}</small></div><strong>GBP ${Number(product.price).toFixed(2)}</strong><div class="inventory-actions"><button class="quiet-button" type="button" data-edit-id="${escapeHTML(product.id)}">Edit</button><button class="delete-button" type="button" data-delete-id="${escapeHTML(product.id)}">Delete</button></div></article>`).join(''):'<div class="inventory-empty">No products are available yet.</div>';
}
async function loadProducts(){renderProducts(await api('/api/products'));}
async function connectAdmin(candidate){
  adminToken=candidate;
  const status=await api('/api/admin/status');
  sessionStorage.setItem(tokenKey,adminToken);
  showDashboard();
  const ready=status.mongoConnected&&status.cloudinaryConfigured;
  serviceStatus.classList.toggle('ready',ready);
  serviceStatus.innerHTML=`<strong>${ready?'Services ready':'Setup needed'}</strong><span>MongoDB: ${status.mongoConnected?'connected':escapeHTML(status.mongoMessage||'not connected')}</span><span>Cloudinary: ${status.cloudinaryConfigured?'configured':'not configured'}</span>${status.cloudinaryConfigured?'':'<span>Set Cloudinary credentials in your server environment before uploading.</span>'}`;
  await loadProducts();
}
function cancelEdit(){
  editingId='';productForm.reset();productForm.elements.group.value='';
  productForm.dataset.editId='';imageInput.required=true;removeVideoWrap.hidden=true;existingMedia.hidden=true;
  document.querySelector('#form-title').textContent='Add a product';
  document.querySelector('#save-product').textContent='Upload and add product';
  document.querySelector('#cancel-edit').hidden=true;
  document.querySelector('#image-preview').replaceChildren();
  productMessage.textContent='';productMessage.classList.remove('success');
}
function editProduct(product){
  editingId=product.id;productForm.dataset.editId=product.id;
  productForm.elements.name.value=product.name||'';
  productForm.elements.price.value=product.price??'';
  productForm.elements.inventory.value=product.inventory??0;
  productForm.elements.description.value=product.description||'';
  const categorySelect=productForm.elements.category;
  let option=[...categorySelect.options].find(item=>item.value===product.category);
  if(!option){option=new Option(product.category,product.category);option.dataset.group=product.group||'';categorySelect.add(option)}
  categorySelect.value=product.category||'';productForm.elements.group.value=product.group||option.dataset.group||'';
  imageInput.required=false;imageInput.value='';videoInput.value='';productForm.elements.removeVideo.checked=false;
  document.querySelector('#image-preview').replaceChildren();
  const imageCount=1+(product.gallery?.length||0);
  existingMedia.textContent=`Current media: ${imageCount} image${imageCount===1?'':'s'}${product.video?' and a video':''}. Upload new images or a video to replace them.`;
  existingMedia.hidden=false;removeVideoWrap.hidden=!product.video;
  document.querySelector('#form-title').textContent=`Edit ${product.name}`;
  document.querySelector('#save-product').textContent='Save product changes';
  document.querySelector('#cancel-edit').hidden=false;
  productMessage.textContent='';productMessage.classList.remove('success');
  productForm.scrollIntoView({behavior:'smooth',block:'start'});
}
document.querySelector('#admin-login-form').addEventListener('submit',async event=>{
  event.preventDefault();loginMessage.textContent='Checking access...';
  try{await connectAdmin(tokenInput.value.trim());loginMessage.textContent='';}
  catch(error){showLogin(error.message);adminToken='';sessionStorage.removeItem(tokenKey);}
});
document.querySelector('#admin-logout').addEventListener('click',()=>{sessionStorage.removeItem(tokenKey);adminToken='';showLogin('You have signed out.')});
document.querySelector('#refresh-products').addEventListener('click',async event=>{
  event.currentTarget.disabled=true;
  try{await loadProducts();}catch(error){productMessage.textContent=error.message;}
  event.currentTarget.disabled=false;
});
document.querySelector('#cancel-edit').addEventListener('click',cancelEdit);
productList.addEventListener('click',async event=>{
  const editButton=event.target.closest('[data-edit-id]');
  if(editButton){const product=catalogProducts.find(item=>item.id===editButton.dataset.editId);if(product)editProduct(product);return;}
  const deleteButton=event.target.closest('[data-delete-id]');
  if(!deleteButton)return;
  const product=catalogProducts.find(item=>item.id===deleteButton.dataset.deleteId);
  if(!product||!window.confirm(`Delete "${product.name}" from the catalog?`))return;
  deleteButton.disabled=true;
  try{
    const response=await api(`/api/products/${encodeURIComponent(product.id)}`,{method:'DELETE'});
    if(editingId===product.id)cancelEdit();
    renderProducts(response.products);productMessage.textContent=`${product.name} was deleted.`;productMessage.classList.add('success');
  }catch(error){productMessage.textContent=error.message;deleteButton.disabled=false;}
});
productForm.elements.category.addEventListener('change',event=>{
  productForm.elements.group.value=event.currentTarget.selectedOptions[0]?.dataset.group||'';
});
imageInput.addEventListener('change',event=>{
  const files=[...event.currentTarget.files].slice(0,5);
  document.querySelector('#image-preview').innerHTML=files.map(file=>`<img src="${URL.createObjectURL(file)}" alt="Preview of ${escapeHTML(file.name)}">`).join('');
});
productForm.addEventListener('submit',async event=>{
  event.preventDefault();productMessage.classList.remove('success');
  if(!editingId&&!imageInput.files.length){productMessage.textContent='Choose at least one product image.';imageInput.focus();return;}
  productMessage.textContent=editingId?'Saving product changes...':'Uploading media and saving product...';
  const button=document.querySelector('#save-product');button.disabled=true;
  try{
    const method=editingId?'PUT':'POST';
    const endpoint=editingId?`/api/products/${encodeURIComponent(editingId)}`:'/api/products';
    const response=await api(endpoint,{method,body:new FormData(productForm)});
    window.STORE_PRODUCTS=response.products;
    const message=editingId?`${response.product.name} was updated.`:`${response.product.name} was added to the catalog.`;
    cancelEdit();productMessage.textContent=message;productMessage.classList.add('success');
    renderProducts(response.products);
  }catch(error){productMessage.textContent=error.message;}
  button.disabled=false;
});

if(adminToken){connectAdmin(adminToken).catch(error=>{sessionStorage.removeItem(tokenKey);adminToken='';showLogin(error.message)})}else showLogin();
