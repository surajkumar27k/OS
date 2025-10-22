// script.js
// Browser-side discrete-time simulator and Gantt renderer
// Supports: rms, edf, hybrid, energy-hybrid (hybrid + DVFS)
// Basic instructions:
//  - Load sample taskset, choose scheduler, set total time, click Run Simulation
//  - Gantt and metrics will render.

(() => {
  // CPU states
  const CPU_STATES = {
    HIGH: { name: 'HIGH_PERFORMANCE', speed: 1.0, power: 10 },
    LOW: { name: 'POWER_SAVER', speed: 0.5, power: 3 }
  };

  // Helper: deep copy
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Sample tasks (also mirrored into sample view)
  const SAMPLE_TASKS = [
    // id, arrival, execution, deadline (relative), period (optional), is_critical
    { id: 'T1', arrival: 0, execution: 30, deadline: 50, period: 50, is_critical: true },
    { id: 'T2', arrival: 0, execution: 20, deadline: 40, period: 40, is_critical: true },
    { id: 'T3', arrival: 10, execution: 25, deadline: 60, period: null, is_critical: false },
    { id: 'T4', arrival: 20, execution: 15, deadline: 50, period: null, is_critical: false },
    // Priority inversion demo pair (simplified): T5 holds resource for some time
    { id: 'T5', arrival: 5, execution: 12, deadline: 40, period: null, is_critical: true, holds_resource: 'R1' },
    { id: 'T6', arrival: 6, execution: 6, deadline: 25, period: null, is_critical: true, needs_resource: 'R1' }
  ];

  // Init UI elements
  const loadBtn = document.getElementById('load-sample');
  const runBtn = document.getElementById('run');
  const schedulerSelect = document.getElementById('scheduler-select');
  const totalTimeInput = document.getElementById('total-time');
  const laxityInput = document.getElementById('laxity-threshold');
  const sampleJsonPre = document.getElementById('sample-json');
  const ganttContainer = document.getElementById('gantt-container');
  const metricsDiv = document.getElementById('metrics');
  const fileInput = document.getElementById('file-input');
  const uploadBtn = document.getElementById('upload');

  sampleJsonPre.textContent = JSON.stringify(SAMPLE_TASKS, null, 2);

  loadBtn.addEventListener('click', () => {
    currentTasks = clone(SAMPLE_TASKS);
    sampleJsonPre.textContent = JSON.stringify(SAMPLE_TASKS, null, 2);
    showMessage('Sample taskset loaded. Choose scheduler and run simulation.');
  });

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        currentTasks = parsed;
        sampleJsonPre.textContent = JSON.stringify(parsed, null, 2);
        showMessage('Taskset loaded from file.');
      } catch (err) {
        alert('Invalid JSON file.');
      }
    };
    reader.readAsText(f);
  });

  runBtn.addEventListener('click', () => {
    if (!currentTasks || currentTasks.length === 0) {
      showMessage('No tasks loaded. Loading sample tasks.');
      currentTasks = clone(SAMPLE_TASKS);
    }
    const scheduler = schedulerSelect.value;
    const totalTime = parseInt(totalTimeInput.value, 10) || 200;
    const laxityThreshold = parseInt(laxityInput.value, 10) || 20;
    const result = runSimulation(clone(currentTasks), scheduler, totalTime, laxityThreshold);
    renderResult(result);
  });

  // show transient message
  function showMessage(msg) {
    ganttContainer.innerHTML = `<div class="gantt-placeholder">${escapeHtml(msg)}</div>`;
  }

  // Simulation engine
  function runSimulation(tasks, scheduler, totalTime, laxityThreshold) {
    // Normalize tasks: compute absolute deadlines and remaining time
    tasks = tasks.map(t => {
      const tt = Object.assign({}, t);
      tt.arrival = Number(tt.arrival || 0);
      tt.exec = Number(tt.execution || tt.exec || 0);
      tt.remaining = tt.exec;
      tt.deadline_relative = Number(tt.deadline || tt.deadline_relative || tt.exec);
      tt.abs_deadline = tt.arrival + tt.deadline_relative;
      tt.period = (tt.period === null || tt.period === undefined) ? Infinity : Number(tt.period);
      tt.is_critical = !!tt.is_critical;
      tt.history = []; // for Gantt segments: {start, end, state}
      tt.started = false;
      tt.completed = false;
      tt.completion_time = null;
      tt.wait_time = 0;
      // simplified resource fields (for Priority Inheritance demo)
      tt.holds_resource = tt.holds_resource || null;
      tt.needs_resource = tt.needs_resource || null;
      return tt;
    });

    // State
    let currentTime = 0;
    let log = [];
    let ready = [];
    let running = null;
    let cpuState = CPU_STATES.HIGH;
    let totalEnergy = 0;
    let cpuBusyTime = 0;
    const resources = {}; // map resource->ownerTaskId (for simple demo)
    const timeline = [];

    // Helper: admission
    function admitArrivals() {
      for (const t of tasks) {
        if (!t.admitted && t.arrival <= currentTime) {
          t.admitted = true;
          ready.push(t);
          logPush(`t=${currentTime}: admitted ${t.id}`);
        }
      }
    }

    // Helper: compute laxity for a task (use remaining execution at full speed)
    function computeLaxity(task) {
      return task.abs_deadline - (currentTime + task.remaining);
    }

    // Choose next task according to scheduler
    function chooseNext() {
      // filter only tasks with remaining > 0 and admitted
      const candidates = ready.filter(t => t.remaining > 0 && !t.completed);
      if (candidates.length === 0) return null;

      if (scheduler === 'rms') {
        // order by period (smaller first), tie-break arrival, then id
        candidates.sort((a,b) => a.period - b.period || a.arrival - b.arrival || a.id.localeCompare(b.id));
        return candidates[0];
      } else if (scheduler === 'edf') {
        candidates.sort((a,b) => a.abs_deadline - b.abs_deadline || a.arrival - b.arrival || a.id.localeCompare(b.id));
        return candidates[0];
      } else if (scheduler === 'hybrid' || scheduler === 'energy-hybrid') {
        // Hybrid logic: if any critical ready tasks -> use RMS among them; else EDF among non-critical
        const criticalReady = candidates.filter(t => t.is_critical);
        if (criticalReady.length > 0) {
          criticalReady.sort((a,b) => a.period - b.period || a.arrival - b.arrival || a.id.localeCompare(b.id));
          return criticalReady[0];
        } else {
          candidates.sort((a,b) => a.abs_deadline - b.abs_deadline || a.arrival - b.arrival || a.id.localeCompare(b.id));
          return candidates[0];
        }
      } else {
        // default EDF
        candidates.sort((a,b) => a.abs_deadline - b.abs_deadline || a.arrival - b.arrival || a.id.localeCompare(b.id));
        return candidates[0];
      }
    }

    // Simple priority inheritance demo: if a high-priority task needs a resource owned by a lower-priority task,
    // promote the owner for scheduling. This is a simplified hook: we implement by elevating owner's 'is_critical' flag
    // temporarily if it blocks a critical task. (For a full implementation, implement priority numbers
    // and lock queues per resource.)
    function applyPriorityInheritance() {
      // reset temporary boosts
      for (const t of tasks) {
        if (t._boosted) { delete t._boosted; }
      }
      // for each waiting candidate that needs a resource, check owner
      for (const waiter of ready) {
        if (!waiter.needs_resource) continue;
        const ownerId = resources[waiter.needs_resource];
        if (ownerId) {
          const owner = tasks.find(x => x.id === ownerId);
          if (!owner) continue;
          // If waiter has higher urgency (we compare criticalness first, then deadline)
          const waiterPrio = (waiter.is_critical ? 1000000 : 0) - waiter.abs_deadline;
          const ownerPrio = (owner.is_critical ? 1000000 : 0) - owner.abs_deadline;
          if (waiterPrio > ownerPrio) {
            owner._boosted = true; // mark boosted for scheduling heuristics
            logPush(`t=${currentTime}: priority inheritance: ${owner.id} boosted to avoid blocking ${waiter.id}`);
          }
        }
      }
    }

    // Modified chooseNext to consider boosted tasks as critical when present
    function chooseNextWithBoost() {
      // filter only tasks with remaining > 0 and admitted
      const candidates = ready.filter(t => t.remaining > 0 && !t.completed);
      if (candidates.length === 0) return null;
      // treat boosted tasks as critical
      for (const t of candidates) {
        t._effectiveCritical = t._boosted || t.is_critical;
      }
      if (scheduler === 'rms') {
        candidates.sort((a,b) => a.period - b.period || a.arrival - b.arrival || a.id.localeCompare(b.id));
        return candidates[0];
      } else if (scheduler === 'edf') {
        candidates.sort((a,b) => a.abs_deadline - b.abs_deadline || a.arrival - b.arrival || a.id.localeCompare(b.id));
        return candidates[0];
      } else if (scheduler === 'hybrid' || scheduler === 'energy-hybrid') {
        const criticalReady = candidates.filter(t => t._effectiveCritical);
        if (criticalReady.length > 0) {
          criticalReady.sort((a,b) => a.period - b.period || a.arrival - b.arrival || a.id.localeCompare(b.id));
          return criticalReady[0];
        } else {
          candidates.sort((a,b) => a.abs_deadline - b.abs_deadline || a.arrival - b.arrival || a.id.localeCompare(b.id));
          return candidates[0];
        }
      } else {
        // default EDF
        candidates.sort((a,b) => a.abs_deadline - b.abs_deadline || a.arrival - b.arrival || a.id.localeCompare(b.id));
        return candidates[0];
      }
    }

    function logPush(s) { log.push(s); }

    // Simulation loop
    for (currentTime = 0; currentTime <= totalTime; currentTime++) {
      admitArrivals();

      // clear previous boosts
      for (const t of tasks) {
        if (t._boosted) delete t._boosted;
        if (t._effectiveCritical) delete t._effectiveCritical;
      }

      // apply priority inheritance logic (simple)
      applyPriorityInheritance();

      // Choose next taking boosts into account
      const next = chooseNextWithBoost();

      // DVFS decision (if energy-hybrid)
      if (scheduler === 'energy-hybrid') {
        // If no task -> low power idle? We'll set CPU to LOW when idle to conserve energy.
        if (!next) {
          cpuState = CPU_STATES.LOW;
        } else {
          const lax = computeLaxity(next);
          cpuState = lax > laxityThreshold ? CPU_STATES.LOW : CPU_STATES.HIGH;
        }
      } else {
        cpuState = CPU_STATES.HIGH;
      }

      // Account energy for this tick (even if idle, CPU consumes some in LOW mode)
      totalEnergy += cpuState.power;

      if (next) {
        // Ensure next is in ready list and pick as running
        running = next;

        // If resource ownership prevents running (needs_resource and owner != null and owner != self)
        if (running.needs_resource) {
          const owner = resources[running.needs_resource];
          if (owner && owner !== running.id) {
            // blocked: can't run; mark wait and set running=null
            running.wait_time += 1;
            logPush(`t=${currentTime}: ${running.id} blocked on resource ${running.needs_resource}`);
            running = null;
          } else {
            // acquire resource if owner null
            resources[running.needs_resource] = running.id;
            logPush(`t=${currentTime}: ${running.id} acquired resource ${running.needs_resource}`);
          }
        }

        if (running && running.holds_resource) {
          // ensure ownership recorded
          resources[running.holds_resource] = running.id;
        }

        if (running) {
          // execute at cpu speed
          const work = cpuState.speed;
          if (!running.started) { running.started = true; running.start_time = currentTime; }
          // record segment start if needed
          const lastSeg = running.history.length ? running.history[running.history.length - 1] : null;
          if (!lastSeg || lastSeg.state !== 'run') {
            running.history.push({ start: currentTime, end: currentTime + 1, state: 'run' });
          } else {
            lastSeg.end = currentTime + 1;
          }
          running.remaining -= work;
          cpuBusyTime += 1;
          logPush(`t=${currentTime}: running ${running.id} (speed=${cpuState.speed}, remaining=${Math.max(0,running.remaining).toFixed(2)})`);
          if (running.remaining <= 0.0001) {
            running.completed = true;
            running.completion_time = currentTime + 1;
            logPush(`t=${currentTime+1}: completed ${running.id} (deadline ${running.abs_deadline})`);
            // release resources held
            if (running.holds_resource) {
              if (resources[running.holds_resource] === running.id) {
                delete resources[running.holds_resource];
                logPush(`t=${currentTime+1}: ${running.id} released resource ${running.holds_resource}`);
              }
            }
            // If this task also needed a resource, clear its need (it may have acquired earlier)
            if (running.needs_resource) {
              if (resources[running.needs_resource] === running.id) {
                delete resources[running.needs_resource];
              }
            }
            // remove from ready (it will be filtered by completed flag)
          }
        }
      } else {
        // idle tick
        logPush(`t=${currentTime}: idle`);
      }

      // update wait times for non-running ready tasks
      for (const t of ready) {
        if (!t.completed && t !== running) t.wait_time += 1;
      }

      // stop early if all tasks completed
      const remainingTasks = tasks.filter(t => !t.completed && t.admitted);
      const notArrived = tasks.filter(t => !t.admitted);
      if (remainingTasks.length === 0 && notArrived.length === 0) {
        // all done
        break;
      }

      // tick ends, record timeline snapshot optionally
      timeline.push({
        time: currentTime,
        running: running ? running.id : null,
        cpuState: cpuState.name
      });
    } // end for ticks

    // Compute metrics
    const results = {};
    const totalSimTime = Math.max(...tasks.map(t => t.completion_time || 0), totalTime);
    const deadlineMisses = tasks.filter(t => t.completed && (t.completion_time > t.abs_deadline)).length;
    const missedOrNotCompleted = tasks.filter(t => (!t.completed) || (t.completion_time > t.abs_deadline));
    const deadlineMissRatio = missedOrNotCompleted.length / tasks.length;
    const avgTurnaround = tasks.reduce((s,t) => s + ((t.completion_time ? (t.completion_time - t.arrival) : (totalTime - t.arrival))), 0) / tasks.length;
    const cpuUtilization = cpuBusyTime / (Math.max(totalSimTime, 1));
    results.tasks = tasks;
    results.log = log;
    results.totalEnergy = totalEnergy;
    results.deadlineMissRatio = deadlineMissRatio;
    results.deadlineMisses = missedOrNotCompleted.map(t => ({ id: t.id, completed: t.completed, completion_time: t.completion_time, abs_deadline: t.abs_deadline }));
    results.avgTurnaround = avgTurnaround;
    results.cpuUtilization = cpuUtilization;
    results.timeline = timeline;
    results.totalSimTime = totalSimTime;
    results.cpuBusyTime = cpuBusyTime;
    return results;
  }

  // Rendering functions
  function renderResult(res) {
    // Gantt: compute scaling by totalSimTime
    const tasks = res.tasks;
    const simTime = Math.max(1, res.totalSimTime, parseInt(totalTimeInput.value, 10));
    const width = Math.min(window.innerWidth - 80, 980);
    const rowH = 28;
    const height = tasks.length * rowH + 60;

    // Build SVG
    const svgParts = [];
    svgParts.push(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="gantt-svg">`);
    // background
    svgParts.push(`<rect width="100%" height="100%" fill="#fff" rx="6" ry="6" />`);
    // grid lines time ticks
    const tickCount = Math.min(50, simTime);
    for (let i=0;i<=tickCount;i++) {
      const x = (i / tickCount) * (width - 180) + 140;
      svgParts.push(`<line x1="${x}" y1="30" x2="${x}" y2="${height-20}" stroke="#f1f5f9" stroke-width="1" />`);
      const tlabel = Math.round((i / tickCount) * simTime);
      svgParts.push(`<text x="${x+2}" y="22" font-size="11" fill="#94a3b8">${tlabel}</text>`);
    }

    // rows and labels
    for (let i=0;i<tasks.length;i++) {
      const t = tasks[i];
      const y = 40 + i * rowH;
      svgParts.push(`<text x="12" y="${y+12}" font-family="monospace" font-size="12" fill="#0f172a">${t.id} ${t.is_critical ? '(C)' : ''}</text>`);
      svgParts.push(`<rect x="120" y="${y+2}" width="${width-140}" height="${rowH-6}" fill="#fafafa" stroke="#eef2ff" rx="4" ry="4" />`);
      // Draw deadline marker
      const dlx = 120 + ((t.abs_deadline / simTime) * (width-140));
      svgParts.push(`<line x1="${dlx}" y1="${y+2}" x2="${dlx}" y2="${y+rowH-4}" stroke="#ff6b6b" stroke-dasharray="3 2" />`);
      svgParts.push(`<text x="${dlx+4}" y="${y+14}" font-size="11" fill="#ff6b6b">D=${t.abs_deadline}</text>`);
      // draw history segments
      for (const seg of t.history) {
        const sx = 120 + ((seg.start / simTime) * (width-140));
        const ex = 120 + ((seg.end / simTime) * (width-140));
        const w = Math.max(1, ex - sx);
        const color = seg.state === 'run' ? (t.is_critical ? '#2563eb' : '#06b6d4') : '#c7d2fe';
        svgParts.push(`<rect x="${sx}" y="${y+6}" width="${w}" height="${rowH-18}" rx="3" ry="3" fill="${color}" />`);
      }
    }

    svgParts.push('</svg>');
    ganttContainer.innerHTML = svgParts.join('\n');

    // Metrics panel
    metricsDiv.style.display = 'block';
    metricsDiv.innerHTML = `
      <h4>Simulation Metrics</h4>
      <ul>
        <li>Total sim time: ${res.totalSimTime} ticks</li>
        <li>CPU busy ticks: ${res.cpuBusyTime}</li>
        <li>CPU utilization: ${(res.cpuUtilization*100).toFixed(2)}%</li>
        <li>Total energy consumed (simulated units): ${res.totalEnergy}</li>
        <li>Average turnaround time: ${res.avgTurnaround.toFixed(2)}</li>
        <li>Deadline miss ratio: ${(res.deadlineMissRatio*100).toFixed(2)}%</li>
      </ul>
      <details>
        <summary>Task summary</summary>
        <pre>${escapeHtml(JSON.stringify(res.tasks.map(t => ({
          id: t.id,
          arrival: t.arrival,
          exec: t.exec,
          completion_time: t.completion_time,
          abs_deadline: t.abs_deadline,
          completed: t.completed
        })), null, 2))}</pre>
      </details>
      <details>
        <summary>Event log</summary>
        <pre>${escapeHtml(res.log.join('\n'))}</pre>
      </details>
    `;
    metricsDiv.scrollIntoView({behavior:'smooth'});
  }

  function escapeHtml(s) {
    return (s+'').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // keep track of current tasks loaded
  let currentTasks = clone(SAMPLE_TASKS);
})();
