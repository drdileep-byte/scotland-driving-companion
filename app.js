const app = document.querySelector("#app");
const prevButton = document.querySelector("#prevDay");
const nextButton = document.querySelector("#nextDay");
const todayButton = document.querySelector("#todayDay");
const installButton = document.querySelector("#installButton");

let trip;
let currentIndex = 0;
let installPrompt = null;
const unlockedStorageKey = "scotland-trip-guide-unlocked-v1";

function tripIndexForToday(days) {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const exact = days.findIndex((day) => day.date === todayKey);
  if (exact >= 0) return exact;
  if (todayKey < days[0].date) return 0;
  return days.length - 1;
}

function mapsUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function directionsUrl(query) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied`);
  } catch (error) {
    showToast(text);
  }
}

function bytesToText(bytes) {
  return new TextDecoder().decode(bytes);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passcode, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptTripData(passcode, payload) {
  const key = await deriveKey(passcode, base64ToBytes(payload.salt), payload.iterations);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext)
  );
  return JSON.parse(bytesToText(new Uint8Array(plain)));
}

function renderUnlock(error = "") {
  app.innerHTML = `
    <section class="card hero-card">
      <p class="eyebrow">Private trip guide</p>
      <h2>Unlock Scotland Driving Companion</h2>
      <p>This public PWA stores the trip details encrypted. Enter the passcode once on your father's phone while online; after unlock, the guide is saved on that phone for offline use.</p>
      <form id="unlockForm" class="unlock-form">
        <label for="passcode">Passcode</label>
        <input id="passcode" class="passcode-input" type="password" autocomplete="current-password" inputmode="text" required>
        <button class="action-button" type="submit">Unlock guide</button>
      </form>
      ${error ? `<p class="error-text">${escapeHtml(error)}</p>` : ""}
      <p class="muted">Use the rental GPS fields in the guide if internet or maps fail.</p>
    </section>
  `;
  document.querySelector("#unlockForm").addEventListener("submit", unlockWithPasscode);
}

async function unlockWithPasscode(event) {
  event.preventDefault();
  const passcode = document.querySelector("#passcode").value.trim();
  if (!passcode) return;
  try {
    const response = await fetch("encrypted-data.json");
    const payload = await response.json();
    trip = await decryptTripData(passcode, payload);
    localStorage.setItem(unlockedStorageKey, JSON.stringify(trip));
    currentIndex = tripIndexForToday(trip.days);
    renderDay();
    showToast("Guide unlocked and saved offline");
  } catch (error) {
    renderUnlock("That passcode did not unlock the guide. Check spelling and try again.");
  }
}

function showToast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2400);
}

function list(items) {
  if (!items || !items.length) return "";
  return `<ul class="list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function placeInfo(place) {
  return `
    <div class="info-grid">
      <div class="info-row"><span>Address</span>${escapeHtml(place.address || "Check source")}</div>
      <div class="info-row"><span>Postcode</span>${escapeHtml(place.postcode || "Not listed")}</div>
      <div class="info-row"><span>Coordinates</span>${escapeHtml(place.coordinates || "Use postcode first")}</div>
      <div class="info-row"><span>GPS text</span>${escapeHtml(place.gpsText || place.address || place.postcode || "")}</div>
    </div>
  `;
}

function renderAction(day) {
  const action = day.mainAction;
  return `
    <section class="card hero-card">
      <div class="day-meta">
        <span class="pill">${escapeHtml(day.label)}</span>
        <span class="pill">${formatDate(day.date)}</span>
      </div>
      <p class="route-line">${escapeHtml(day.route)}</p>
      <h2>${escapeHtml(action.label)}</h2>
      <p>${escapeHtml(action.description)}</p>
      <div class="button-grid">
        <a class="action-button" href="${directionsUrl(action.mapsQuery)}" target="_blank" rel="noopener">Navigate in Google Maps</a>
        <button class="copy-button" data-copy="${escapeHtml(action.postcode)}" data-label="Postcode">Copy postcode</button>
        <button class="copy-button" data-copy="${escapeHtml(action.gpsText)}" data-label="GPS text">Copy rental GPS text</button>
        <button class="copy-button" data-copy="${escapeHtml(action.coordinates)}" data-label="Coordinates">Copy coordinates</button>
      </div>
      ${placeInfo(action)}
      <h3 class="section-title">Driving instructions</h3>
      ${list(action.driveNotes)}
    </section>
  `;
}

function renderHotel(hotel) {
  return `
    <section class="card">
      <span class="tag">${escapeHtml(hotel.type)}</span>
      <h3>${escapeHtml(hotel.name)}</h3>
      ${placeInfo(hotel)}
      <div class="info-grid">
        <div class="info-row"><span>Check-in</span>${escapeHtml(hotel.checkIn)}</div>
        <div class="info-row"><span>Checkout</span>${escapeHtml(hotel.checkOut)}</div>
        <div class="info-row"><span>Reference</span>${escapeHtml(hotel.reference)}</div>
        <div class="info-row"><span>Phone</span>${escapeHtml(hotel.phone)}</div>
      </div>
      <h3 class="section-title">Parking / host note</h3>
      <p>${escapeHtml(hotel.parking)}</p>
      <p class="muted">${escapeHtml(hotel.note)}</p>
    </section>
  `;
}

function renderStop(stop) {
  return `
    <article class="card stop-card">
      <span class="tag">${escapeHtml(stop.category)}</span>
      <h3>${escapeHtml(stop.name)}</h3>
      <p>${escapeHtml(stop.why)}</p>
      <div class="button-grid">
        <a class="action-button" href="${mapsUrl(stop.address || stop.postcode)}" target="_blank" rel="noopener">Open map</a>
        <button class="copy-button" data-copy="${escapeHtml(stop.postcode)}" data-label="Postcode">Copy postcode</button>
        <button class="copy-button" data-copy="${escapeHtml(stop.coordinates)}" data-label="Coordinates">Copy coordinates</button>
      </div>
      <div class="info-grid">
        <div class="info-row"><span>Address</span>${escapeHtml(stop.address)}</div>
        <div class="info-row"><span>Postcode</span>${escapeHtml(stop.postcode)}</div>
        <div class="info-row"><span>Parking</span>${escapeHtml(stop.parking)}</div>
        <div class="info-row"><span>Time / difficulty</span>${escapeHtml(stop.timeNeeded)}; ${escapeHtml(stop.difficulty)}</div>
      </div>
      <h3 class="section-title">Backup</h3>
      <p>${escapeHtml(stop.backup)}</p>
    </article>
  `;
}

function renderFood(food) {
  return `
    <article class="card food-card">
      <span class="tag">${escapeHtml(food.kind)}</span>
      <h3>${escapeHtml(food.name)}</h3>
      <p>${escapeHtml(food.veg)}</p>
      <div class="info-grid">
        <div class="info-row"><span>Address</span>${escapeHtml(food.address)}</div>
        <div class="info-row"><span>Postcode</span>${escapeHtml(food.postcode)}</div>
        ${food.coordinates ? `<div class="info-row"><span>Coordinates</span>${escapeHtml(food.coordinates)}</div>` : ""}
        <div class="info-row"><span>Note</span>${escapeHtml(food.note)}</div>
      </div>
    </article>
  `;
}

function renderDay() {
  const day = trip.days[currentIndex];
  app.innerHTML = `
    <section class="card">
      <h2>${escapeHtml(day.title)}</h2>
      <p>${escapeHtml(day.overview)}</p>
    </section>
    ${renderAction(day)}
    <h2 class="section-title">Hotel / stay</h2>
    ${renderHotel(day.hotel)}
    <h2 class="section-title">Places to see</h2>
    ${day.stops.map(renderStop).join("")}
    <h2 class="section-title">Food: Indian / vegetarian first</h2>
    ${day.food.map(renderFood).join("")}
    <section class="card backup-card">
      <h2>Backup plan</h2>
      ${list(day.backups)}
    </section>
    <section class="card">
      <h2>Driving help</h2>
      ${list(trip.emergencyNotes)}
    </section>
    <section class="card source-list">
      <h2>Sources checked</h2>
      <p class="muted">Links need internet. The useful addresses, postcodes, coordinates, and notes above are stored offline.</p>
      <ul class="list">
        ${trip.sources.map((source) => `<li><a href="${source.url}" target="_blank" rel="noopener">${escapeHtml(source.label)}</a></li>`).join("")}
      </ul>
    </section>
  `;
  prevButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === trip.days.length - 1;
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copy, button.dataset.label));
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function formatDate(dateString) {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
}

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
  const cached = localStorage.getItem(unlockedStorageKey);
  if (cached) {
    trip = JSON.parse(cached);
  } else {
    renderUnlock();
    return;
  }
  currentIndex = tripIndexForToday(trip.days);
  renderDay();
}

prevButton.addEventListener("click", () => {
  if (currentIndex > 0) {
    currentIndex -= 1;
    renderDay();
  }
});

nextButton.addEventListener("click", () => {
  if (currentIndex < trip.days.length - 1) {
    currentIndex += 1;
    renderDay();
  }
});

todayButton.addEventListener("click", () => {
  currentIndex = tripIndexForToday(trip.days);
  renderDay();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.hidden = true;
});

init().catch((error) => {
  app.innerHTML = `
    <section class="card">
      <h2>Could not load the guide</h2>
      <p>${escapeHtml(error.message)}</p>
    </section>
  `;
});
