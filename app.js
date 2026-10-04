const CONFIG = {
  repoApi: "https://api.github.com/repos/Miha22NoAlliance/neironka/contents/PHOTO",
  manifest: "./gallery.json",
  imageRoot: "./PHOTO/",
  batchSize: 36
};

const state = {
  all: [],
  filtered: [],
  order: [],
  rendered: 0,
  device: "all",
  query: "",
  sort: "newest",
  layout: "masonry",
  current: 0,
  favorites: new Set(JSON.parse(localStorage.getItem("neironka-favorites") || "[]"))
};

const $ = (selector) => document.querySelector(selector);
const gallery = $("#gallery");
const loading = $("#loading");
const empty = $("#empty");
const errorBox = $("#error");
const viewer = $("#viewer");
const viewerImage = $("#viewerImage");
const viewerTitle = $("#viewerTitle");
const viewerDetails = $("#viewerDetails");
const viewerCounter = $("#viewerCounter");
const favoriteBtn = $("#favoriteBtn");
const downloadBtn = $("#downloadBtn");
const openBtn = $("#openBtn");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("#footerDate").textContent = new Date().getFullYear() + " / STATIC SITE";
  loadViewPreference();
  bindEvents();
  try {
    const files = await loadManifestOrGithub();
    state.all = files.map(normalizeFile).filter(Boolean);
    buildFilters();
    apply();
    updateStats();
    $("#statusText").textContent = "ARCHIVE ONLINE";
  } catch (error) {
    showError(error);
    $("#statusText").textContent = "ARCHIVE ERROR";
  } finally {
    loading.classList.add("hidden");
  }
}

async function loadManifestOrGithub() {
  let manifestError = null;
  try {
    const response = await fetch(CONFIG.manifest, { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.photos)) return data.photos;
    }
    manifestError = new Error("gallery.json unavailable");
  } catch (err) {
    manifestError = err;
  }

  const response = await fetch(CONFIG.repoApi, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.message || response.statusText;
    throw new Error(
      response.status === 403
        ? "GitHub API rate limit reached. Add gallery.json via your Action and the site will stop depending on the API."
        : message
    );
  }
  if (!Array.isArray(data)) throw manifestError || new Error("Unexpected GitHub API response");
  return data;
}

function normalizeFile(file) {
  if (!file) return null;
  const path = String(file.path || file.name || "").replace(/^\.\//, "");
  const name = path.split("/").pop();
  if (!name || !/^.+\.(jpe?g|png|webp|gif|avif)$/i.test(name)) return null;

  const device = file.device || detectDevice(name);
  const date = file.date || guessDate(name);
  const image = file.url || file.src || joinUrl(CONFIG.imageRoot, name);

  return {
    id: file.id || path,
    path,
    name,
    image,
    device,
    date,
    year: date ? date.slice(0, 4) : "—",
    size: Number(file.size || 0),
    width: Number(file.width || 0),
    height: Number(file.height || 0),
    caption: file.caption || file.title || ""
  };
}

function joinUrl(root, name) {
  return root + encodeURIComponent(name);
}

function detectDevice(name) {
  if (/^_?DSC/i.test(name)) return "CAMERA";
  if (/lmc|alisa/i.test(name)) return "LMC";
  if (/^PXL/i.test(name)) return "PIXEL";
  if (/^IMG/i.test(name)) return "PHONE";
  return "OTHER";
}

function guessDate(name) {
  const ymd = name.match(/(?:19|20)\d{2}[-_]?\d{2}[-_]?\d{2}/);
  if (ymd) {
    const digits = ymd[0].replace(/[-_]/g, "");
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    if (+month >= 1 && +month <= 12 && +day >= 1 && +day <= 31) return year + "-" + month + "-" + day;
  }

  const compact = name.match(/(?:IMG_|PXL_|DSC_)?((?:202[0-9])(?:\d{2})?(?:\d{2})?)/i);
  if (compact && compact[1].length >= 8) {
    const s = compact[1].slice(0, 8);
    const month = s.slice(4, 6);
    const day = s.slice(6, 8);
    if (+month >= 1 && +month <= 12 && +day >= 1 && +day <= 31) return s.slice(0,4)+"-"+month+"-"+day;
  }

  return "";
}

function buildFilters() {
  const counts = {};
  state.all.forEach(item => { counts[item.device] = (counts[item.device] || 0) + 1; });

  const container = $("#deviceFilters");
  container.innerHTML = "";

  const entries = [["all", state.all.length], ...Object.entries(counts).sort((a,b) => b[1] - a[1])];
  for (const [device, count] of entries) {
    const button = document.createElement("button");
    button.className = "filter" + (state.device === device ? " active" : "");
    button.dataset.device = device;
    button.innerHTML = device.toUpperCase() + " <small>" + count + "</small>";
    container.appendChild(button);
  }

  // The filter bar is rebuilt above, so its count is already rendered in the "ALL" button.
}

function apply() {
  state.query = $("#search").value.trim().toLowerCase();

  let items = state.all.filter(item => {
    const matchesQuery = !state.query ||
      item.name.toLowerCase().includes(state.query) ||
      item.device.toLowerCase().includes(state.query) ||
      item.caption.toLowerCase().includes(state.query);
    const matchesDevice = state.device === "all" || item.device === state.device;
    return matchesQuery && matchesDevice;
  });

  items = sortItems(items, state.sort);
  state.filtered = items;
  state.order = items.map(item => item.id);

  gallery.innerHTML = "";
  state.rendered = 0;

  const hasResults = state.filtered.length > 0;
  empty.classList.toggle("hidden", hasResults);
  gallery.classList.toggle("hidden", !hasResults);
  $("#resultText").textContent = hasResults
    ? state.filtered.length + " " + pluralize(state.filtered.length, "work", "works")
    : "0 works";

  renderBatch();
}

function sortItems(items, sort) {
  const arr = [...items];
  if (sort === "name") return arr.sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (sort === "oldest") return arr.sort(dateCompareAsc);
  if (sort === "favorites") return arr.sort((a,b) => Number(state.favorites.has(b.id)) - Number(state.favorites.has(a.id)) || dateCompareDesc(a,b));
  if (sort === "random") return arr.sort(() => Math.random() - .5);
  return arr.sort(dateCompareDesc);
}

function dateCompareDesc(a, b) {
  return (b.date || "").localeCompare(a.date || "") || b.name.localeCompare(a.name, undefined, { numeric: true });
}

function dateCompareAsc(a, b) {
  const ad = a.date || "0000-00-00";
  const bd = b.date || "0000-00-00";
  return ad.localeCompare(bd) || a.name.localeCompare(b.name, undefined, { numeric: true });
}

function renderBatch() {
  if (state.rendered >= state.filtered.length) return;
  const fragment = document.createDocumentFragment();
  const end = Math.min(state.rendered + CONFIG.batchSize, state.filtered.length);

  for (let i = state.rendered; i < end; i++) {
    fragment.appendChild(createCard(state.filtered[i], i));
  }

  gallery.appendChild(fragment);
  state.rendered = end;
}

function createCard(item, index) {
  const card = document.createElement("article");
  card.className = "card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "Open " + item.name);

  const top = document.createElement("div");
  top.className = "card-top";

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = item.device;

  const save = document.createElement("button");
  save.className = "save" + (state.favorites.has(item.id) ? " active" : "");
  save.type = "button";
  save.title = "Save";
  save.textContent = state.favorites.has(item.id) ? "★" : "☆";
  save.addEventListener("click", event => {
    event.stopPropagation();
    toggleFavorite(item.id, save);
  });

  top.append(badge, save);

  const img = document.createElement("img");
  img.loading = index < 8 ? "eager" : "lazy";
  img.decoding = "async";
  img.alt = item.caption || item.name;
  img.src = item.image;
  img.addEventListener("error", () => {
    img.style.opacity = "0.15";
  });

  const overlay = document.createElement("div");
  overlay.className = "card-overlay";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = item.caption || item.name;
  title.title = item.name;

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = [item.device, item.year !== "—" ? item.year : "", item.width && item.height ? item.width + "×" + item.height : ""]
    .filter(Boolean).join("  /  ");

  const idx = document.createElement("div");
  idx.className = "card-index";
  idx.textContent = "#" + String(index + 1).padStart(3, "0");

  overlay.append(title, meta, idx);
  card.append(top, img, overlay);
  card.addEventListener("click", () => openViewer(index));
  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openViewer(index);
    }
  });
  return card;
}

function openViewer(index) {
  if (!state.filtered.length) return;
  state.current = (index + state.filtered.length) % state.filtered.length;
  const item = state.filtered[state.current];

  viewerImage.src = item.image;
  viewerImage.alt = item.caption || item.name;
  viewerTitle.textContent = item.caption || item.name;
  viewerCounter.textContent = String(state.current + 1) + " / " + state.filtered.length;

  const details = [
    item.device,
    item.year !== "—" ? item.year : "",
    item.width && item.height ? item.width + " × " + item.height : "",
    item.size ? formatBytes(item.size) : ""
  ].filter(Boolean);

  viewerDetails.textContent = details.join("   ·   ");
  favoriteBtn.classList.toggle("active", state.favorites.has(item.id));
  favoriteBtn.textContent = state.favorites.has(item.id) ? "★" : "☆";
  downloadBtn.href = item.image;
  downloadBtn.download = item.name;
  openBtn.href = item.image;

  if (!viewer.open) viewer.showModal();
}

function closeViewer() {
  viewer.close();
  viewerImage.src = "";
}

function go(delta) {
  if (!state.filtered.length) return;
  openViewer(state.current + delta);
}

function toggleFavorite(id, button) {
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  localStorage.setItem("neironka-favorites", JSON.stringify([...state.favorites]));
  const active = state.favorites.has(id);
  if (button) {
    button.classList.toggle("active", active);
    button.textContent = active ? "★" : "☆";
  }
  updateStats();
}

function updateStats() {
  $("#photoCount").textContent = state.all.length;
  $("#deviceCount").textContent = new Set(state.all.map(x => x.device)).size;
  $("#favoriteCount").textContent = state.favorites.size;
}

function loadViewPreference() {
  const saved = localStorage.getItem("neironka-layout");
  if (saved === "grid" || saved === "masonry") state.layout = saved;
  applyLayout();
}

function applyLayout() {
  gallery.classList.toggle("masonry", state.layout === "masonry");
  gallery.classList.toggle("grid", state.layout === "grid");
  $("#viewBtn").textContent = state.layout === "masonry" ? "MASONRY" : "GRID";
}

function bindEvents() {
  $("#search").addEventListener("input", debounce(apply, 120));
  $("#sort").addEventListener("change", event => {
    state.sort = event.target.value;
    apply();
  });

  $("#deviceFilters").addEventListener("click", event => {
    const button = event.target.closest(".filter");
    if (!button) return;
    state.device = button.dataset.device;
    document.querySelectorAll(".filter").forEach(el => el.classList.toggle("active", el === button));
    apply();
  });

  $("#shuffleBtn").addEventListener("click", () => {
    state.sort = "random";
    $("#sort").value = "random";
    apply();
    window.scrollTo({ top: document.querySelector(".gallery").offsetTop - 130, behavior: "smooth" });
  });

  $("#viewBtn").addEventListener("click", () => {
    state.layout = state.layout === "masonry" ? "grid" : "masonry";
    localStorage.setItem("neironka-layout", state.layout);
    applyLayout();
  });

  $("#viewerClose").addEventListener("click", closeViewer);
  $("#prevBtn").addEventListener("click", () => go(-1));
  $("#nextBtn").addEventListener("click", () => go(1));
  favoriteBtn.addEventListener("click", () => toggleFavorite(state.filtered[state.current]?.id));
  viewer.addEventListener("click", event => {
    if (event.target === viewer) closeViewer();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
      event.preventDefault();
      $("#search").focus();
    }
    if (!viewer.open) return;
    if (event.key === "Escape") closeViewer();
    if (event.key === "ArrowLeft") go(-1);
    if (event.key === "ArrowRight") go(1);
  });

  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) renderBatch();
  }, { rootMargin: "700px" });
  observer.observe(loading);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function pluralize(n, one, many) {
  return n === 1 ? one : many;
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function showError(error) {
  errorBox.textContent = error?.message || "Could not load the archive.";
  errorBox.classList.remove("hidden");
}