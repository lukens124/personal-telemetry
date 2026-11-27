/**
 * 個人日常遙測 — Google Apps Script 同步端點
 *
 * 安裝：
 *  1. 新建一份 Google 試算表，選單「擴充功能 → Apps Script」，把這個檔案全部貼上取代
 *  2. 上方函式選單選 setup，按「執行」，授權後在「執行記錄」複製 SYNC TOKEN
 *  3. 「部署 → 新增部署作業」，類型選「網頁應用程式」：
 *       執行身分 = 我；存取權 = 所有人
 *     複製網頁應用程式網址
 *  4. 在 App 的「設定」貼上網址與 Token
 *
 * 協定：POST (Content-Type: text/plain) JSON
 *   { token, since, changes: { habits:[], containers:[], logs:[] } }
 * 回應：
 *   { ok, server_time, changes: {...since 之後有變動的列}, counts }
 * 合併規則：同 id 以 updated_at 較新者為準 (last-write-wins)。
 *
 * Apple 健康匯入 (iOS 捷徑，每次一筆運動)：
 *   { token, action: "health_workout", type, start, end, distance_km, kcal, avg_hr, max_hr }
 *   start / end：ISO 8601 (例如 2026-11-27T07:00:00+08:00)
 *   以開始時間為唯一鍵，重複送出不會重複寫入。
 *   騎車 / 跑步 / 其他 → 有氧紀錄並自動打卡；肌力訓練 → 掛在當天重訓的手錶數據。
 */

var TABLES = {
  habits: {
    sheet: 'Habits',
    key: 'habit_id',
    cols: [
      ['habit_id', 's'], ['name', 's'], ['icon', 's'], ['category_tab', 's'], ['engine_type', 's'],
      ['schedule_days', 'j'], ['weekly_target', 'n'], ['sort_order', 'n'], ['config', 'j'], ['last_state', 'j'],
      ['created_at', 'n'], ['updated_at', 'n'], ['deleted', 'n'],
    ],
  },
  containers: {
    sheet: 'Containers',
    key: 'container_id',
    cols: [
      ['container_id', 's'], ['habit_id', 's'], ['sub_mode', 's?'], ['name', 's'], ['bound_weekdays', 'j'],
      ['status', 's'], ['sort_order', 'n'], ['default_payload', 'j'], ['last_payload', 'j'],
      ['created_at', 'n'], ['updated_at', 'n'], ['deleted', 'n'],
    ],
  },
  logs: {
    sheet: 'Habit_Logs',
    key: 'log_id',
    cols: [
      ['log_id', 's'], ['habit_id', 's'], ['kind', 's'], ['sub_mode', 's?'], ['container_id', 's?'],
      ['timestamp', 's'], ['local_date', 's'], ['visual_flag', 'n?'], ['summary_text', 's'], ['payload', 'j'],
      ['created_at', 'n'], ['updated_at', 'n'], ['deleted', 'n'],
    ],
  },
};
var SERVER_TS = 'server_ts';

/** 首次安裝執行一次：建立工作表並產生 Token */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABLES).forEach(function (name) {
    ensureSheet_(ss, TABLES[name]);
  });
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('SYNC_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('SYNC_TOKEN', token);
  }
  Logger.log('SYNC TOKEN: ' + token);
  return token;
}

/** 忘記 Token 時執行 */
function showToken() {
  Logger.log('SYNC TOKEN: ' + PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN'));
}

function doGet() {
  return json_({ ok: true, app: 'personal-telemetry' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'BAD_REQUEST' });
  }
  var token = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  if (!token || body.token !== token) return json_({ ok: false, error: 'UNAUTHORIZED' });

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var now = Date.now();
    if (body.action === 'health_workout') return json_(healthWorkout_(ss, body, now));
    var since = Number(body.since) || 0;
    var changes = body.changes || {};
    var out = {};
    var counts = {};

    Object.keys(TABLES).forEach(function (name) {
      var t = TABLES[name];
      var sheet = ensureSheet_(ss, t);
      var rows = readRows_(sheet, t);
      var index = {};
      rows.forEach(function (r, i) {
        index[r.obj[t.key]] = i;
      });

      var changed = false;
      (changes[name] || []).forEach(function (inc) {
        var id = inc && inc[t.key];
        if (!id) return;
        var i = index[id];
        if (i === undefined) {
          rows.push({ obj: pick_(inc, t), ts: now });
          index[id] = rows.length - 1;
          changed = true;
        } else if (Number(inc.updated_at) > Number(rows[i].obj.updated_at)) {
          rows[i] = { obj: pick_(inc, t), ts: now };
          changed = true;
        }
      });
      if (changed) writeRows_(sheet, t, rows);

      out[name] = rows
        .filter(function (r) {
          return r.ts > since;
        })
        .map(function (r) {
          return r.obj;
        });
      counts[name] = rows.length;
    });

    return json_({ ok: true, server_time: now, changes: out, counts: counts });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Apple 健康匯入

var SPORT_LABEL = { ROAD: '公路車', INDOOR: '室內台', RUN: '跑步', OTHER: '其他' };

/** 健康 App 運動名稱 → 分類 (與 App 端 classifyHealthWorkout 相同) */
function classify_(name, km) {
  var n = String(name || '').toLowerCase();
  if (/strength|肌力|重量訓練|functional|功能性/.test(n)) return 'STRENGTH';
  if (/cycl|bik|騎|單車|自行車/.test(n)) return /indoor|室內/.test(n) || !km || km < 0.1 ? 'INDOOR' : 'ROAD';
  if (/run|跑/.test(n)) return 'RUN';
  return 'OTHER';
}

/** 捷徑送來的數字可能是文字、帶單位或千分位：「25.3 km」「1,234」「25,3」 */
function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).trim();
  var meters = /\d\s*m$/.test(s) && !/km$/i.test(s);
  if (/^\d{1,3}(,\d{3})+(\.\d+)?/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  var x = parseFloat(s.replace(/[^\d.\-]/g, ''));
  if (!isFinite(x)) return null;
  return meters ? x / 1000 : x;
}

function round1_(x) {
  return Math.round(x * 10) / 10;
}

function fmtDur_(min) {
  var t = Math.round(min), h = Math.floor(t / 60), m = t % 60;
  return h > 0 ? h + 'h' + (m < 10 ? '0' : '') + m + 'm' : m + 'm';
}

/** 與 App 端 cardioSummary 相同格式 */
function cardioSummary_(sport, p) {
  var parts = [sport === 'OTHER' && p.hk_type ? p.hk_type : SPORT_LABEL[sport]];
  if (p.duration_min) parts.push(fmtDur_(p.duration_min));
  if (p.distance_km) parts.push(round1_(p.distance_km) + 'km');
  if (sport === 'RUN' && p.distance_km && p.duration_min) {
    var sec = Math.round((p.duration_min * 60) / p.distance_km);
    parts.push(Math.floor(sec / 60) + "'" + (sec % 60 < 10 ? '0' : '') + (sec % 60) + '"/km');
  }
  if (p.avg_hr) parts.push('♥' + p.avg_hr);
  return parts.join(' · ');
}

function findHabit_(ss, engine) {
  var rows = readRows_(ensureSheet_(ss, TABLES.habits), TABLES.habits)
    .map(function (r) { return r.obj; })
    .filter(function (h) { return h.engine_type === engine && Number(h.deleted) === 0; })
    .sort(function (a, b) { return a.sort_order - b.sort_order; });
  return rows[0] || null;
}

function healthWorkout_(ss, b, now) {
  var start = String(b.start || '').trim();
  var m = start.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?(.*)$/);
  if (!m) return { ok: false, error: 'BAD_START', detail: '開始時間需為 ISO 8601，例如 2026-11-27T07:00:00+08:00' };
  var localDate = m[1];
  var tz = /^[+-]\d{2}:?\d{2}$|^Z$/.test(m[4]) ? m[4] : '+08:00';
  if (/^[+-]\d{4}$/.test(tz)) tz = tz.slice(0, 3) + ':' + tz.slice(3);
  var timestamp = localDate + 'T' + m[2] + (m[3] || ':00') + tz;

  var startMs = new Date(timestamp).getTime();
  var endMs = b.end ? new Date(String(b.end).trim()).getTime() : NaN;
  var duration = isFinite(endMs) && endMs > startMs ? (endMs - startMs) / 60000 : num_(b.duration_min);
  if (!duration) return { ok: false, error: 'BAD_DURATION', detail: '需要結束時間或 duration_min' };

  var km = num_(b.distance_km);
  var kcal = num_(b.kcal);
  var avg = num_(b.avg_hr);
  var max = num_(b.max_hr);
  var type = String(b.type || '').trim();
  var sport = classify_(type, km);

  var habit = findHabit_(ss, sport === 'STRENGTH' ? 'WORKOUT' : 'CARDIO');
  if (!habit) return { ok: false, error: 'NO_HABIT', detail: '找不到' + (sport === 'STRENGTH' ? '重訓' : '有氧') + '項目，請先開啟 App 同步一次' };

  var t = TABLES.logs;
  var sheet = ensureSheet_(ss, t);
  var rows = readRows_(sheet, t);
  var index = {};
  rows.forEach(function (r, i) { index[r.obj.log_id] = i; });

  var id = 'hk_' + timestamp.replace(/\D/g, '').slice(0, 14);
  if (index[id] !== undefined) return { ok: true, status: 'DUPLICATE', id: id };

  var p = { duration_min: round1_(duration) };
  if (sport !== 'STRENGTH' && sport !== 'INDOOR' && km) p.distance_km = Math.round(km * 100) / 100;
  if (kcal) p.kcal = Math.round(kcal);
  if (avg) p.avg_hr = Math.round(avg);
  if (max) p.max_hr = Math.round(max);
  if (sport === 'STRENGTH' || sport === 'OTHER') p.hk_type = type;
  if (sport !== 'STRENGTH') p.source = 'HEALTH';

  var summary = sport === 'STRENGTH'
    ? '⌚ ' + fmtDur_(p.duration_min) + (p.kcal ? ' · ' + p.kcal + ' kcal' : '') + (p.avg_hr ? ' · ♥' + p.avg_hr : '')
    : cardioSummary_(sport, p);

  rows.push({
    obj: {
      log_id: id, habit_id: habit.habit_id, kind: sport === 'STRENGTH' ? 'HEALTH' : 'ENTRY',
      sub_mode: sport === 'STRENGTH' ? null : sport, container_id: null,
      timestamp: timestamp, local_date: localDate, visual_flag: null, summary_text: summary, payload: p,
      created_at: now, updated_at: now, deleted: 0,
    },
    ts: now,
  });

  // 有運動 = 當天打卡完成 (與 App 的「儲存即完成」規則一致)
  var ckId = 'ck_' + habit.habit_id + '_' + localDate;
  var ck = index[ckId] !== undefined ? rows[index[ckId]].obj : null;
  if (!ck || Number(ck.deleted) === 1 || Number(ck.visual_flag) !== 1) {
    var obj = {
      log_id: ckId, habit_id: habit.habit_id, kind: 'CHECKIN', sub_mode: null, container_id: null,
      timestamp: timestamp, local_date: localDate, visual_flag: 1, summary_text: '', payload: ck ? ck.payload : null,
      created_at: ck ? ck.created_at : now, updated_at: now, deleted: 0,
    };
    if (ck) rows[index[ckId]] = { obj: obj, ts: now };
    else rows.push({ obj: obj, ts: now });
  }

  writeRows_(sheet, t, rows);
  return { ok: true, status: 'IMPORTED', id: id, category: sport, summary: summary };
}

// ---------------------------------------------------------------- helpers

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function header_(t) {
  return t.cols.map(function (c) {
    return c[0];
  }).concat([SERVER_TS]);
}

function ensureSheet_(ss, t) {
  var sheet = ss.getSheetByName(t.sheet);
  if (!sheet) {
    sheet = ss.insertSheet(t.sheet);
    var h = header_(t);
    sheet.getRange(1, 1, 1, h.length).setValues([h]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function pick_(inc, t) {
  var o = {};
  t.cols.forEach(function (c) {
    var v = inc[c[0]];
    o[c[0]] = v === undefined ? null : v;
  });
  return o;
}

function decode_(v, type) {
  var empty = v === '' || v === null || v === undefined;
  switch (type) {
    case 's':
      return empty ? '' : String(v);
    case 's?':
      return empty ? null : String(v);
    case 'n':
      return empty ? 0 : Number(v);
    case 'n?':
      return empty ? null : Number(v);
    case 'j':
      if (empty) return null;
      try {
        return JSON.parse(v);
      } catch (err) {
        return null;
      }
  }
  return v;
}

function encode_(v, type) {
  if (v === null || v === undefined) return '';
  if (type === 'j') return JSON.stringify(v);
  // 避免以 = 開頭的文字被當成公式
  if (typeof v === 'string' && v.charAt(0) === '=') return "'" + v;
  return v;
}

function readRows_(sheet, t) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var n = t.cols.length + 1;
  var values = sheet.getRange(2, 1, last - 1, n).getValues();
  return values
    .filter(function (row) {
      return row[0] !== '';
    })
    .map(function (row) {
      var obj = {};
      t.cols.forEach(function (c, i) {
        obj[c[0]] = decode_(row[i], c[1]);
      });
      return { obj: obj, ts: Number(row[n - 1]) || 0 };
    });
}

function writeRows_(sheet, t, rows) {
  var n = t.cols.length + 1;
  var needed = rows.length + 1;
  var max = sheet.getMaxRows();
  if (max < needed) sheet.insertRowsAfter(max, needed - max);
  // 文字欄設為純文字格式，避免 Sheets 把日期、比例自動轉型
  t.cols.forEach(function (c, i) {
    if (c[1] !== 'n' && c[1] !== 'n?') sheet.getRange(2, i + 1, rows.length, 1).setNumberFormat('@');
  });
  var matrix = rows.map(function (r) {
    return t.cols
      .map(function (c) {
        return encode_(r.obj[c[0]], c[1]);
      })
      .concat([r.ts]);
  });
  sheet.getRange(2, 1, rows.length, n).setValues(matrix);
}
