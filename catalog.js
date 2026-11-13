(function () {
  var cfg = window.CATALOG_CONFIG || {};
  var SHEET_URL = (cfg.sheetCsvUrl || "").trim();
  var LOCAL_URL = "products.csv";
  var REFRESH_MS = Math.max(10, cfg.refreshSeconds || 30) * 1000;
  var CACHE_KEY = "catalog-cache-v1";

  var grid = document.getElementById("grid");
  var chips = document.getElementById("chips");
  var statusEl = document.getElementById("status");

  var items = [];
  var activeCat = "Все";
  var lastSignature = {};

  // --- CSV: кавычки, запятые и переносы строк внутри ячеек ---
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    var rows = [], row = [], cell = "", inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
        } else { cell += ch; }
      } else if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else { cell += ch; }
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ""; }); });
  }

  // Столбцы ищем по названию, поэтому их порядок в таблице не важен.
  var COLUMNS = {
    cat: ["раздел", "категория"],
    name: ["название", "товар"],
    price: ["цена", "стоимость"],
    desc: ["описание"],
    photo: ["фото", "картинка", "изображение"],
    stock: ["в наличии", "наличие", "есть"],
  };

  function toItems(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var idx = {};
    Object.keys(COLUMNS).forEach(function (key) {
      idx[key] = head.findIndex(function (h) { return COLUMNS[key].indexOf(h) !== -1; });
    });
    if (idx.name === -1) throw new Error("В таблице нет столбца «Название»");
    var get = function (r, key) { return idx[key] === -1 ? "" : (r[idx[key]] || "").trim(); };

    return rows.slice(1).map(function (r) {
      return {
        cat: get(r, "cat") || "Разное",
        name: get(r, "name"),
        price: get(r, "price"),
        desc: get(r, "desc"),
        photo: get(r, "photo"),
        inStock: !/^(нет|-|0|no|false)$/i.test(get(r, "stock")),
      };
    }).filter(function (it) { return it.name && it.inStock; });
  }

  function formatPrice(p) {
    var n = Number(String(p).replace(/\s/g, "").replace(",", "."));
    if (p !== "" && isFinite(n)) return n.toLocaleString("ru-RU") + " ₽";
    return p;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function renderChips() {
    var cats = ["Все"];
    items.forEach(function (it) { if (cats.indexOf(it.cat) === -1) cats.push(it.cat); });
    if (cats.indexOf(activeCat) === -1) activeCat = "Все";
    chips.innerHTML = "";
    cats.forEach(function (c) {
      var b = el("button", "chip", c);
      b.type = "button";
      b.setAttribute("aria-pressed", String(c === activeCat));
      b.addEventListener("click", function () { activeCat = c; render(false); });
      chips.appendChild(b);
    });
  }

  function render(highlightChanges) {
    renderChips();
    grid.innerHTML = "";
    var shown = items.filter(function (it) { return activeCat === "Все" || it.cat === activeCat; });
    if (!shown.length) {
      grid.appendChild(el("p", "empty", "Здесь пока пусто."));
      return;
    }
    var nextSignature = {};
    shown.forEach(function (it) {
      var card = el("article", "card");
      var photo = el("div", "photo");
      if (it.photo) {
        var img = document.createElement("img");
        img.src = it.photo;
        img.alt = it.name;
        img.loading = "lazy";
        img.onerror = function () { photo.textContent = it.name.charAt(0); };
        photo.appendChild(img);
      } else {
        photo.textContent = it.name.charAt(0);
      }
      var body = el("div", "body");
      body.appendChild(el("span", "cat", it.cat));
      body.appendChild(el("h2", "name", it.name));
      if (it.desc) body.appendChild(el("p", "desc", it.desc));
      if (it.price) body.appendChild(el("div", "price", formatPrice(it.price)));
      card.appendChild(photo);
      card.appendChild(body);
      grid.appendChild(card);

      var sig = [it.price, it.desc, it.photo].join("|");
      nextSignature[it.name] = sig;
      if (highlightChanges && lastSignature[it.name] !== sig) {
        card.classList.add("flash");
        setTimeout(function () { card.classList.remove("flash"); }, 2500);
      }
    });
    lastSignature = Object.assign(lastSignature, nextSignature);
  }

  function setStatus(text, warn) {
    statusEl.textContent = text;
    statusEl.classList.toggle("warn", !!warn);
  }

  function time() {
    return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) { return null; }
  }
  function writeCache(list) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items: list, at: Date.now() })); } catch (e) {}
  }

  function fetchText(url) {
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    return fetch(url + sep + "t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  var firstLoad = true;

  function load() {
    var url = SHEET_URL || LOCAL_URL;
    fetchText(url)
      .then(function (text) {
        var list = toItems(parseCSV(text));
        var changed = JSON.stringify(list) !== JSON.stringify(items);
        items = list;
        if (changed || firstLoad) render(!firstLoad);
        writeCache(list);
        setStatus(SHEET_URL
          ? "Данные из таблицы · проверено в " + time()
          : "Пример данных из файла products.csv · таблица ещё не подключена");
      })
      .catch(function (err) {
        var cached = readCache();
        if (firstLoad && cached && cached.items && cached.items.length) {
          items = cached.items;
          render(false);
          setStatus("Таблица сейчас не ответила – показана сохранённая версия", true);
        } else if (firstLoad) {
          setStatus("Не удалось загрузить ассортимент: " + err.message, true);
        }
      })
      .then(function () { firstLoad = false; });
  }

  load();
  setInterval(function () { if (!document.hidden) load(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
