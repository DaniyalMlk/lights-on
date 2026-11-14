import { useEffect, useRef, useState } from "react";

export default function AnimatedNumber({ value }) {
  const current = useRef(value);
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const start = current.current;
    if (start === value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = value;
      setDisplay(value);
      return;
    }
    const since = performance.now();
    let frame;
    function tick(now) {
      const progress = Math.min(1, (now - since) / 350);
      current.current = Math.round(value + (start - value) * (1 - progress) ** 3);
      setDisplay(current.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span aria-label={value.toLocaleString()}>{display.toLocaleString()}</span>;
}
