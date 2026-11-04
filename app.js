const CONFIG = {
  repoApi: "https://api.github.com/repos/Miha22NoAlliance/neironka/contents/PHOTO",
  manifest: "./gallery.json",
  imageRoot: "./PHOTO/",
  batchSize: 30
};

const state = {
  all: [],
  filtered: [],
  rendered: 0,
  device: "all",
  query: "",
  sort: "newest",
  layout: "masonry",
  currentIdx: 0,
  favorites: new Set(JSON.parse(localStorage.getItem("neironka-favs") || "[]"))
};

const $ = sel => document.querySelector(sel);
const gallery = $("#gallery");
const viewer = $("#viewer");
const viewerImg = $("#viewerImage");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("#footerYear").textContent = new Date().getFullYear();
  state.layout = localStorage.getItem("neironka-layout") || "masonry";
  updateLayoutUI();
  bindEvents();

  try {
    const rawFiles = await loadData();
    state.all = rawFiles.map(normalize).filter(Boolean);
    buildFilters();
    applyFilterAndSort();
    updateStats();
    $("#statusText").textContent = "ONLINE";
  } catch (err) {
    $("#error").textContent = err.message || "Ошибка загрузки";
    $("#error").classList.remove("hidden");
    $("#statusText").textContent = "OFFLINE";
  } finally {
    $("#loading").classList.add("hidden");
  }
}

// 1. Быстрая загрузка данных
async function loadData() {
  try {
    const res = await fetch(CONFIG.manifest, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data) ? data : data.photos || [];
    }
  } catch (_) {}

  // Fallback на GitHub API
  const res = await fetch(CONFIG.repoApi);
  if (!res.ok) throw new Error("Лимит запросов к GitHub API. Создайте gallery.json.");
  return await res.json();
}

function normalize(f) {
  if (!f) return null;
  const name = (f.name || f.path || "").split("/").pop();
  if (!name || !/\.(jpe?g|png|webp|gif|avif)$/i.test(name)) return null;

  return {
    id: name,
    name,
    src: f.download_url || f.url || (CONFIG.imageRoot + encodeURIComponent(name)),
    device: detectDevice(name),
    date: extractDate(name),
    size: f.size || 0
  };
}

function detectDevice(name) {
  if (/^_?DSC/i.test(name)) return "CAMERA";
  if (/lmc|alisa/i.test(name)) return "LMC";
  if (/^PXL/i.test(name)) return "PIXEL";
  if (/^IMG/i.test(name)) return "PHONE";
  return "OTHER";
}

function extractDate(name) {
  const match = name.match(/(?:19|20)\d{2}[-_]?\d{2}[-_]?\d{2}/);
  if (match) {
    const clean = match[0].replace(/[-_]/g, "");
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  return "";
}

// 2. Фильтрация и рендеринг
function applyFilterAndSort() {
  state.filtered = state.all.filter(item => {
    const matchesDevice = state.device === "all" || item.device === state.device;
    const matchesQuery = !state.query || item.name.toLowerCase().includes(state.query);
    return matchesDevice && matchesQuery;
  });

  // Сортировка
  const { sort } = state;
  if (sort === "name") state.filtered.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  else if (sort === "oldest") state.filtered.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  else if (sort === "favorites") state.filtered.sort((a, b) => state.favorites.has(b.id) - state.favorites.has(a.id));
  else if (sort === "random") state.filtered.sort(() => Math.random() - 0.5);
  else state.filtered.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  gallery.innerHTML = "";
  state.rendered = 0;

  const count = state.filtered.length;
  $("#resultCount").textContent = `${count} фото`;
  $("#empty").classList.toggle("hidden", count > 0);

  renderBatch();
}

function renderBatch() {
  if (state.rendered >= state.filtered.length) return;
  const chunk = state.filtered.slice(state.rendered, state.rendered + CONFIG.batchSize);
  
  const html = chunk.map((item, idx) => {
    const globalIdx = state.rendered + idx;
    const isFav = state.favorites.has(item.id);
    return `
      <article class="card" data-index="${globalIdx}">
        <span class="card-badge">${item.device}</span>
        <button class="card-fav ${isFav ? 'active' : ''}" data-id="${item.id}">${isFav ? '★' : '☆'}</button>
        <img src="${item.src}" alt="${item.name}" loading="lazy" decoding="async">
        <div class="card-overlay">
          <span class="card-title">${item.name}</span>
          <small>${item.date}</small>
        </div>
      </article>
    `;
  }).join("");

  gallery.insertAdjacentHTML("beforeend", html);
  state.rendered += chunk.length;
}

// 3. Делегирование событий (Event Delegation)
function bindEvents() {
  // Клик в карточку / избранное через родителя галереи
  gallery.addEventListener("click", e => {
    const favBtn = e.target.closest(".card-fav");
    if (favBtn) {
      e.stopPropagation();
      toggleFavorite(favBtn.dataset.id, favBtn);
      return;
    }
    const card = e.target.closest(".card");
    if (card) openViewer(Number(card.dataset.index));
  });

  // Поиск и фильтры
  $("#search").addEventListener("input", e => {
    state.query = e.target.value.trim().toLowerCase();
    applyFilterAndSort();
  });

  $("#deviceFilters").addEventListener("click", e => {
    const pill = e.target.closest(".pill");
    if (!pill) return;
    document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    state.device = pill.dataset.device;
    applyFilterAndSort();
  });

  $("#sort").addEventListener("change", e => {
    state.sort = e.target.value;
    applyFilterAndSort();
  });

  $("#shuffleBtn").addEventListener("click", () => {
    state.sort = "random";
    $("#sort").value = "random";
    applyFilterAndSort();
  });

  $("#viewBtn").addEventListener("click", () => {
    state.layout = state.layout === "masonry" ? "grid" : "masonry";
    localStorage.setItem("neironka-layout", state.layout);
    updateLayoutUI();
  });

  // Лайтбокс
  $("#viewerClose").addEventListener("click", () => viewer.close());
  $("#prevBtn").addEventListener("click", () => navigateViewer(-1));
  $("#nextBtn").addEventListener("click", () => navigateViewer(1));
  $("#favBtnModal").addEventListener("click", () => {
    const item = state.filtered[state.currentIdx];
    if (item) toggleFavorite(item.id);
  });

  // Горячие клавиши
  document.addEventListener("keydown", e => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      $("#search").focus();
    }
    if (!viewer.open) return;
    if (e.key === "ArrowLeft") navigateViewer(-1);
    if (e.key === "ArrowRight") navigateViewer(1);
    if (e.key === "Escape") viewer.close();
  });

  // Поддержка свайпов на тачскринах в модалке
  let touchStartX = 0;
  viewer.addEventListener("touchstart", e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  viewer.addEventListener("touchend", e => {
    const touchEndX = e.changedTouches[0].screenX;
    if (touchStartX - touchEndX > 50) navigateViewer(1);
    if (touchEndX - touchStartX > 50) navigateViewer(-1);
  }, { passive: true });

  // Бесконечный скролл через IntersectionObserver
  new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) renderBatch();
  }, { rootMargin: "600px" }).observe($("#loading"));
}

// 4. Полноэкранный просмотр
function openViewer(idx) {
  if (!state.filtered[idx]) return;
  state.currentIdx = idx;
  const item = state.filtered[idx];

  viewerImg.src = item.src;
  $("#viewerTitle").textContent = item.name;
  $("#viewerCounter").textContent = `${idx + 1} / ${state.filtered.length}`;
  $("#viewerMeta").textContent = [item.device, item.date, formatBytes(item.size)].filter(Boolean).join("  ·  ");
  
  const isFav = state.favorites.has(item.id);
  $("#favBtnModal").classList.toggle("active", isFav);
  $("#favBtnModal").textContent = isFav ? "★" : "☆";

  $("#downloadBtn").href = item.src;
  $("#downloadBtn").download = item.name;
  $("#openBtn").href = item.src;

  if (!viewer.open) viewer.showModal();
}

function navigateViewer(step) {
  const next = state.currentIdx + step;
  if (next >= 0 && next < state.filtered.length) openViewer(next);
}

// 5. Избранное и утилиты
function toggleFavorite(id, domBtn = null) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);

  localStorage.setItem("neironka-favs", JSON.stringify([...state.favorites]));
  const active = state.favorites.has(id);

  if (domBtn) {
    domBtn.classList.toggle("active", active);
    domBtn.textContent = active ? "★" : "☆";
  }
  $("#favBtnModal").classList.toggle("active", active);
  $("#favBtnModal").textContent = active ? "★" : "☆";

  updateStats();
}

function updateStats() {
  $("#photoCount").textContent = state.all.length;
  $("#deviceCount").textContent = new Set(state.all.map(x => x.device)).size;
  $("#favoriteCount").textContent = state.favorites.size;
}

function buildFilters() {
  const counts = state.all.reduce((acc, x) => (acc[x.device] = (acc[x.device] || 0) + 1, acc), {});
  const html = ['<button class="pill active" data-device="all">ALL</button>']
    .concat(Object.entries(counts).map(([dev, cnt]) => `<button class="pill" data-device="${dev}">${dev} (${cnt})</button>`))
    .join("");
  $("#deviceFilters").innerHTML = html;
}

function updateLayoutUI() {
  gallery.className = `gallery ${state.layout}`;
  $("#viewBtn").textContent = state.layout.toUpperCase();
}

function formatBytes(b) {
  return b ? `${(b / (1024 * 1024)).toFixed(1)} MB` : "";
}