'use strict';

/* ================================================================
   OPPSETT / LAGRING
   Data lagres i nettleserens localStorage. Ved første besøk (eller
   hvis en nyere versjon finnes) hentes data.json som ligger sammen
   med appen — det er filen du publiserer på nytt (GitHub/Netlify)
   når du som admin vil dele oppdaterte resultater med alle.
   ================================================================ */
const STORAGE_KEY = 'discgolf_tournament_v1';
const DATA_URL = 'data.json';

function uid(){
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function defaultState(){
  return {
    meta: { name: 'Frisbeegolfturnering', date: '', theme: 'light', lastUpdated: null },
    players: [],
    courses: [],
    rounds: [] // { id, courseId, scores: { playerId: number|null }, completed: bool }
  };
}

let state = defaultState();

async function loadState(){
  let local = null;
  let remote = null;

  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) local = JSON.parse(raw);
  }catch(e){ /* korrupt lokal data, ignorer */ }

  try{
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if(res.ok) remote = await res.json();
  }catch(e){ /* data.json finnes ikke ennå, eller siden kjøres uten server */ }

  // Bruk den nyeste av lokal og publisert data (basert på lastUpdated)
  const localTime = local?.meta?.lastUpdated ? new Date(local.meta.lastUpdated).getTime() : 0;
  const remoteTime = remote?.meta?.lastUpdated ? new Date(remote.meta.lastUpdated).getTime() : 0;

  if(remote && remoteTime > localTime){
    state = remote;
  }else if(local){
    state = local;
  }else{
    state = defaultState();
  }

  // Sikre at alle felter finnes selv om gammel/importert fil mangler noe
  state.meta = Object.assign(defaultState().meta, state.meta || {});
  state.players = state.players || [];
  state.courses = state.courses || [];
  state.rounds = state.rounds || [];
  normalizePlayers(); // HANDICAP: gamle turneringer uten handicap-felt får 0 automatisk

  document.documentElement.setAttribute('data-theme', state.meta.theme === 'dark' ? 'dark' : 'light');
}

function saveState(){
  state.meta.lastUpdated = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ================================================================
   HJELPEFUNKSJONER
   ================================================================ */
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

function courseName(courseId){
  const c = state.courses.find(c => c.id === courseId);
  return c ? c.name : 'Ukjent bane';
}

function hasScore(v){
  return v !== null && v !== undefined && v !== '';
}

/* ---- HANDICAP: hjelpefunksjoner ---- */

// Sikrer at alle spillere har et gyldig numerisk handicap (bakoverkompatibilitet:
// gamle/importerte turneringer uten feltet får 0).
function normalizePlayers(){
  state.players.forEach(p => {
    const h = Number(p.handicap);
    p.handicap = Number.isFinite(h) ? h : 0;
  });
}

function round2(n){ return Math.round(n * 100) / 100; }

// Diskret badge ved siden av et spillernavn, f.eks. "(+3)" eller "(-1.5)".
// Skjules helt ved handicap 0 for å holde visningen ren.
function hcpBadge(h){
  const n = Number(h) || 0;
  if(n === 0) return '';
  const sign = n > 0 ? '+' : '';
  return ` <span class="hcp-badge">(${sign}${round2(n)})</span>`;
}

// Full verdi til egen Handicap-kolonne — viser alltid tallet, også 0.
function hcpValue(h){
  const n = round2(Number(h) || 0);
  return (n > 0 ? '+' : '') + n;
}

function playedRounds(){
  return state.rounds.filter(r => Object.values(r.scores || {}).some(hasScore));
}

let toastTimer = null;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ================================================================
   BEREGNINGER: stilling, rundevinnere, neste runde-kort
   ================================================================ */

// Regner ut sammenlagtstilling basert på et gitt sett runder.
// HANDICAP: hver runde gir en nettoscore (brutto − handicap). Rangeringen
// bruker summen av nettoscore («total» er fortsatt bruttosum, og følger
// med uendret slik at den fortsatt kan vises i egen kolonne).
function standingsForRounds(rounds){
  const rows = state.players.map(p => {
    const handicap = Number(p.handicap) || 0;
    const perRound = rounds.map(r => (hasScore(r.scores[p.id]) ? Number(r.scores[p.id]) : null));
    const perRoundNetto = perRound.map(s => hasScore(s) ? round2(s - handicap) : null);
    const playedBrutto = perRound.filter(hasScore);
    const playedNetto = perRoundNetto.filter(hasScore);
    const total = playedBrutto.reduce((a,b) => a + b, 0);
    const totalNetto = round2(playedNetto.reduce((a,b) => a + b, 0));
    return { playerId: p.id, name: p.name, handicap, perRound, perRoundNetto, total, totalNetto, playedCount: playedBrutto.length };
  });

  const played = rows.filter(r => r.playedCount > 0).sort((a,b) => a.totalNetto - b.totalNetto);
  const unplayed = rows.filter(r => r.playedCount === 0);

  // Standard konkurranse-rangering (delt plass ved likt nettoresultat)
  let rank = 0;
  played.forEach((r, i) => {
    if(i === 0 || r.totalNetto !== played[i-1].totalNetto) rank = i + 1;
    r.rank = rank;
  });
  unplayed.forEach(r => { r.rank = null; });

  return { ranked: played, unranked: unplayed, all: [...played, ...unplayed] };
}

function currentStandings(){ return standingsForRounds(state.rounds); }
function previousStandings(){
  const pr = playedRounds();
  return standingsForRounds(pr.slice(0, -1));
}

function roundWinners(round){
  const entries = state.players
    .map(p => ({ name: p.name, score: round.scores[p.id] }))
    .filter(e => hasScore(e.score));
  if(entries.length === 0) return { min: null, names: [] };
  const min = Math.min(...entries.map(e => Number(e.score)));
  return { min, names: entries.filter(e => Number(e.score) === min).map(e => e.name) };
}

// HANDICAP: rekkefølgen kommer fra currentStandings(), som nå rangerer på
// nettoscore — kortoppsettet blir dermed automatisk basert på netto.
function nextRoundGroups(){
  const standing = currentStandings();
  const order = [...standing.ranked, ...standing.unranked].map(r => ({ name: r.name, handicap: r.handicap }));
  const groups = [];
  for(let i = 0; i < order.length; i += 4){
    groups.push(order.slice(i, i + 4));
  }
  return groups;
}

const GROUP_LABELS = ['Lead Card', 'Chase Card'];
function groupLabel(i){
  return GROUP_LABELS[i] || `Kort ${i + 1}`;
}

/* ================================================================
   RENDERING
   ================================================================ */
function renderAll(){
  renderHeader();
  renderOverview();
  renderLeaderboard();
  renderRoundsPublic();
  renderNextRound();
  renderAdminInfo();
  renderPlayers();
  renderCourses();
  renderAdminRounds();
}

function renderHeader(){
  document.getElementById('tournamentName').textContent = state.meta.name || 'Frisbeegolfturnering';
  const parts = [];
  if(state.meta.date) parts.push(new Date(state.meta.date).toLocaleDateString('nb-NO', { day:'numeric', month:'long', year:'numeric' }));
  parts.push(`${state.players.length} spillere`);
  parts.push(`${state.rounds.length} runder`);
  document.getElementById('tournamentSubline').textContent = parts.join(' · ');
}

function renderOverview(){
  const standing = currentStandings();
  const leader = standing.ranked[0];
  const cards = [
    { label: 'Spillere', value: state.players.length },
    { label: 'Runder', value: state.rounds.length },
    { label: 'Fullførte runder', value: state.rounds.filter(r => r.completed).length },
    { label: 'Leder', value: leader ? leader.name : '–', leader: true, small: true },
  ];
  document.getElementById('overviewCards').innerHTML = cards.map(c => `
    <div class="stat-card ${c.leader ? 'leader' : ''}">
      <div class="stat-label">${escapeHtml(c.label)}</div>
      <div class="stat-value ${c.small ? 'small' : ''}">${escapeHtml(String(c.value))}</div>
    </div>
  `).join('');

  const scheduleEl = document.getElementById('overviewSchedule');
  if(state.rounds.length === 0){
    scheduleEl.innerHTML = '<p class="empty-hint">Ingen runder er lagt til ennå.</p>';
  }else{
    scheduleEl.innerHTML = state.rounds.map((r, i) => `
      <div class="schedule-row ${r.completed ? 'is-done' : ''}">
        <span class="rname">Runde ${i + 1}</span>
        <span class="rcourse">${escapeHtml(courseName(r.courseId))}</span>
        ${r.completed ? '<span class="badge-done">Fullført</span>' : ''}
      </div>
    `).join('');
  }
}

function renderLeaderboard(){
  const standing = currentStandings();
  const prev = previousStandings();
  const prevRankByPlayer = {};
  prev.ranked.forEach(r => { prevRankByPlayer[r.playerId] = r.rank; });

  const head = document.getElementById('leaderboardHead');
  const body = document.getElementById('leaderboardBody');
  const empty = document.getElementById('leaderboardEmpty');

  if(state.players.length === 0){
    head.innerHTML = '';
    body.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  let headHtml = `<th>Plass</th><th>Navn</th><th class="num">HCP</th>`;
  state.rounds.forEach((r, i) => { headHtml += `<th class="num" title="${escapeHtml(courseName(r.courseId))}">R${i+1}</th>`; });
  headHtml += `<th class="num">Brutto</th><th class="num">Netto</th><th class="num">Bak leder</th><th>Trend</th>`;
  head.innerHTML = headHtml;

  // HANDICAP: ledelse og "bak leder" beregnes nå ut fra nettoscore
  const leaderNetto = standing.ranked.length ? standing.ranked[0].totalNetto : 0;

  // Beste score per runde (for uthevelse)
  const bestPerRound = state.rounds.map(r => roundWinners(r).min);

  const rowsHtml = standing.all.map(row => {
    const isLeader = row.rank === 1;
    let badgeClass = '';
    if(row.rank === 1) badgeClass = 'g'; else if(row.rank === 2) badgeClass = 's'; else if(row.rank === 3) badgeClass = 'b';

    const prevRank = prevRankByPlayer[row.playerId];
    let trendHtml = '<span class="trend flat">–</span>';
    if(row.rank && prevRank){
      const diff = prevRank - row.rank;
      if(diff > 0) trendHtml = `<span class="trend up">▲ ${diff}</span>`;
      else if(diff < 0) trendHtml = `<span class="trend down">▼ ${Math.abs(diff)}</span>`;
      else trendHtml = '<span class="trend flat">–</span>';
    }else if(row.rank && !prevRank){
      trendHtml = '<span class="trend flat">Ny</span>';
    }

    const roundCells = row.perRound.map((s, i) => {
      const isBest = hasScore(s) && bestPerRound[i] !== null && Number(s) === bestPerRound[i];
      return `<td class="num ${isBest ? 'best-score' : ''}">${hasScore(s) ? s : '–'}</td>`;
    }).join('');

    const behind = row.rank ? (row.rank === 1 ? '–' : `+${round2(row.totalNetto - leaderNetto)}`) : '–';
    const rankDisplay = row.rank ? `<span class="rank-badge ${badgeClass}">${row.rank}</span>` : '<span class="rank-badge">–</span>';

    return `
      <tr class="${isLeader ? 'is-leader' : ''}">
        <td>${rankDisplay}</td>
        <td>${escapeHtml(row.name)}</td>
        <td class="num">${hcpValue(row.handicap)}</td>
        ${roundCells}
        <td class="num">${row.playedCount > 0 ? row.total : '–'}</td>
        <td class="num">${row.playedCount > 0 ? row.totalNetto : '–'}</td>
        <td class="num">${behind}</td>
        <td>${trendHtml}</td>
      </tr>`;
  }).join('');

  body.innerHTML = rowsHtml;
}

function renderRoundsPublic(){
  const listEl = document.getElementById('roundsPublicList');
  const emptyEl = document.getElementById('roundsPublicEmpty');

  if(state.rounds.length === 0){
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  listEl.innerHTML = state.rounds.map((r, i) => {
    const winners = roundWinners(r);
    const winnerLine = winners.names.length
      ? `<p class="round-winner-line">🏆 Rundevinner: ${escapeHtml(winners.names.join(', '))} (${winners.min})</p>`
      : '';

    // HANDICAP: viser brutto, handicap og nettoscore for runden per spiller
    const scoreRows = state.players.map(p => {
      const s = r.scores[p.id];
      const hcp = Number(p.handicap) || 0;
      const netto = hasScore(s) ? round2(Number(s) - hcp) : null;
      const isBest = hasScore(s) && winners.min !== null && Number(s) === winners.min;
      return `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td class="num ${isBest ? 'best-score' : ''}">${hasScore(s) ? s : '–'}</td>
          <td class="num">${hcpValue(hcp)}</td>
          <td class="num">${hasScore(netto) ? netto : '–'}</td>
        </tr>`;
    }).join('');

    return `
      <div class="round-card">
        <div class="round-card-head">
          <h3>Runde ${i + 1}</h3>
          <span class="round-status ${r.completed ? 'done' : 'progress'}">${r.completed ? 'Fullført' : 'Pågår'}</span>
        </div>
        <p class="round-course">${escapeHtml(courseName(r.courseId))}</p>
        ${winnerLine}
        <div class="table-scroll">
          <table class="round-mini-table">
            <thead><tr><th>Navn</th><th class="num">Brutto</th><th class="num">HCP</th><th class="num">Netto</th></tr></thead>
            <tbody>${scoreRows || '<tr><td colspan="4" class="empty-hint">Ingen spillere.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

function renderNextRound(){
  const note = document.getElementById('nesteRundeNote');
  const groupsEl = document.getElementById('cardGroups');

  if(state.players.length === 0){
    note.textContent = 'Legg til spillere for å generere kortoppsett.';
    groupsEl.innerHTML = '';
    return;
  }

  const pr = playedRounds();
  note.textContent = pr.length > 0
    ? 'Gruppene under er satt opp automatisk basert på nåværende sammenlagtstilling.'
    : 'Ingen runder er spilt ennå — gruppene følger rekkefølgen spillerne ble lagt til i.';

  const groups = nextRoundGroups();
  groupsEl.innerHTML = groups.map((players, i) => `
    <div class="group-card">
      <h3>${groupLabel(i)}</h3>
      <ol>
        ${players.map((pl, idx) => `<li><span class="pos">${i*4 + idx + 1}.</span>${escapeHtml(pl.name)}${hcpBadge(pl.handicap)}</li>`).join('')}
      </ol>
    </div>
  `).join('');
}

function renderAdminInfo(){
  document.getElementById('inputTournamentName').value = state.meta.name || '';
  document.getElementById('inputTournamentDate').value = state.meta.date || '';
}

function renderPlayers(){
  const list = document.getElementById('playerList');
  const empty = document.getElementById('playerEmpty');
  empty.hidden = state.players.length > 0;
  list.innerHTML = state.players.map(p => `
    <li data-id="${p.id}">
      <input class="name-edit" data-role="player-name" value="${escapeHtml(p.name)}">
      <input class="hcp-edit" type="number" step="any" data-role="player-handicap"
             value="${p.handicap}" title="Handicap" aria-label="Handicap for ${escapeHtml(p.name)}">
      <span class="row-actions">
        <button class="icon-action" data-action="delete-player" title="Slett spiller">✕</button>
      </span>
    </li>
  `).join('');
}

function renderCourses(){
  const list = document.getElementById('courseList');
  const empty = document.getElementById('courseEmpty');
  empty.hidden = state.courses.length > 0;
  list.innerHTML = state.courses.map(c => `
    <li data-id="${c.id}">
      <input class="name-edit" data-role="course-name" value="${escapeHtml(c.name)}">
      <span class="row-actions">
        <button class="icon-action" data-action="delete-course" title="Slett bane">✕</button>
      </span>
    </li>
  `).join('');

  // Oppdater select for "legg til runde"
  const sel = document.getElementById('inputRoundCourse');
  sel.innerHTML = state.courses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('roundCourseWarning').hidden = state.courses.length > 0;
  document.getElementById('roundForm').querySelector('button').disabled = state.courses.length === 0;
}

function renderAdminRounds(){
  const el = document.getElementById('adminRoundsList');
  if(state.rounds.length === 0){
    el.innerHTML = '<p class="empty-hint">Ingen runder lagt til ennå.</p>';
    return;
  }
  el.innerHTML = state.rounds.map((r, i) => {
    const courseOptions = state.courses.map(c =>
      `<option value="${c.id}" ${c.id === r.courseId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');

    const scoreInputs = state.players.map(p => `
      <div class="p-name">${escapeHtml(p.name)}${hcpBadge(p.handicap)}</div>
      <input type="number" inputmode="numeric" data-round="${r.id}" data-player="${p.id}"
             value="${hasScore(r.scores[p.id]) ? r.scores[p.id] : ''}" placeholder="–">
    `).join('');

    return `
      <div class="admin-round-card" data-round-id="${r.id}">
        <div class="arc-head">
          <strong>Runde ${i + 1}</strong>
          <select data-role="round-course" data-round="${r.id}">${courseOptions}</select>
          <button class="icon-action" data-action="delete-round" data-round="${r.id}" title="Slett runde">✕ Slett runde</button>
        </div>
        ${state.players.length ? `<div class="arc-scores">${scoreInputs}</div>` : '<p class="empty-hint">Legg til spillere for å registrere score.</p>'}
        <label class="arc-complete-row">
          <input type="checkbox" data-role="round-complete" data-round="${r.id}" ${r.completed ? 'checked' : ''}>
          Runden er fullført
        </label>
      </div>`;
  }).join('');
}

/* ================================================================
   ADMIN-HANDLINGER
   ================================================================ */
function addPlayer(name, handicap){
  const trimmed = name.trim();
  if(!trimmed) return;
  const h = Number(handicap);
  state.players.push({ id: uid(), name: trimmed, handicap: Number.isFinite(h) ? h : 0 });
  saveState(); renderAll();
}
function renamePlayer(id, name){
  const p = state.players.find(p => p.id === id);
  if(p && name.trim()){ p.name = name.trim(); saveState(); renderHeader(); renderOverview(); renderLeaderboard(); renderRoundsPublic(); renderNextRound(); renderAdminRounds(); }
}
// HANDICAP: kan redigeres når som helst fra spillerlisten i Admin
function setPlayerHandicap(id, value){
  const p = state.players.find(p => p.id === id);
  if(!p) return;
  const h = Number(value);
  p.handicap = Number.isFinite(h) ? h : 0;
  saveState(); renderHeader(); renderOverview(); renderLeaderboard(); renderRoundsPublic(); renderNextRound(); renderAdminRounds();
}
function deletePlayer(id){
  if(!confirm('Slette denne spilleren? Registrerte score for spilleren fjernes også.')) return;
  state.players = state.players.filter(p => p.id !== id);
  state.rounds.forEach(r => { delete r.scores[id]; });
  saveState(); renderAll();
}

function addCourse(name){
  const trimmed = name.trim();
  if(!trimmed) return;
  state.courses.push({ id: uid(), name: trimmed });
  saveState(); renderAll();
}
function renameCourse(id, name){
  const c = state.courses.find(c => c.id === id);
  if(c && name.trim()){ c.name = name.trim(); saveState(); renderAll(); }
}
function deleteCourse(id){
  if(!confirm('Slette denne banen? Runder som bruker banen vil vise "Ukjent bane".')) return;
  state.courses = state.courses.filter(c => c.id !== id);
  saveState(); renderAll();
}

function addRound(courseId){
  if(!courseId) return;
  const scores = {};
  state.players.forEach(p => { scores[p.id] = null; });
  state.rounds.push({ id: uid(), courseId, scores, completed: false });
  saveState(); renderAll();
}
function deleteRound(id){
  if(!confirm('Slette denne runden og alle registrerte resultater for den?')) return;
  state.rounds = state.rounds.filter(r => r.id !== id);
  saveState(); renderAll();
}
function setRoundCourse(roundId, courseId){
  const r = state.rounds.find(r => r.id === roundId);
  if(r){ r.courseId = courseId; saveState(); renderAll(); }
}
function setRoundScore(roundId, playerId, value){
  const r = state.rounds.find(r => r.id === roundId);
  if(!r) return;
  r.scores[playerId] = value === '' ? null : Number(value);
  saveState();
  renderHeader(); renderOverview(); renderLeaderboard(); renderRoundsPublic(); renderNextRound();
}
function toggleRoundComplete(roundId, completed){
  const r = state.rounds.find(r => r.id === roundId);
  if(r){ r.completed = completed; saveState(); renderAll(); }
}

function exportJSON(){
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (state.meta.name || 'turnering').toLowerCase().replace(/[^a-z0-9æøå]+/gi, '-');
  a.href = url;
  a.download = `data.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('JSON eksportert — last den opp som data.json for å publisere');
}

function importJSON(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed.players || !parsed.courses || !parsed.rounds){
        throw new Error('Filen mangler forventede felter');
      }
      state = parsed;
      state.meta = Object.assign(defaultState().meta, state.meta || {});
      normalizePlayers(); // HANDICAP: eldre eksportfiler uten feltet får 0 automatisk
      saveState();
      document.documentElement.setAttribute('data-theme', state.meta.theme === 'dark' ? 'dark' : 'light');
      renderAll();
      toast('Data importert');
    }catch(e){
      alert('Klarte ikke å lese filen. Sjekk at det er en gyldig eksport fra denne appen.');
    }
  };
  reader.readAsText(file);
}

function resetTournament(){
  if(!confirm('Dette sletter alle spillere, baner, runder og resultater. Er du sikker?')) return;
  const keepTheme = state.meta.theme;
  state = defaultState();
  state.meta.theme = keepTheme;
  saveState(); renderAll();
  toast('Turneringen er nullstilt');
}

/* ================================================================
   NAVIGASJON (tabs / subtabs / tema)
   ================================================================ */
function initTabs(){
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active'); btn.setAttribute('aria-selected','true');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
  document.querySelectorAll('.subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      document.querySelectorAll('.subtab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active'); btn.setAttribute('aria-selected','true');
      document.getElementById('sub-' + btn.dataset.subtab).classList.add('active');
    });
  });
}

function initThemeToggle(){
  document.getElementById('themeToggle').addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    state.meta.theme = next;
    saveState();
  });
}

/* ================================================================
   EVENT WIRING
   ================================================================ */
function initEvents(){
  document.getElementById('inputTournamentName').addEventListener('input', e => {
    state.meta.name = e.target.value; saveState(); renderHeader();
  });
  document.getElementById('inputTournamentDate').addEventListener('input', e => {
    state.meta.date = e.target.value; saveState(); renderHeader(); renderOverview();
  });

  document.getElementById('playerForm').addEventListener('submit', e => {
    e.preventDefault();
    const nameInput = document.getElementById('inputPlayerName');
    const hcpInput = document.getElementById('inputPlayerHandicap');
    addPlayer(nameInput.value, hcpInput.value);
    nameInput.value = '';
    hcpInput.value = '0';
  });
  document.getElementById('playerList').addEventListener('change', e => {
    if(e.target.dataset.role === 'player-name'){
      renamePlayer(e.target.closest('li').dataset.id, e.target.value);
    }else if(e.target.dataset.role === 'player-handicap'){
      setPlayerHandicap(e.target.closest('li').dataset.id, e.target.value);
    }
  });
  document.getElementById('playerList').addEventListener('click', e => {
    if(e.target.dataset.action === 'delete-player'){
      deletePlayer(e.target.closest('li').dataset.id);
    }
  });

  document.getElementById('courseForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('inputCourseName');
    addCourse(input.value);
    input.value = '';
  });
  document.getElementById('courseList').addEventListener('change', e => {
    if(e.target.dataset.role === 'course-name'){
      renameCourse(e.target.closest('li').dataset.id, e.target.value);
    }
  });
  document.getElementById('courseList').addEventListener('click', e => {
    if(e.target.dataset.action === 'delete-course'){
      deleteCourse(e.target.closest('li').dataset.id);
    }
  });

  document.getElementById('roundForm').addEventListener('submit', e => {
    e.preventDefault();
    addRound(document.getElementById('inputRoundCourse').value);
  });
  document.getElementById('adminRoundsList').addEventListener('click', e => {
    if(e.target.dataset.action === 'delete-round'){
      deleteRound(e.target.dataset.round);
    }
  });
  document.getElementById('adminRoundsList').addEventListener('change', e => {
    if(e.target.dataset.role === 'round-course'){
      setRoundCourse(e.target.dataset.round, e.target.value);
    }else if(e.target.dataset.role === 'round-complete'){
      toggleRoundComplete(e.target.dataset.round, e.target.checked);
    }else if(e.target.matches('input[type="number"][data-round]')){
      setRoundScore(e.target.dataset.round, e.target.dataset.player, e.target.value);
    }
  });

  document.getElementById('exportBtn').addEventListener('click', exportJSON);
  document.getElementById('importInput').addEventListener('change', e => {
    if(e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('resetBtn').addEventListener('click', resetTournament);

  document.getElementById('printBtn').addEventListener('click', () => window.print());
}

/* ================================================================
   INIT
   ================================================================ */
(async function init(){
  await loadState();
  initTabs();
  initThemeToggle();
  initEvents();
  renderAll();
})();
