// Tasks you can reset to
const baseTaskSets = {
  RMS: [
    {pid:1, name:'Motor Ctrl', type:'Critical', prio:4, cpu:3, state:'Pending'},
    {pid:2, name:'Logger', type:'Non-Critical', prio:2, cpu:2, state:'Pending'},
    {pid:3, name:'Sensor Monitor', type:'Critical', prio:3, cpu:1, state:'Pending'},
    {pid:4, name:'Comm Handler', type:'Non-Critical', prio:1, cpu:2, state:'Pending'},
  ],
  EDF: [
    {pid:1, name:'Encoder Writer', type:'Non-Critical', prio:2, cpu:2, state:'Pending'},
    {pid:2, name:'Monitor', type:'Critical', prio:4, cpu:2, state:'Pending'},
    {pid:3, name:'Actuator Sched', type:'Critical', prio:3, cpu:3, state:'Pending'},
    {pid:4, name:'Logger', type:'Non-Critical', prio:1, cpu:1, state:'Pending'}
  ]
};
let currentSched = 'RMS';
let currentTasks = JSON.parse(JSON.stringify(baseTaskSets[currentSched]));
let userPid = 5;

const timeline = document.getElementById('timeline');
const dialogue = document.getElementById('dialogue');
const cpuBar = document.getElementById('cpuBar');
const memBar = document.getElementById('memBar');
const spaceBar = document.getElementById('spaceBar');
const taskTable = document.getElementById('taskTable').querySelector('tbody');
const rmsBtn = document.getElementById('rmsBtn');
const edfBtn = document.getElementById('edfBtn');
const procType = document.getElementById('procType');
const addProcBtn = document.getElementById('addProcBtn');

function renderTable(tasks, runningIdx=-1) {
  taskTable.innerHTML = '';
  tasks.forEach((t, idx) => {
    const tr = document.createElement('tr');
    if (idx === runningIdx) tr.classList.add('running');
    else if (t.state === 'Pending') tr.classList.add('pending');
    tr.innerHTML = `<td>${t.pid}</td>
    <td>${t.name}</td>
    <td>${t.type}</td>
    <td>${t.prio}</td>
    <td>${t.cpu}</td>
    <td>${(idx === runningIdx)? 'Running' : t.state}</td>`;
    taskTable.appendChild(tr);
  });
}
function resetTimeline() {timeline.innerHTML = '';}
function setBars(cpu, mem, space) {
  cpuBar.style.width = cpu + '%';
  memBar.style.width = mem + '%';
  spaceBar.style.width = space + '%';
}
function getSpecs(spec) {
  let out = {};
  if (spec === "Critical-High-3") {
    out = {pid:userPid++, name:"User Critical A", type:"Critical", prio:5, cpu:3, state:"Pending"};
  } else if (spec === "Non-Critical-Med-2") {
    out = {pid:userPid++, name:"User Logger", type:"Non-Critical", prio:2, cpu:2, state:"Pending"};
  } else if (spec === "Critical-Low-1") {
    out = {pid:userPid++, name:"User Sensor", type:"Critical", prio:1, cpu:1, state:"Pending"};
  } else if (spec === "Non-Critical-Low-2") {
    out = {pid:userPid++, name:"User Data Transfer", type:"Non-Critical", prio:1, cpu:2, state:"Pending"};
  }
  return out;
}
addProcBtn.onclick = function() {
  const newTask = getSpecs(procType.value);
  currentTasks.push(newTask);
  runScheduler();
};
let scheduleSteps = [], runningIdx = 0, tick = 0, interval;
function buildSchedule(tasks, type='RMS') {
  const sorted = [...tasks].sort((a,b)=>type==='RMS' ? b.prio-a.prio : a.cpu-b.cpu);
  let steps = [], cpu=40, mem=30, space=80;
  sorted.forEach((task, i) => {
    for (let c=0; c<task.cpu;c++) {
      steps.push({
        running:task,
        idx:tasks.findIndex(t=>t.pid===task.pid),
        cpu:Math.min(100, cpu+6*i+1*c),
        mem:Math.min(100, mem+3*i+2*c),
        space:Math.max(10, space-3*i-2*c),
        pending:sorted.filter(t=>t.pid!==task.pid).map(t=>t.name)
      });
    }
  });
  steps.push({running:null, idx:-1, cpu:30,mem:24,space:89,pending:[]});
  return steps;
}
function runScheduler() {
  clearInterval(interval);
  scheduleSteps = buildSchedule(currentTasks, currentSched);
  tick = 0;
  runningIdx = -1;
  resetTimeline();
  renderTable(currentTasks, runningIdx);
  setBars(40,30,80);
  interval = setInterval(()=>{
    if (tick >= scheduleSteps.length) {
      dialogue.textContent = 'Scheduler idle: ready for next batch of tasks.';
      renderTable(currentTasks, -1);
      setBars(25,19,92);
      resetTimeline();
      clearInterval(interval);
      return;
    }
    const step = scheduleSteps[tick];
    resetTimeline();
    scheduleSteps.forEach((s, si) => {
      const block = document.createElement('div');
      if (si === tick && step.running) {
        block.className = 'task-block '+(step.running.type==='Critical'?'critical':'noncritical')+" active";
        block.innerText = step.running.name;
      } else if (si < tick) {
        block.className = 'task-block idle'; 
        block.innerText = 'Idle';
      } else {
        block.className = 'task-block idle'; block.innerText = '';
      }
      timeline.appendChild(block);
    });
    runningIdx = step.idx;
    setBars(step.cpu,step.mem,step.space);
    renderTable(currentTasks, runningIdx);
    if (step.running)
      dialogue.innerHTML =
        `<b>${step.running.name}</b> (${step.running.type}) is running.<br>
        Pending: ${step.pending.length>0?step.pending.join(', ') : 'None'}.<br>
        CPU Usage: ${step.cpu}% | Memory Usage: ${step.mem}% | Space: ${step.space}%.`;
    else
      dialogue.textContent = 'RTOS Scheduler: Idle. All tasks complete—energy savings on.';
    tick++;
  }, 1200);
}
rmsBtn.onclick = function() {
  rmsBtn.classList.add('active');
  edfBtn.classList.remove('active');
  currentSched = 'RMS';
  currentTasks = JSON.parse(JSON.stringify(baseTaskSets[currentSched]));
  userPid = 5;
  runScheduler();
}
edfBtn.onclick = function() {
  edfBtn.classList.add('active');
  rmsBtn.classList.remove('active');
  currentSched = 'EDF';
  currentTasks = JSON.parse(JSON.stringify(baseTaskSets[currentSched]));
  userPid = 5;
  runScheduler();
}
// Start demo
runScheduler();
