var cur=document.getElementById('cur'),rng=document.getElementById('rng');
  var mx=0,my=0,rx=0,ry=0;
  document.addEventListener('mousemove',function(e){mx=e.clientX;my=e.clientY;cur.style.left=mx+'px';cur.style.top=my+'px';});
  (function a(){rx+=(mx-rx)*.12;ry+=(my-ry)*.12;rng.style.left=rx+'px';rng.style.top=ry+'px';requestAnimationFrame(a);})();
  document.querySelectorAll('a,button').forEach(function(el){
    el.addEventListener('mouseenter',function(){cur.classList.add('hov');rng.classList.add('hov');});
    el.addEventListener('mouseleave',function(){cur.classList.remove('hov');rng.classList.remove('hov');});
  });
  var nav=document.getElementById('nav');
  window.addEventListener('scroll',function(){nav.classList.toggle('sc',scrollY>40);},{passive:true});
  var obs=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting)return;
      var idx=Array.from(e.target.parentElement.children).indexOf(e.target);
      e.target.style.transitionDelay=(idx*.09)+'s';
      e.target.classList.add('vis');
      obs.unobserve(e.target);
    });
  },{threshold:.12});
  document.querySelectorAll('.reveal').forEach(function(el){obs.observe(el);});
  document.querySelectorAll('.bar').forEach(function(b,i){
    var h=b.style.height;b.style.height='2px';
    setTimeout(function(){b.style.transition='height .55s ease';b.style.height=h;},1100+(i*55));
  });