// background.js
// Lightweight, theme-aware particle background with toggle & perf checks.
// Exposes window.BackgroundControls = { setEnabled(bool), setTheme('dark'|'light'), pulse(n) }

(() => {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  let w = 0, h = 0, dpr = Math.max(1, window.devicePixelRatio || 1);
  let particles = [];
  let animationId = null;
  let enabled = true;
  let theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';

  // Settings — tuned for balance between looks and perf
  const baseDensity = 0.00022; // particles per px^2 (tune lower for lower perf)
  const maxParticles = 180;    // cap
  const minParticles = 24;

  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
  }

  function initParticles() {
    const area = w * h;
    let count = Math.round(area * baseDensity);
    count = Math.max(minParticles, Math.min(maxParticles, count));
    // reduce count on small screens
    if (Math.min(w, h) < 600) count = Math.round(count * 0.6);
    // build or shrink particle array
    particles.length = 0;
    for (let i = 0; i < count; i++) {
      particles.push(createParticle());
    }
  }

  function createParticle() {
    const speedBase = 0.12 + Math.random() * 0.6; // speed multiplier
    const size = (Math.random() * 2.2 + 0.6) * (dpr > 1 ? 1.1 : 1);
    const x = Math.random() * w;
    const y = Math.random() * h;
    const angle = Math.random() * Math.PI * 2;
    const vx = Math.cos(angle) * speedBase;
    const vy = Math.sin(angle) * (speedBase * 0.6);
    const group = Math.random() < 0.5 ? 'A' : 'B';
    return { x, y, vx, vy, size, alpha: 0.6 + Math.random() * 0.4, group };
  }

  function colorForTheme() {
    if (theme === 'dark') return { a: 'rgba(88,166,255,', b: 'rgba(64,224,208,' };
    return { a: 'rgba(37,99,235,', b: 'rgba(6,182,212,' };
  }

  function tick() {
    if (!enabled) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    ctx.clearRect(0, 0, w, h);
    const cols = colorForTheme();

    // subtle connections (optional low-frequency)
    // Draw particles
    for (let p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      // wrap
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10;
      if (p.y > h + 10) p.y = -10;

      // gradient by group
      const color = (p.group === 'A') ? cols.a + (p.alpha * 0.9) + ')' : cols.b + (p.alpha * 0.9) + ')';
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.globalCompositeOperation = 'lighter';
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // optional lines for denser screens (keep sparse)
    if (particles.length > 60) {
      ctx.strokeStyle = (theme === 'dark') ? 'rgba(88,166,255,0.045)' : 'rgba(6,182,212,0.045)';
      ctx.lineWidth = 0.6;
      for (let i = 0; i < particles.length; i += 6) {
        const pi = particles[i];
        for (let j = i+1; j < Math.min(i+8, particles.length); j++) {
          const pj = particles[j];
          const dx = pi.x - pj.x, dy = pi.y - pj.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(pi.x, pi.y);
            ctx.lineTo(pj.x, pj.y);
            ctx.stroke();
          }
        }
      }
    }

    animationId = window.requestAnimationFrame(tick);
  }

  // expose controls
  window.BackgroundControls = {
    setEnabled(flag) {
      enabled = !!flag;
      if (enabled) {
        if (!animationId) animationId = window.requestAnimationFrame(tick);
      } else {
        if (animationId) {
          window.cancelAnimationFrame(animationId);
          animationId = null;
          ctx.clearRect(0, 0, w, h);
        }
      }
    },
    setTheme(t) {
      theme = t === 'dark' ? 'dark' : 'light';
      // small visual pulse when theme changes
      this.pulse(6);
    },
    pulse(n = 12) {
      // briefly accelerate particles for visual feedback
      for (let p of particles) {
        p.vx *= 1 + (Math.random() * 0.5);
        p.vy *= 1 + (Math.random() * 0.5);
      }
      // slowly damp velocities back
      setTimeout(() => {
        for (let p of particles) {
          p.vx *= 0.75;
          p.vy *= 0.75;
        }
      }, Math.max(300, n * 30));
    },
    setDensity(factor) {
      // factor: 0.2..2.0
      baseDensity = Math.max(0.00008, Math.min(0.0006, factor * 0.00022));
      initParticles();
    }
  };

  // initialize
  resize();
  if (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animationId = window.requestAnimationFrame(tick);
  } else {
    // respect reduced motion
    enabled = false;
    ctx.clearRect(0, 0, w, h);
  }

  window.addEventListener('resize', () => {
    // debounce quick resizes
    clearTimeout(window._bgResizeTimer);
    window._bgResizeTimer = setTimeout(resize, 120);
  });

  // expose a way for the simulator to pulse the background on events
  // e.g., window.BackgroundControls.pulse(16) when a deadline miss occurs
})();
