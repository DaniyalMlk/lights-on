import { useEffect, useRef } from "react";

// Axonometric city study. The field map itself opens in the explorer.
export default function CityDrawing() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    function draw() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      const scale = Math.min(devicePixelRatio, 2);
      canvas.width = w * scale; canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      const unit = Math.min(w / 700, h / 480);
      ctx.setTransform(unit * scale, 0, 0, unit * scale, w * scale * .52, h * scale * .40);
      const point = (x,y,z=0) => [(x-y)*26,(x+y)*13-z];
      function path(points, color, fill) {
        ctx.beginPath();
        points.forEach(([x,y],i)=> i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
        if(fill){ctx.closePath(); ctx.fillStyle=fill; ctx.fill();}
        ctx.strokeStyle=color;ctx.lineWidth=.8;ctx.stroke();
      }
      for(let i=-18;i<=18;i++){
        path([point(i,-18),point(i,18)],"#25303b");
        path([point(-18,i),point(18,i)],"#25303b");
      }
      for(let sum=-12;sum<=14;sum++) for(let x=-7;x<=7;x++) {
        const y=sum-x;
        if(Math.abs(y)>7 || x===-2 || y===3) continue;
        const seed=Math.abs(Math.sin(x*97+y*53+2)*9321)%1;
        const glow=(x===1 && y===0)||(x===-3 && y===1)||(x===4 && y===-2);
        const z=glow ? (x===1?157:94) : 5+seed**3*98*Math.max(.15,1-Math.hypot(x,y)/10);
        const size=.62+seed*.19;
        const a=point(x,y,z),b=point(x+size,y,z),c=point(x+size,y+size,z),d=point(x,y+size,z);
        const edge=glow?"#ffcb72":"#53606c";
        path([d,c,point(x+size,y+size),point(x,y+size)],edge,glow?"#8f6528":"#1c2832");
        path([b,c,point(x+size,y+size),point(x+size,y)],edge,glow?"#60431f":"#111d27");
        path([a,b,c,d],edge,glow?"#ffd88b":"#37434e");
        for(let floor=4;floor<z-1;floor+=5){
          path([point(x,y+size,floor),point(x+size,y+size,floor),point(x+size,y,floor)],glow?"#ffcc72":"#45505a");
        }
        for(let v=.15;v<size;v+=.17){
          path([point(x+v,y+size),point(x+v,y+size,z)],glow?"#624924":"#27333f");
          path([point(x+size,y+v),point(x+size,y+v,z)],glow?"#49391e":"#202b35");
        }
      }
    }
    const observer=new ResizeObserver(draw);observer.observe(canvas);draw();
    return ()=>observer.disconnect();
  },[]);
  return <canvas ref={ref} className="city-drawing" aria-label="Illustrated city blocks with three illuminated office towers" role="img"/>;
}
