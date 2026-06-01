// ================= CONFIGURATION =================
const TMDB_API_KEY = 'cf3fd5ed845e76f7c6786a61e521006c';
const IMG_BASE = 'https://image.tmdb.org/t/p/w500';
const EMBED_SOURCES = [
  { name: '🎬 Vidsrc', getUrl: (type, id, season, ep) => type === 'movie' ? `https://vidsrc.to/embed/movie/${id}` : `https://vidsrc.to/embed/tv/${id}/${season}/${ep}` },
  { name: '📺 2Embed', getUrl: (type, id, season, ep) => type === 'movie' ? `https://2embed.sx/embed/movie?tmdb=${id}` : `https://2embed.sx/embed/tv?tmdb=${id}&season=${season}&episode=${ep}` },
  { name: '🌀 Embed.su', getUrl: (type, id, season, ep) => type === 'movie' ? `https://embed.su/embed/movie/${id}` : `https://embed.su/embed/tv/${id}/${season}/${ep}` },
  { name: '⚡ Vidplay', getUrl: (type, id, season, ep) => type === 'movie' ? `https://vidplay.site/embed/movie/${id}` : `https://vidplay.site/embed/tv/${id}/${season}/${ep}` }
];

// ================= SUPABASE SETUP =================
// 🔴 IMPORTANT: Replace with your actual Supabase URL and anon key
const SUPABASE_URL = 'YOUR_SUPABASE_URL';      // from https://app.supabase.com/project/_/settings/api
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================= GLOBAL STATE =================
let currentUser = null;
let currentMedia = null;   // { type, id, title, posterPath, overview, rating, year }
let currentSeasonNumber = 1, currentEpisodeNumber = 1;

// ================= DOM ELEMENTS =================
const moviesGrid = document.getElementById('moviesGrid');
const detailPanel = document.getElementById('detailPanel');
const searchInput = document.getElementById('searchInput');
const sourceSelect = document.getElementById('sourceSelect');
const embedIframe = document.getElementById('embedIframe');
const tvControls = document.getElementById('tvControls');
const seasonSelect = document.getElementById('seasonSelect');
const episodeSelect = document.getElementById('episodeSelect');
const progressMinutes = document.getElementById('progressMinutes');
const saveProgressBtn = document.getElementById('saveProgressBtn');
const jumpToTimeBtn = document.getElementById('jumpToTimeBtn');
const continuePanel = document.getElementById('continuePanel');
const continueList = document.getElementById('continueList');
const showContinueBtn = document.getElementById('showContinueBtn'); // will be created? We'll add a button later
const closeContinueBtn = document.getElementById('closeContinueBtn');

// Buttons that exist in HTML
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const logoutBtn = document.getElementById('logoutBtn');
const clearDetailBtn = document.getElementById('clearDetailBtn');
const refreshEmbedBtn = document.getElementById('refreshEmbedBtn');

// Populate source dropdown
function populateSources() {
  sourceSelect.innerHTML = '';
  EMBED_SOURCES.forEach((src, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = src.name;
    sourceSelect.appendChild(opt);
  });
}

// Update embed URL
function updateEmbedStream() {
  if (!currentMedia) return;
  const srcIdx = parseInt(sourceSelect.value);
  const source = EMBED_SOURCES[srcIdx];
  let embedUrl = '';
  if (currentMedia.type === 'movie') {
    embedUrl = source.getUrl('movie', currentMedia.id);
  } else {
    embedUrl = source.getUrl('tv', currentMedia.id, currentSeasonNumber, currentEpisodeNumber);
  }
  const mins = parseInt(progressMinutes.value) || 0;
  const seconds = mins * 60;
  if (seconds > 0 && embedUrl) {
    embedUrl += (embedUrl.includes('?') ? '&' : '?') + `t=${seconds}`;
  }
  embedIframe.src = embedUrl || '';
}

// ================= SUPABASE WATCH HISTORY =================
async function saveWatchProgress() {
  if (!currentUser) { alert('Please login to save progress'); return; }
  if (!currentMedia) return;
  const progress = parseInt(progressMinutes.value) || 0;
  const record = {
    user_id: currentUser.id,
    media_type: currentMedia.type,
    tmdb_id: currentMedia.id,
    title: currentMedia.title,
    poster_path: currentMedia.posterPath,
    media_year: currentMedia.year,
    rating: currentMedia.rating,
    progress_minutes: progress,
    last_watched: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (currentMedia.type === 'tv') {
    record.season_number = currentSeasonNumber;
    record.episode_number = currentEpisodeNumber;
  }
  const { error } = await supabase
    .from('watch_history')
    .upsert(record, { onConflict: 'user_id, media_type, tmdb_id, season_number, episode_number' });
  if (error) alert('Error: ' + error.message);
  else {
    document.getElementById('savedProgressBadge').classList.remove('hidden');
    setTimeout(() => document.getElementById('savedProgressBadge').classList.add('hidden'), 2000);
    loadContinueWatching();
  }
}

async function loadProgressForCurrent() {
  if (!currentUser || !currentMedia) return;
  let query = supabase.from('watch_history').select('progress_minutes')
    .eq('user_id', currentUser.id)
    .eq('media_type', currentMedia.type)
    .eq('tmdb_id', currentMedia.id);
  if (currentMedia.type === 'tv') {
    query = query.eq('season_number', currentSeasonNumber).eq('episode_number', currentEpisodeNumber);
  } else {
    query = query.is('season_number', null).is('episode_number', null);
  }
  const { data } = await query.maybeSingle();
  if (data) progressMinutes.value = data.progress_minutes;
  else progressMinutes.value = 0;
}

async function loadContinueWatching() {
  if (!currentUser) { continuePanel.classList.remove('open'); return; }
  const { data, error } = await supabase
    .from('watch_history')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('last_watched', { ascending: false })
    .limit(10);
  if (error) return;
  continueList.innerHTML = '';
  if (!data.length) {
    continueList.innerHTML = '<div class="continue-item">No history yet</div>';
    return;
  }
  data.forEach(item => {
    const div = document.createElement('div');
    div.className = 'continue-item';
    div.innerHTML = `
      <h4>${item.title}</h4>
      <div class="progress-text">${item.progress_minutes} min • ${item.media_type === 'tv' ? `S${item.season_number}E${item.episode_number}` : 'Movie'}</div>
    `;
    div.onclick = async () => {
      if (item.media_type === 'movie') {
        const res = await fetch(`https://api.themoviedb.org/3/movie/${item.tmdb_id}?api_key=${TMDB_API_KEY}`);
        const movie = await res.json();
        await loadAndDisplayDetails(movie, 'movie');
        progressMinutes.value = item.progress_minutes;
        updateEmbedStream();
      } else {
        const res = await fetch(`https://api.themoviedb.org/3/tv/${item.tmdb_id}?api_key=${TMDB_API_KEY}`);
        const tv = await res.json();
        await loadAndDisplayDetails(tv, 'tv');
        currentSeasonNumber = item.season_number;
        currentEpisodeNumber = item.episode_number;
        await populateEpisodesForTV(currentMedia.id, currentSeasonNumber);
        episodeSelect.value = currentEpisodeNumber;
        progressMinutes.value = item.progress_minutes;
        updateEmbedStream();
      }
      continuePanel.classList.remove('open');
    };
    continueList.appendChild(div);
  });
}

// ================= TV HELPERS =================
async function populateEpisodesForTV(tvId, seasonNum) {
  const url = `https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNum}?api_key=${TMDB_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  const episodes = data.episodes || [];
  episodeSelect.innerHTML = '';
  episodes.forEach(ep => {
    const opt = document.createElement('option');
    opt.value = ep.episode_number;
    opt.textContent = `Episode ${ep.episode_number}: ${ep.name.substring(0,40)}`;
    episodeSelect.appendChild(opt);
  });
  if (episodes.length === 0) episodeSelect.innerHTML = '<option value="1">Episode 1</option>';
  episodeSelect.value = currentEpisodeNumber;
}

async function setupTVControls(tvId, seasonsArray) {
  if (!seasonsArray.length) { tvControls.classList.add('hidden'); return; }
  tvControls.classList.remove('hidden');
  seasonSelect.innerHTML = '';
  seasonsArray.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.season_number;
    opt.textContent = `Season ${s.season_number}`;
    seasonSelect.appendChild(opt);
  });
  seasonSelect.value = currentSeasonNumber;
  await populateEpisodesForTV(tvId, currentSeasonNumber);
  seasonSelect.onchange = async () => {
    currentSeasonNumber = parseInt(seasonSelect.value);
    await populateEpisodesForTV(tvId, currentSeasonNumber);
    await loadProgressForCurrent();
    updateEmbedStream();
  };
  episodeSelect.onchange = async () => {
    currentEpisodeNumber = parseInt(episodeSelect.value);
    await loadProgressForCurrent();
    updateEmbedStream();
  };
}

// ================= LOAD MOVIE/TV DETAILS =================
async function loadAndDisplayDetails(item, mediaType) {
  detailPanel.classList.remove('hidden');
  const id = item.id;
  const title = item.title || item.name;
  const posterPath = item.poster_path;
  const overview = item.overview || 'No overview available.';
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '—';
  const year = mediaType === 'movie' ? (item.release_date?.split('-')[0] || 'N/A') : (item.first_air_date?.split('-')[0] || 'N/A');
  document.getElementById('detailPoster').src = posterPath ? IMG_BASE + posterPath : 'https://via.placeholder.com/300x450?text=No+Image';
  document.getElementById('detailTitle').innerText = title;
  document.getElementById('detailOverview').innerText = overview;
  document.getElementById('detailRating').innerText = rating;
  document.getElementById('detailYear').innerText = year;
  document.getElementById('detailType').innerHTML = mediaType === 'movie' ? 'Movie' : 'TV Series';
  currentMedia = { type: mediaType, id, title, posterPath, overview, rating, year };
  if (mediaType === 'tv') {
    const tvDetails = await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}`).then(r=>r.json());
    const seasons = (tvDetails.seasons || []).filter(s => s.season_number > 0);
    await setupTVControls(id, seasons);
  } else {
    tvControls.classList.add('hidden');
  }
  await loadProgressForCurrent();
  updateEmbedStream();
}

// ================= RENDER GRID =================
async function fetchTrending() {
  const res = await fetch(`https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}`);
  const data = await res.json();
  renderItems(data.results.slice(0, 18).map(m => ({ ...m, media_type: 'movie' })));
}

async function searchMulti(query) {
  if (!query.trim()) { fetchTrending(); return; }
  const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
  const data = await res.json();
  const filtered = data.results.filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 20);
  renderItems(filtered);
}

function renderItems(items) {
  if (!items.length) {
    moviesGrid.innerHTML = '<div class="movie-card">No results found</div>';
    return;
  }
  moviesGrid.innerHTML = items.map(item => {
    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
    const title = item.title || item.name;
    const poster = item.poster_path ? IMG_BASE + item.poster_path : 'https://via.placeholder.com/300x450?text=No+Cover';
    const year = (item.release_date || item.first_air_date || '').slice(0,4);
    const rating = item.vote_average?.toFixed(1) || '';
    return `
      <div class="movie-card" data-id="${item.id}" data-type="${mediaType}">
        <img src="${poster}" loading="lazy">
        <div class="card-info">
          <h4>${title}</h4>
          <div class="meta"><span>${year || '—'}</span><span>⭐ ${rating}</span></div>
        </div>
      </div>
    `;
  }).join('');
  document.querySelectorAll('.movie-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = parseInt(card.dataset.id);
      const type = card.dataset.type;
      fetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}`)
        .then(r => r.json())
        .then(data => loadAndDisplayDetails(data, type));
    });
  });
}

// ================= AUTH =================
function updateAuthUI() {
  supabase.auth.getUser().then(({ data: { user } }) => {
    currentUser = user;
    if (user) {
      document.getElementById('authButtons').style.display = 'none';
      document.getElementById('userPanel').style.display = 'flex';
      document.getElementById('userEmail').innerText = user.email;
      loadContinueWatching();
    } else {
      document.getElementById('authButtons').style.display = 'flex';
      document.getElementById('userPanel').style.display = 'none';
      continuePanel.classList.remove('open');
    }
  });
}

// Modal handlers
const loginModal = document.getElementById('loginModal');
const signupModal = document.getElementById('signupModal');
const closeModals = document.querySelectorAll('.close-modal');
loginBtn.onclick = () => loginModal.style.display = 'flex';
signupBtn.onclick = () => signupModal.style.display = 'flex';
closeModals.forEach(btn => btn.onclick = () => { loginModal.style.display = 'none'; signupModal.style.display = 'none'; });
document.getElementById('switchToSignup').onclick = () => { loginModal.style.display = 'none'; signupModal.style.display = 'flex'; };
document.getElementById('switchToLogin').onclick = () => { signupModal.style.display = 'none'; loginModal.style.display = 'flex'; };
document.getElementById('doLoginBtn').onclick = async () => {
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPassword').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) alert(error.message);
  else { loginModal.style.display = 'none'; updateAuthUI(); }
};
document.getElementById('doSignupBtn').onclick = async () => {
  const email = document.getElementById('signupEmail').value;
  const pass = document.getElementById('signupPassword').value;
  const { error } = await supabase.auth.signUp({ email, password: pass });
  if (error) alert(error.message);
  else { alert('Account created! Please log in.'); signupModal.style.display = 'none'; }
};
logoutBtn.onclick = async () => { await supabase.auth.signOut(); updateAuthUI(); detailPanel.classList.add('hidden'); };

// ================= EVENT LISTENERS =================
clearDetailBtn.onclick = () => detailPanel.classList.add('hidden');
refreshEmbedBtn.onclick = () => updateEmbedStream();
sourceSelect.onchange = () => updateEmbedStream();
saveProgressBtn.onclick = saveWatchProgress;
jumpToTimeBtn.onclick = () => updateEmbedStream();
closeContinueBtn.onclick = () => continuePanel.classList.remove('open');
// Show continue sidebar – add a button if not exists
const continueBtn = document.createElement('button');
continueBtn.innerHTML = '<i class="fas fa-clock"></i> Continue';
continueBtn.className = 'btn-outline-small';
continueBtn.onclick = () => continuePanel.classList.toggle('open');
document.querySelector('.nav-auth').before(continueBtn);

let searchTimeout;
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const q = e.target.value.trim();
    if (q === '') fetchTrending();
    else searchMulti(q);
    if (currentMedia) detailPanel.classList.add('hidden');
  }, 500);
});

// Initialization
populateSources();
fetchTrending();
updateAuthUI();
supabase.auth.onAuthStateChange(() => updateAuthUI());
