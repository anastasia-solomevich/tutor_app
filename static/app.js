const tg = window.Telegram && window.Telegram.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  const p = tg.themeParams || {};
  const root = document.documentElement.style;
  if (p.bg_color) root.setProperty("--tg-bg", p.bg_color);
  if (p.secondary_bg_color) root.setProperty("--tg-secondary-bg", p.secondary_bg_color);
  if (p.text_color) root.setProperty("--tg-text", p.text_color);
  if (p.hint_color) root.setProperty("--tg-hint", p.hint_color);
  if (p.link_color) root.setProperty("--tg-link", p.link_color);
  if (p.button_color) { root.setProperty("--accent", p.button_color); root.setProperty("--tg-link", p.button_color); }
}

// ---------------------------------------------------------------------------
// Безопасная зона сверху (шторка со временем/батареей на телефоне)
// ---------------------------------------------------------------------------

function applySafeArea() {
  if (!tg) return;
  const sa = tg.safeAreaInset || {};
  const csa = tg.contentSafeAreaInset || {};
  const top = Math.max(sa.top || 0, csa.top || 0);
  document.documentElement.style.setProperty("--tg-safe-top", top + "px");
}

if (tg) {
  applySafeArea();
  if (tg.onEvent) {
    tg.onEvent("safeAreaChanged", applySafeArea);
    tg.onEvent("contentSafeAreaChanged", applySafeArea);
    tg.onEvent("viewportChanged", applySafeArea);
  }
}

const WEEKDAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const screenEl = document.getElementById("screen");
const titleEl = document.getElementById("screen-title");
const TITLES = { students: "Ученики", today: "Уроки", week: "Неделя", calc: "Расчёт", backup: "Резервная копия" };

let currentTab = "students";
let studentsCache = [];
let todayDate = isoToday();
let mainButtonHandler = null;
let currency = "руб.";

// ---------------------------------------------------------------------------
// Дата — работаем в UTC-представлении строки "YYYY-MM-DD", чтобы часовой
// пояс телефона не сдвигал дату при листании (из-за этого раньше не
// работала стрелочка "вперёд" в уроках).
// ---------------------------------------------------------------------------

function isoToday() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso, delta) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function fmtPrice(v) {
  const n = parseFloat(v);
  return (Math.round(n * 100) / 100).toString();
}

function fmtDateLabel(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function notify(msg) {
  if (tg && tg.showAlert) tg.showAlert(msg);
  else alert(msg);
}

function confirmAction(msg) {
  return new Promise((resolve) => {
    if (tg && tg.showConfirm) tg.showConfirm(msg, (ok) => resolve(ok));
    else resolve(confirm(msg));
  });
}

function haptic(kind) {
  if (tg && tg.HapticFeedback) {
    if (kind === "error") tg.HapticFeedback.notificationOccurred("error");
    else tg.HapticFeedback.notificationOccurred("success");
  }
}

function copyText(text, okMsg = "Скопировано в буфер обмена.") {
  if (!text) return notify("Тут пока пусто.");
  navigator.clipboard.writeText(text).then(() => notify(okMsg)).catch(() => notify("Не удалось скопировать."));
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const headers = Object.assign(
    { "Content-Type": "application/json", "X-Telegram-Init-Data": tg ? tg.initData : "" },
    options.headers || {}
  );
  const res = await fetch(path, Object.assign({}, options, { headers }));
  let data = null;
  try { data = await res.json(); } catch (e) { /* пусто */ }
  if (!res.ok) {
    const msg = (data && data.error) || "Что-то пошло не так.";
    haptic("error");
    notify(msg);
    throw new Error(msg);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Нижний лист (форма)
// ---------------------------------------------------------------------------

const overlay = document.getElementById("sheet-overlay");
const sheet = document.getElementById("sheet");

function openSheet(html) {
  sheet.innerHTML = `<button class="sheet-close" data-close>✕</button>${html}`;
  overlay.classList.remove("hidden");
}

function closeSheet() {
  overlay.classList.add("hidden");
  sheet.innerHTML = "";
  if (tg) {
    if (mainButtonHandler) tg.MainButton.offClick(mainButtonHandler);
    mainButtonHandler = null;
    tg.MainButton.hide();
  }
}

overlay.addEventListener("click", (e) => {
  if (e.target === overlay || e.target.hasAttribute("data-close")) closeSheet();
});

function setMainButton(text, onClick) {
  if (!tg) return null;
  // Убираем обработчик от предыдущего открытия формы — иначе Telegram
  // копит их, и один клик срабатывает несколько раз (создавая дубли).
  if (mainButtonHandler) tg.MainButton.offClick(mainButtonHandler);

  tg.MainButton.setText(text);
  tg.MainButton.show();
  tg.MainButton.enable();

  mainButtonHandler = async () => {
    tg.MainButton.showProgress(false);
    tg.MainButton.disable();
    try {
      await onClick();
    } catch (e) {
      // Ошибка уже показана внутри api(); просто возвращаем кнопку в рабочее состояние.
    } finally {
      tg.MainButton.hideProgress();
      tg.MainButton.enable();
    }
  };
  tg.MainButton.onClick(mainButtonHandler);
  return mainButtonHandler;
}

// ---------------------------------------------------------------------------
// Вкладки
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  titleEl.textContent = TITLES[tab];
  if (!overlay.classList.contains("hidden")) closeSheet();
  render();
}

function render() {
  if (currentTab === "students") return renderStudents();
  if (currentTab === "today") return renderToday();
  if (currentTab === "week") return renderWeek();
  if (currentTab === "calc") return renderCalc();
  if (currentTab === "backup") return renderBackup();
}

// ---------------------------------------------------------------------------
// Ученики
// ---------------------------------------------------------------------------

async function renderStudents() {
  screenEl.innerHTML = `<div class="loading">Загрузка…</div>`;
  const students = await api("/api/students");
  studentsCache = students;

  if (!students.length) {
    screenEl.innerHTML = `<div class="empty">Пока нет ни одного ученика.</div>
      <button class="btn btn-primary btn-block fab" id="add-student">➕ Добавить ученика</button>`;
  } else {
    screenEl.innerHTML =
      students.map((s) => `
        <div class="card" data-open-student="${s.id}">
          <div class="card-row">
            <div class="card-title">${escapeHtml(s.name)}</div>
            <div class="price-tag">${fmtPrice(s.price)}</div>
          </div>
          ${(s.meeting_link || s.board_link || s.comment) ? `
            <div class="quick-links">
              ${s.meeting_link ? `<button data-quick-copy="${escapeHtml(s.meeting_link)}">🔗 Встреча</button>` : ""}
              ${s.board_link ? `<button data-quick-copy="${escapeHtml(s.board_link)}">🖼 Доска</button>` : ""}
              ${s.comment ? `<button data-quick-copy="${escapeHtml(s.comment)}">💬 Комментарий</button>` : ""}
            </div>` : ""}
        </div>`).join("") +
      `<button class="btn btn-primary btn-block fab" id="add-student">➕ Добавить ученика</button>`;
  }

  document.getElementById("add-student").addEventListener("click", () => openStudentForm());
  screenEl.querySelectorAll("[data-open-student]").forEach((el) => {
    el.addEventListener("click", () => openStudentDetail(parseInt(el.dataset.openStudent, 10)));
  });
  screenEl.querySelectorAll("[data-quick-copy]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyText(btn.dataset.quickCopy);
    });
  });
}

function openStudentForm() {
  openSheet(`
    <h2>Новый ученик</h2>
    <div class="field"><label>Имя</label><input id="f-name" type="text" placeholder="Имя ученика"></div>
    <div class="field"><label>Цена урока</label><input id="f-price" type="number" inputmode="decimal" placeholder="1500"></div>
    <div class="field"><label>Ссылка на встречу</label><input id="f-meeting" type="text" placeholder="https://..."></div>
    <div class="field"><label>Ссылка на доску</label><input id="f-board" type="text" placeholder="https://..."></div>
    <div class="field"><label>Комментарий</label><textarea id="f-comment" class="f-textarea" rows="2" placeholder="Заметка об ученике"></textarea></div>
  `);
  setMainButton("Добавить", async () => {
    const name = document.getElementById("f-name").value.trim();
    const price = document.getElementById("f-price").value;
    if (!name || !price) return notify("Заполните имя и цену.");
    const meeting_link = document.getElementById("f-meeting").value.trim();
    const board_link = document.getElementById("f-board").value.trim();
    const comment = document.getElementById("f-comment").value.trim();
    await api("/api/students", { method: "POST", body: JSON.stringify({ name, price, meeting_link, board_link, comment }) });
    haptic();
    closeSheet();
    renderStudents();
  });
}

function fieldWithCopy(id, label, value, placeholder, multiline = false) {
  const tag = multiline
    ? `<textarea id="${id}" class="f-textarea" rows="2" placeholder="${placeholder}">${escapeHtml(value || "")}</textarea>`
    : `<input id="${id}" type="text" value="${escapeHtml(value || "")}" placeholder="${placeholder}">`;
  return `
    <div class="field">
      <label>${label}</label>
      <div class="field-copy">
        ${tag}
        <button type="button" data-copy-field="${id}">📋</button>
      </div>
    </div>`;
}

async function openStudentDetail(id) {
  const s = studentsCache.find((x) => x.id === id);
  const slots = await api(`/api/students/${id}/schedule`);
  openSheet(`
    <h2>${escapeHtml(s.name)}</h2>
    <div class="field"><label>Имя</label><input id="f-name" type="text" value="${escapeHtml(s.name)}"></div>
    <div class="field"><label>Цена урока</label><input id="f-price" type="number" inputmode="decimal" value="${s.price}"></div>
    ${fieldWithCopy("f-meeting", "Ссылка на встречу", s.meeting_link, "https://...")}
    ${fieldWithCopy("f-board", "Ссылка на доску", s.board_link, "https://...")}
    ${fieldWithCopy("f-comment", "Комментарий", s.comment, "Заметка об ученике", true)}
    <button class="btn btn-soft btn-block" id="save-student">Сохранить изменения</button>
    <hr class="sep">
    <div class="field"><label>Регулярное расписание</label></div>
    <div class="schedule-list">
      ${slots.length ? slots.map((sl) => `
        <div class="schedule-slot">
          <span>${WEEKDAY_NAMES[sl.weekday]}, ${sl.lesson_time.slice(0, 5)}</span>
          <button data-del-slot="${sl.id}">✕</button>
        </div>`).join("") : '<div class="card-sub">Расписание не задано</div>'}
    </div>
    <div class="field">
      <label>День недели</label>
      <select id="f-weekday">${WEEKDAY_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join("")}</select>
    </div>
    <div class="field"><label>Время</label><input id="f-time" type="time"></div>
    <button class="btn btn-soft btn-block" id="add-slot">➕ Добавить время в расписание</button>
    <hr class="sep">
    <button class="btn btn-danger btn-block" id="delete-student">🗑 Удалить ученика</button>
  `);

  sheet.querySelectorAll("[data-copy-field]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const el = document.getElementById(btn.dataset.copyField);
      copyText(el.value.trim());
    });
  });

  document.getElementById("save-student").addEventListener("click", async () => {
    const name = document.getElementById("f-name").value.trim();
    const price = document.getElementById("f-price").value;
    if (!name || !price) return notify("Заполните имя и цену.");
    const meeting_link = document.getElementById("f-meeting").value.trim();
    const board_link = document.getElementById("f-board").value.trim();
    const comment = document.getElementById("f-comment").value.trim();
    await api(`/api/students/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, price, meeting_link, board_link, comment }),
    });
    haptic();
    closeSheet();
    renderStudents();
  });

  document.getElementById("add-slot").addEventListener("click", async () => {
    const weekday = parseInt(document.getElementById("f-weekday").value, 10);
    const time = document.getElementById("f-time").value;
    if (!time) return notify("Укажите время.");
    await api(`/api/students/${id}/schedule`, { method: "POST", body: JSON.stringify({ weekday, time }) });
    haptic();
    openStudentDetail(id);
  });

  sheet.querySelectorAll("[data-del-slot]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/schedule/${btn.dataset.delSlot}`, { method: "DELETE" });
      openStudentDetail(id);
    });
  });

  document.getElementById("delete-student").addEventListener("click", async () => {
    const ok = await confirmAction(`Удалить ${s.name} вместе со всем расписанием и историей уроков?`);
    if (!ok) return;
    await api(`/api/students/${id}`, { method: "DELETE" });
    haptic();
    closeSheet();
    renderStudents();
  });
}

// ---------------------------------------------------------------------------
// Уроки (за выбранную дату)
// ---------------------------------------------------------------------------

async function renderToday() {
  screenEl.innerHTML = `
    <div class="date-nav">
      <button class="icon-btn" id="day-prev">◀</button>
      <input type="date" id="day-picker" value="${todayDate}">
      <button class="icon-btn" id="day-next">▶</button>
    </div>
    <div id="lessons-list" class="card"><div class="loading">Загрузка…</div></div>
    <button class="btn btn-primary btn-block fab" id="add-lesson">➕ Урок вне расписания</button>
  `;
  document.getElementById("day-picker").addEventListener("change", (e) => {
    todayDate = e.target.value;
    renderToday();
  });
  document.getElementById("day-prev").addEventListener("click", () => shiftDay(-1));
  document.getElementById("day-next").addEventListener("click", () => shiftDay(1));
  document.getElementById("add-lesson").addEventListener("click", () => openAddLesson());

  const lessons = await api(`/api/lessons?date=${todayDate}`);
  const listEl = document.getElementById("lessons-list");
  if (!lessons.length) {
    listEl.outerHTML = `<div class="empty" id="lessons-list">На ${fmtDateLabel(todayDate)} уроков нет.</div>`;
    return;
  }
  listEl.innerHTML = lessons.map(lessonRow).join("");
  bindLessonActions(listEl, lessons);
}

function shiftDay(delta) {
  todayDate = addDaysIso(todayDate, delta);
  renderToday();
}

function lessonRow(l) {
  const dot = l.conducted === true ? "yes" : l.conducted === false ? "no" : "";
  return `
    <div class="lesson" data-lesson="${l.id}">
      <div class="lesson-time">${l.lesson_time.slice(0, 5)}</div>
      <div class="status-dot ${dot}"></div>
      <div class="lesson-info" data-open-comment>
        <div class="lesson-name">${escapeHtml(l.student_name)}${l.comment ? '<span class="comment-flag">💬</span>' : ""}</div>
        <div class="lesson-price">${fmtPrice(l.price)}</div>
      </div>
      <div class="lesson-actions">
        <button class="${l.conducted === true ? "on-yes" : ""}" data-mark="1" title="Проведён">✓</button>
        <button class="${l.conducted === false ? "on-no" : ""}" data-mark="0" title="Не проведён">✕</button>
        <button data-del title="Удалить">🗑</button>
      </div>
    </div>`;
}

function bindLessonActions(container, lessons) {
  container.querySelectorAll("[data-lesson]").forEach((row) => {
    const id = parseInt(row.dataset.lesson, 10);
    const lesson = lessons.find((l) => l.id === id);
    row.querySelector("[data-open-comment]").addEventListener("click", () => openLessonComment(lesson));
    row.querySelectorAll("[data-mark]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api(`/api/lessons/${id}`, { method: "PATCH", body: JSON.stringify({ conducted: btn.dataset.mark === "1" }) });
        haptic();
        renderToday();
      });
    });
    row.querySelector("[data-del]").addEventListener("click", async () => {
      const ok = await confirmAction("Удалить этот урок из истории?");
      if (!ok) return;
      await api(`/api/lessons/${id}`, { method: "DELETE" });
      haptic();
      renderToday();
    });
  });
}

function openLessonComment(l) {
  openSheet(`
    <h2>${escapeHtml(l.student_name)}, ${fmtDateLabel(l.lesson_date)} (${l.lesson_time.slice(0, 5)})</h2>
    <div class="field"><label>Комментарий к уроку</label>
      <textarea id="f-lesson-comment" class="f-textarea" rows="4" placeholder="Что прошли, домашнее задание, заметки…">${escapeHtml(l.comment || "")}</textarea>
    </div>
  `);
  setMainButton("Сохранить", async () => {
    const comment = document.getElementById("f-lesson-comment").value.trim();
    await api(`/api/lessons/${l.id}`, { method: "PATCH", body: JSON.stringify({ comment }) });
    haptic();
    closeSheet();
    renderToday();
  });
}

async function openAddLesson() {
  if (!studentsCache.length) studentsCache = await api("/api/students");
  if (!studentsCache.length) return notify("Сначала добавьте хотя бы одного ученика.");
  openSheet(`
    <h2>Урок вне расписания</h2>
    <div class="field">
      <label>Ученик</label>
      <select id="f-student">${studentsCache.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select>
    </div>
    <div class="field"><label>Дата</label><input id="f-date" type="date" value="${todayDate}"></div>
    <div class="field"><label>Время</label><input id="f-time" type="time"></div>
  `);
  setMainButton("Записать урок", async () => {
    const student_id = parseInt(document.getElementById("f-student").value, 10);
    const date = document.getElementById("f-date").value;
    const time = document.getElementById("f-time").value;
    if (!date || !time) return notify("Укажите дату и время.");
    await api("/api/lessons", { method: "POST", body: JSON.stringify({ student_id, date, time }) });
    haptic();
    closeSheet();
    todayDate = date;
    renderToday();
  });
}

// ---------------------------------------------------------------------------
// Неделя
// ---------------------------------------------------------------------------

let weekStart = null;

async function renderWeek() {
  if (!weekStart) weekStart = mondayOf(todayDate);
  screenEl.innerHTML = `
    <div class="date-nav">
      <button class="icon-btn" id="week-prev">◀</button>
      <div style="flex:1; text-align:center; font-weight:600;" id="week-label"></div>
      <button class="icon-btn" id="week-next">▶</button>
    </div>
    <div id="week-body"><div class="loading">Загрузка…</div></div>
  `;
  document.getElementById("week-prev").addEventListener("click", () => shiftWeek(-7));
  document.getElementById("week-next").addEventListener("click", () => shiftWeek(7));

  const data = await api(`/api/week?start=${weekStart}`);
  document.getElementById("week-label").textContent =
    `${fmtDateLabel(data.days[0].date)} – ${fmtDateLabel(data.days[6].date)}`;
  document.getElementById("week-body").innerHTML = data.days.map((day) => `
    <div class="week-day">
      <h3>${day.weekday_name}, ${fmtDateLabel(day.date).slice(0, 5)}</h3>
      ${day.lessons.length
        ? day.lessons.map((l) => `<div class="week-slot"><span>${l.lesson_time.slice(0, 5)} — ${escapeHtml(l.student_name)}</span></div>`).join("")
        : '<div class="week-free">свободно</div>'}
    </div>
  `).join("");
}

function shiftWeek(delta) {
  weekStart = addDaysIso(weekStart, delta);
  renderWeek();
}

// ---------------------------------------------------------------------------
// Расчёт (обзор месяца + расчёт по ученику)
// ---------------------------------------------------------------------------

let calcMonthDate = isoToday().slice(0, 8) + "01"; // 1-е число текущего месяца

async function renderCalc() {
  if (!studentsCache.length) studentsCache = await api("/api/students");
  await loadCurrency();
  const today = isoToday();
  const monthStart = today.slice(0, 8) + "01";

  screenEl.innerHTML = `
    <div class="card" id="revenue-card">
      <div class="month-nav">
        <button class="icon-btn" id="rev-prev">◀</button>
        <div class="month-label" id="rev-label"></div>
        <button class="icon-btn" id="rev-next">▶</button>
      </div>
      <div id="revenue-body"><div class="loading">Загрузка…</div></div>
    </div>

    <hr class="sep">

    <div class="field">
      <label>Ученик</label>
      <select id="c-student">${studentsCache.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select>
    </div>
    <div class="field"><label>Валюта в чеке</label>
      <select id="c-currency">
        <option value="руб."${currency === "руб." ? " selected" : ""}>руб.</option>
        <option value="$"${currency === "$" ? " selected" : ""}>$</option>
      </select>
    </div>
    <div class="btn-row">
      <button class="btn btn-soft" data-period="week">Эта неделя</button>
      <button class="btn btn-soft" data-period="month">Этот месяц</button>
    </div>
    <div class="field" style="margin-top:12px;"><label>С даты</label><input id="c-from" type="date" value="${monthStart}"></div>
    <div class="field"><label>По дату</label><input id="c-to" type="date" value="${today}"></div>
    <button class="btn btn-primary btn-block" id="c-run">Рассчитать</button>
    <div id="c-result"></div>
  `;

  document.getElementById("c-currency").addEventListener("change", async (e) => {
    currency = e.target.value;
    await api("/api/settings", { method: "PATCH", body: JSON.stringify({ currency }) });
  });
  document.querySelector('[data-period="week"]').addEventListener("click", () => {
    document.getElementById("c-from").value = mondayOf(today);
    document.getElementById("c-to").value = today;
    runCalc();
  });
  document.querySelector('[data-period="month"]').addEventListener("click", () => {
    document.getElementById("c-from").value = monthStart;
    document.getElementById("c-to").value = today;
    runCalc();
  });
  document.getElementById("c-run").addEventListener("click", runCalc);

  document.getElementById("rev-prev").addEventListener("click", () => shiftRevenueMonth(-1));
  document.getElementById("rev-next").addEventListener("click", () => shiftRevenueMonth(1));

  await renderRevenue();
}

async function loadCurrency() {
  try {
    const settings = await api("/api/settings");
    if (settings.currency) currency = settings.currency;
  } catch (e) { /* если не удалось — остаёмся с валютой по умолчанию */ }
}

function shiftRevenueMonth(delta) {
  const d = new Date(calcMonthDate + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + delta);
  calcMonthDate = d.toISOString().slice(0, 8) + "01";
  renderRevenue();
}

async function renderRevenue() {
  const [y, m] = calcMonthDate.split("-").map((x) => parseInt(x, 10));
  document.getElementById("rev-label").textContent = `${MONTH_NAMES[m - 1]} ${y}`;
  const bodyEl = document.getElementById("revenue-body");
  bodyEl.innerHTML = `<div class="loading">Загрузка…</div>`;

  const data = await api(`/api/revenue?year=${y}&month=${m}`);

  bodyEl.innerHTML = `
    <div class="revenue-grid">
      <div class="revenue-cell">
        <div class="label">Запланировано</div>
        <div class="value">${fmtPrice(data.planned_total)}</div>
      </div>
      <div class="revenue-cell">
        <div class="label">Факт на сейчас</div>
        <div class="value">${fmtPrice(data.actual_total)}</div>
      </div>
      <div class="revenue-cell">
        <div class="label">Налог 10% (план)</div>
        <div class="value">${fmtPrice(data.tax_planned)}</div>
      </div>
      <div class="revenue-cell">
        <div class="label">Налог 10% (факт)</div>
        <div class="value">${fmtPrice(data.tax_actual)}</div>
      </div>
    </div>
    ${data.students.length ? `
      <hr class="sep">
      <div class="field"><label>Оплата за месяц по ученикам</label></div>
      ${data.students.map((s) => `
        <div class="payment-row">
          <div>
            <div class="name">${escapeHtml(s.student_name)}</div>
            <div class="sub">факт: ${fmtPrice(s.actual)} · план: ${fmtPrice(s.planned)}</div>
          </div>
          <label class="payment-check">
            <input type="checkbox" data-paid="${s.student_id}" ${s.paid ? "checked" : ""}>
            Оплатил(а)
          </label>
        </div>
      `).join("")}
    ` : '<div class="card-sub" style="margin-top:10px;">В этом месяце пока нет уроков.</div>'}
  `;

  bodyEl.querySelectorAll("[data-paid]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      await api("/api/payments", {
        method: "PATCH",
        body: JSON.stringify({ student_id: parseInt(cb.dataset.paid, 10), year: y, month: m, paid: cb.checked }),
      });
      haptic();
    });
  });
}

async function runCalc() {
  const student_id = document.getElementById("c-student").value;
  const date_from = document.getElementById("c-from").value;
  const date_to = document.getElementById("c-to").value;
  const resEl = document.getElementById("c-result");
  resEl.innerHTML = `<div class="loading">Считаю…</div>`;
  const data = await api(`/api/calc?student_id=${student_id}&date_from=${date_from}&date_to=${date_to}`);
  resEl.innerHTML = `
    <hr class="sep">
    <div class="card-sub">${data.student.name}, ${fmtDateLabel(date_from)} – ${fmtDateLabel(date_to)}</div>
    <div class="calc-total">${fmtPrice(data.total)}</div>
    <div class="card-sub">Занятий: ${data.count}</div>
    <hr class="sep">
    ${data.lessons.length ? data.lessons.map((l) => `<div class="calc-line"><span>${fmtDateLabel(l.lesson_date)} (${l.lesson_time.slice(0, 5)})</span><span>${fmtPrice(l.price)}</span></div>`).join("") : '<div class="card-sub">Проведённых уроков за период не найдено.</div>'}
    <button class="btn btn-soft btn-block" id="c-copy" style="margin-top:14px;">📋 Скопировать текст для ученика</button>
  `;
  document.getElementById("c-copy").addEventListener("click", () => {
    copyText(buildReceiptText(data, date_from, date_to));
  });
}

function buildReceiptText(data, date_from, date_to) {
  const fromD = new Date(date_from + "T00:00:00Z");
  const toD = new Date(date_to + "T00:00:00Z");
  const sameMonth = fromD.getUTCFullYear() === toD.getUTCFullYear() && fromD.getUTCMonth() === toD.getUTCMonth();
  const header = sameMonth
    ? `📊 Уроки за ${MONTH_NAMES[fromD.getUTCMonth()]} ${fromD.getUTCFullYear()}:`
    : `📊 Уроки: ${fmtDateLabel(date_from)} – ${fmtDateLabel(date_to)}:`;
  const dates = data.lessons.map((l) => fmtDateLabel(l.lesson_date).slice(0, 5)).join(", ");

  return [
    header,
    `📅 ${dates}${dates ? "." : ""}`,
    `🔢 Всего: ${data.count}`,
    `🪙 Итого: ${fmtPrice(data.total)} ${currency}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Резервная копия
// ---------------------------------------------------------------------------

function renderBackup() {
  screenEl.innerHTML = `
    <div class="card">
      <div class="card-title">Сохранить в файл</div>
      <div class="card-sub">Скачает файл резервной копии (.json) со всеми данными: ученики, расписание, история уроков, оплаты и настройки.</div>
      <button class="btn btn-primary btn-block" id="b-export-file" style="margin-top:10px;">💾 Скачать файл резервной копии</button>
    </div>
    <div class="card">
      <div class="card-title">Восстановить из файла</div>
      <div class="card-sub">⚠️ Полностью заменит текущие данные данными из файла.</div>
      <label class="file-drop" style="margin-top:10px;">
        📂 Выбрать файл резервной копии (.json)
        <input id="b-import-file" type="file" accept="application/json,.json">
      </label>
    </div>
    <div class="card">
      <div class="card-title">Скопировать копию текстом</div>
      <div class="card-sub">Скопирует все данные в буфер обмена — на случай, если файл скачать не получается.</div>
      <button class="btn btn-soft btn-block" id="b-export-text" style="margin-top:10px;">📋 Скопировать резервную копию</button>
    </div>
    <div class="card">
      <div class="card-title">Восстановить из текста</div>
      <div class="card-sub">⚠️ Полностью заменит текущие данные. Вставьте ранее скопированный текст ниже.</div>
      <div class="field" style="margin-top:10px;"><textarea id="b-text" rows="5" class="f-textarea" style="font-family: monospace; font-size:12px;"></textarea></div>
      <button class="btn btn-danger btn-block" id="b-restore-text">♻️ Восстановить из текста</button>
    </div>
  `;

  document.getElementById("b-export-file").addEventListener("click", async () => {
    const data = await api("/api/backup/export");
    downloadJson(data, `tutor-backup-${isoToday()}.json`);
  });

  document.getElementById("b-import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const ok = await confirmAction("Это заменит все текущие данные данными из файла. Продолжить?");
      if (!ok) { e.target.value = ""; return; }
      await api("/api/backup/restore", { method: "POST", body: JSON.stringify(data) });
      haptic();
      notify("Данные восстановлены из файла.");
    } catch (err) {
      notify("Не удалось прочитать этот файл — проверьте, что это файл резервной копии.");
    }
    e.target.value = "";
  });

  document.getElementById("b-export-text").addEventListener("click", async () => {
    const data = await api("/api/backup/export");
    copyText(JSON.stringify(data), "Скопировано! Сохраните этот текст где-нибудь на память.");
  });

  document.getElementById("b-restore-text").addEventListener("click", async () => {
    const raw = document.getElementById("b-text").value.trim();
    if (!raw) return notify("Вставьте текст резервной копии.");
    let data;
    try { data = JSON.parse(raw); } catch (e) { return notify("Это не похоже на резервную копию — проверьте текст."); }
    const ok = await confirmAction("Это заменит все текущие данные данными из копии. Продолжить?");
    if (!ok) return;
    await api("/api/backup/restore", { method: "POST", body: JSON.stringify(data) });
    haptic();
    notify("Данные восстановлены.");
  });
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------

renderStudents();
