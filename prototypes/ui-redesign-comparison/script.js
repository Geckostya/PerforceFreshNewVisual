const screens = {
  files: {
    title: 'Project files', subtitle: '//DG_VS_Gecko_PC / Local files', primary: 'Update project',
    panes: ['Files', 'Details'],
    rows: [
      ['folder', 'Content', '//DG_VS_Gecko_PC/Content', '24'],
      ['folder', 'Plugins', '//DG_VS_Gecko_PC/Plugins', '12'],
      ['file', 'DG.uproject', 'Clean · revision 8 / 8', 'Clean'],
      ['folder', 'Source', '//DG_VS_Gecko_PC/Source', '8'],
      ['file', 'DefaultEngine.ini', 'Opened for edit · changelist 1842', 'Opened'],
      ['folder', 'Config', '//DG_VS_Gecko_PC/Config', '6'],
      ['folder', 'Build', '//DG_VS_Gecko_PC/Build', '4']
    ],
    selected: 4, detailTitle: 'DefaultEngine.ini', detailPath: '//DG_VS/Stabillize/Config/DefaultEngine.ini',
    facts: [['Status','Opened for edit'],['Revision','#18 / #18'],['Changelist','1842'],['Type','text']],
    detailAction: 'View diff', deltas: [['Иерархия','Тёмный sidebar отделяет навигацию от данных'],['Selection','Метка + фон + контур вместо одного бледного цвета'],['Inspector','Отдельная спокойная поверхность для деталей'],['Toolbar','Одна компактная линия без лишних рамок']]
  },
  changes: {
    title: 'My Changes', subtitle: 'Opened files and shelves · DG_VS_Gecko_PC', primary: 'New changelist',
    panes: ['Changelists', 'Opened files', 'File details'],
    rows: [
      ['change', 'Default changelist', '2 opened files', '2'],
      ['change', '1842 · Lighting pass', '4 files · updated 12m ago', '4'],
      ['change', '1818 · Audio routing', 'Shelved · 11 files', '11'],
      ['change', '1764 · Menu fixes', '3 opened files', '3'],
      ['change', '1721 · Animation cleanup', 'Shelved · 8 files', '8']
    ],
    files: [['file','DefaultEngine.ini','edit','edit'],['file','PlayerController.cpp','edit','edit'],['file','PauseMenu.uasset','add','add'],['file','WwiseSettings.ini','edit','edit']],
    selected: 1, detailTitle: 'PlayerController.cpp', detailPath: '//DG_VS/Stabillize/Source/DG/PlayerController.cpp',
    facts: [['Action','edit'],['Revision','#42'],['Changelist','1842'],['Lock','Not locked']],
    detailAction: 'View diff', deltas: [['Три колонки','Разный фон подчёркивает роль каждой панели'],['Действия','New changelist остаётся главным действием'],['Статусы','Opened и Shelved читаются без расшифровки'],['Плотность','Больше строк без уменьшения текста ниже 12 px в реальном UI']]
  },
  streams: {
    title: 'Streams', subtitle: 'Hierarchy and workspace stream', primary: 'Switch stream',
    panes: ['Stream tree', 'Topology'],
    rows: [
      ['stream', 'DG/main', 'mainline · current', 'Current'],
      ['stream', 'DG/dev', 'development · visible', 'On'],
      ['stream', 'DG/release', 'release · visible', 'On'],
      ['stream', 'DG/art', 'development · hidden', 'Off'],
      ['stream', 'DG/experimental', 'development · unactual', 'Off']
    ],
    selected: 0, detailTitle: 'Stream topology', detailPath: 'Parent / child relationships and visibility', facts: [], detailAction: 'Stream options',
    deltas: [['Дерево','Current, type и visibility не зависят от цвета'],['Топология','Граф получает больше полезной площади'],['Контекст','Switch stream видим и связан с текущим выбором'],['Unactual','Вторичный статус не конкурирует с выбором']]
  }
};

const navIcons = {
  files:'<path d="M3 5h5l2 2h11v11H3z"/>', changes:'<path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/>', submitted:'<path d="M5 4h14v16H5zM9 8h6M9 12h6"/>', streams:'<path d="M5 6h6v5H5zM13 14h6v5h-6zM11 8h3v8"/>', shelves:'<path d="M4 5h16v4H4zM6 9v10h12V9M9 13h6"/>', jobs:'<circle cx="12" cy="12" r="8"/><path d="M9 12h6M12 9v6"/>'
};

function icon(name){ return `<svg viewBox="0 0 24 24" aria-hidden="true">${navIcons[name]}</svg>`; }

function shell(screen, variant){
  const data = screens[screen];
  const nav = [['files','Files'],['changes','My Changes'],['submitted','Submitted'],['streams','Streams'],['shelves','Shelves'],['jobs','Jobs']];
  const listPane = buildList(data, screen);
  const centerPane = screen === 'changes' ? buildFilePane(data) : '';
  const endPane = screen === 'streams' ? buildTopology(variant) : buildDetail(data);
  return `<div class="mock-root">
    <header class="mock-header">
      <div class="mock-brand"><i>P4</i><span>P4FNV</span></div>
      <div class="mock-workspace">DG_VS_Gecko_PC⌄</div>
      <div class="mock-spacer"></div>
      <div class="mock-search">⌕&nbsp; Quick jump</div>
      <span class="mock-header-action">EN</span><span class="mock-header-action">Sign out</span>
    </header>
    <div class="mock-body">
      <aside class="mock-sidebar"><div class="mock-nav">${nav.map(([key,label])=>`<div class="mock-nav-item ${screen===key?'active':''}">${icon(key)}<span>${label}</span>${key==='changes'?'<b>4</b>':''}</div>`).join('')}</div><div class="mock-identity"><strong>DG_VS_Gecko_PC</strong><br><span>swarm · gecko</span></div></aside>
      <main class="mock-content">
        <div class="mock-titlebar"><div><h3>${data.title}</h3><p>${data.subtitle}</p></div><div class="mock-title-actions"><button class="mock-button">↻</button>${screen==='files'?'<button class="mock-button">Reconcile</button>':''}<button class="mock-button primary">${data.primary}</button></div></div>
        ${buildToolbar(screen, variant)}
        <div class="mock-workbench ${screen}">${listPane}${centerPane}${endPane}</div>
        <div class="mock-log"><span>✓</span><span>Perforce connected</span><span>Operations · CLI</span></div>
      </main>
    </div>
  </div>`;
}

function buildToolbar(screen, variant){
  if(screen==='files') return `<div class="mock-toolbar"><div class="mock-tabs"><span class="active">Local files</span><span>Depot files</span></div><div class="mock-input grow">⌕ Search project files</div><div class="mock-chip">All files⌄</div><div class="mock-chip">☷ List</div><div class="mock-chip">⌘ Tree</div></div>`;
  if(screen==='changes') return `<div class="mock-toolbar"><div class="mock-input grow">⌕ Search changelists or files</div><div class="mock-chip">All statuses⌄</div><div class="mock-chip">Active first⌄</div>${variant==='dense'?'<div class="mock-chip">Density: compact</div>':''}</div>`;
  return `<div class="mock-toolbar"><div class="mock-input grow">⌕ Find a stream</div><div class="mock-chip">All types⌄</div><div class="mock-chip">Visible only</div><div class="mock-chip">Fit graph</div></div>`;
}

function buildList(data, screen){
  return `<section class="mock-pane"><div class="mock-pane-title"><span>${data.panes[0]}</span><small>${data.rows.length}</small></div><div class="mock-list">${data.rows.map((row,i)=>`<div class="mock-row two-line ${i===data.selected?'selected':''}"><i class="mock-row-icon"></i><div class="mock-row-copy"><strong>${row[1]}</strong><small>${row[2]}</small></div><span class="mock-status ${row[3]==='Opened'?'opened':''}">${row[3]}</span></div>`).join('')}</div></section>`;
}

function buildFilePane(data){
  return `<section class="mock-pane"><div class="mock-pane-title"><span>${data.panes[1]}</span><small>4</small></div><div class="mock-list">${data.files.map((row,i)=>`<div class="mock-row two-line ${i===1?'selected':''}"><i class="mock-row-icon"></i><div class="mock-row-copy"><strong>${row[1]}</strong><small>//DG_VS/.../${row[1]}</small></div><span class="mock-status opened">${row[3]}</span></div>`).join('')}</div></section>`;
}

function buildDetail(data){
  return `<aside class="mock-pane mock-detail"><p class="eyeline">${data.panes.at(-1)}</p><h4>${data.detailTitle}</h4><p class="path">${data.detailPath}</p><dl class="mock-facts">${data.facts.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl><button class="mock-button small-primary">${data.detailAction}</button></aside>`;
}

function buildTopology(){
  return `<section class="mock-pane mock-detail"><p class="eyeline">Topology</p><h4>DG stream graph</h4><p class="path">Fixed node size · text identifies type</p><div class="mock-mini-chart"><span class="mock-node active">◆ DG/main</span><span class="mock-node">◇ DG/dev</span><span class="mock-node">◇ DG/release</span></div><dl class="mock-facts"><dt>Current</dt><dd>DG/main</dd><dt>Visible</dt><dd>4 streams</dd><dt>Unactual</dt><dd>1 stream</dd></dl><button class="mock-button small-primary">Stream options</button></section>`;
}

let activeScreen = 'files';
let activeVariant = 'calm';
const before = document.querySelector('#before-mock');
const after = document.querySelector('#after-mock');
const caption = document.querySelector('#after-caption');
const delta = document.querySelector('#delta-strip');

function render(){
  before.innerHTML = shell(activeScreen, 'current');
  after.className = `app-mock proposed ${activeVariant}`;
  after.innerHTML = shell(activeScreen, activeVariant);
  caption.textContent = activeVariant === 'calm' ? 'Вариант A · Calm Pro' : 'Вариант B · Focus Dense';
  delta.innerHTML = screens[activeScreen].deltas.map(([title,copy])=>`<div class="delta-item"><b>${title}</b><span>${copy}</span></div>`).join('');
}

document.querySelector('#screen-switcher').addEventListener('click', event => {
  const button = event.target.closest('button[data-screen]'); if(!button) return;
  activeScreen = button.dataset.screen;
  document.querySelectorAll('[data-screen]').forEach(item=>item.classList.toggle('active',item===button)); render();
});
document.querySelector('#variant-switcher').addEventListener('click', event => {
  const button = event.target.closest('button[data-variant]'); if(!button) return;
  activeVariant = button.dataset.variant;
  document.querySelectorAll('[data-variant]').forEach(item=>item.classList.toggle('active',item===button)); render();
});
document.querySelectorAll('[data-select-variant]').forEach(button=>button.addEventListener('click',()=>{
  activeVariant=button.dataset.selectVariant;
  document.querySelectorAll('[data-variant]').forEach(item=>item.classList.toggle('active',item.dataset.variant===activeVariant));
  render(); document.querySelector('#comparison').scrollIntoView({behavior:'smooth'});
}));

render();
