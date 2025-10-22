// background-gl.js
// Fullscreen WebGL shader background with theme awareness, reduced-motion respect,
// and a small control API: window.ShaderBG = { setEnabled(bool), setTheme('dark'|'light'), pulse() }

(() => {
  const canvas = document.getElementById('gl-bg-canvas');
  if (!canvas) return;

  // Basic safety/perf checks
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let enabled = !prefersReduced;
  let animationId = null;
  let gl = null;
  let program = null;
  let startTime = performance.now();
  let lastTime = startTime;
  let theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  let pixelRatio = Math.max(1, window.devicePixelRatio || 1);

  // Vertex shader (simple passthrough)
  const vertexSrc = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // Fragment shader: animated procedural noise + color palette
  // Uses a simple 3D simplex-like noise (pseudo) for evolving patterns.
  const fragmentSrc = `
    precision highp float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_pixelRatio;
    uniform int u_theme; // 0 = light, 1 = dark
    // Hash / noise helpers
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
    float noise(vec2 p){
      vec2 i=floor(p); vec2 f=fract(p);
      float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
      vec2 u=f*f*(3.0-2.0*f);
      return mix(a, b, u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
    }
    // fbm
    float fbm(vec2 p){
      float acc=0.0, w=0.5;
      for(int i=0;i<5;i++){
        acc += w * noise(p);
        p *= 2.0;
        w *= 0.5;
      }
      return acc;
    }

    vec3 palette(float t, int theme) {
      if (theme == 1) {
        // dark palette: cool cyan/blue -> magenta
        vec3 a = vec3(0.03,0.06,0.15);
        vec3 b = vec3(0.12,0.44,0.9);
        vec3 c = vec3(0.27,0.9,0.82);
        vec3 d = vec3(0.9,0.5,0.95);
        return mix(mix(a,b,t), mix(c,d,1.0-t), 0.5);
      } else {
        // light palette
        vec3 a = vec3(0.94,0.97,1.0);
        vec3 b = vec3(0.28,0.6,0.95);
        vec3 c = vec3(0.03,0.47,0.68);
        vec3 d = vec3(0.7,0.95,0.9);
        return mix(mix(a,b,t), mix(c,d,1.0-t), 0.45);
      }
    }

    void main() {
      vec2 uv = v_uv;
      vec2 pos = (gl_FragCoord.xy / u_resolution.xy);
      // center coordinates
      vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0) * 1.2;
      float t = u_time * 0.15;
      float n = fbm(p * 1.5 + vec2(t*0.2, -t*0.12));
      float n2 = fbm(p * 3.0 - vec2(t*0.4, t*0.2));
      float comb = mix(n, n2, 0.45);
      // sharp layers
      float lines = smoothstep(0.2, 0.6, sin((uv.y + comb*0.9) * 12.0 + t*1.2) * 0.5 + 0.5);
      float glow = exp(-length(p) * 1.5) * 0.9;
      float pattern = clamp(comb*1.2 + 0.25*lines + glow*0.9, 0.0, 1.0);

      vec3 color = palette(pattern, u_theme);
      // subtle vignette
      float vign = smoothstep(0.8, 0.3, length((uv - 0.5) * vec2(u_resolution.x/u_resolution.y,1.0)));
      color *= mix(1.0, 0.7, vign * 0.7);

      // final compositing with soft alpha so content blends nicely
      float alpha = 0.88;
      gl_FragColor = vec4(color, alpha);
    }
  `;

  // Helper: create GL context
  function initGL() {
    gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    if (!gl) {
      console.warn('WebGL not available — falling back to static gradient');
      return false;
    }
    // compile shaders
    const v = compileShader(gl.VERTEX_SHADER, vertexSrc);
    const f = compileShader(gl.FRAGMENT_SHADER, fragmentSrc);
    program = gl.createProgram();
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('GL program link failed:', gl.getProgramInfoLog(program));
      return false;
    }
    gl.useProgram(program);

    // full-screen quad
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const verts = new Float32Array([-1,-1,  1,-1,  -1,1,  -1,1, 1,-1, 1,1]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // uniforms
    program.u_time = gl.getUniformLocation(program, 'u_time');
    program.u_resolution = gl.getUniformLocation(program, 'u_resolution');
    program.u_pixelRatio = gl.getUniformLocation(program, 'u_pixelRatio');
    program.u_theme = gl.getUniformLocation(program, 'u_theme');
    return true;
  }

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(s));
    }
    return s;
  }

  function resize() {
    pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(window.innerWidth));
    const height = Math.max(1, Math.floor(window.innerHeight));
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    if (gl && program) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(program.u_resolution, canvas.width / pixelRatio, canvas.height / pixelRatio);
      gl.uniform1f(program.u_pixelRatio, pixelRatio);
    }
  }

  function render(now) {
    if (!enabled) return;
    if (!gl) return;
    const time = (now - startTime) / 1000.0;
    gl.useProgram(program);
    gl.uniform1f(program.u_time, time);
    gl.uniform1i(program.u_theme, theme === 'dark' ? 1 : 0);
    gl.uniform2f(program.u_resolution, canvas.width / pixelRatio, canvas.height / pixelRatio);
    gl.uniform1f(program.u_pixelRatio, pixelRatio);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    animationId = requestAnimationFrame(render);
  }

  // public API
  window.ShaderBG = {
    setEnabled(flag) {
      enabled = !!flag;
      if (enabled) {
        if (!gl) {
          if (!initGL()) return;
        }
        resize();
        if (!animationId) animationId = requestAnimationFrame(render);
      } else {
        if (animationId) cancelAnimationFrame(animationId);
        animationId = null;
        // clear canvas
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
    setTheme(t) {
      theme = t === 'dark' ? 'dark' : 'light';
      // brief visual pulse (just re-render faster)
      this.pulse();
    },
    pulse() {
      // quick visual response by temporarily accelerating time progression
      const oldStart = startTime;
      startTime -= 200; // offsets to create a small jump
      setTimeout(() => { startTime = oldStart; }, 300);
    }
  };

  // Init sequence
  const ok = initGL();
  resize();
  if (enabled && ok) animationId = requestAnimationFrame(render);

  // Handle resize
  let rtid = null;
  window.addEventListener('resize', () => {
    clearTimeout(rtid);
    rtid = setTimeout(resize, 120);
  });

  // Respect prefers-reduced-motion changes on the fly
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener && mq.addEventListener('change', (e) => {
      if (e.matches) window.ShaderBG.setEnabled(false);
      else window.ShaderBG.setEnabled(true);
    });
  }
})();
