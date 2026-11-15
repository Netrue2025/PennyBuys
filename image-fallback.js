document.addEventListener('error',event=>{
  const image=event.target;
  if(!(image instanceof HTMLImageElement)||!image.src.includes('images.unsplash.com')||image.dataset.fallbackApplied)return;
  image.dataset.fallbackApplied='true';
  image.src='Media/product-placeholder.svg';
  image.classList.add('image-fallback');
},true);
