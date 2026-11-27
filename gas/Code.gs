/**
 * 個人日常遙測 — Google Apps Script 雲端端點
 *
 * 一份腳本兩種用法：
 *  A. 自己用 (自架)：只有你一個人，資料存在你的試算表
 *  B. 社團雲端：你是管理者，成員用邀請連結加入；每個人只拿得到自己的資料，管理者看得到全部
 *
 * 安裝 (詳見 App 說明書)：
 *  1. 新建 Google 試算表 → 擴充功能 → Apps Script → 貼上本檔案 → 儲存
 *  2. 執行 setup (第一次會要求授權)
 *  3. 部署 → 新增部署作業 → 網頁應用程式：執行身分「我」、存取權「所有人」
 *  4. 自架：執行 showPairing，把「設定」分頁產生的配對連結貼進 App
 *     社團：在「成員」分頁 A 欄填名字 → 執行 createInvites → 把 E 欄的邀請連結傳給成員
 *     停用成員：把該列 D 欄「狀態」改成 REVOKED
 *
 * 協定：POST (text/plain) JSON
 *   同步：{ token, since, changes: { habits:[], containers:[], logs:[] } }
 *         → { ok, server_time, changes, counts, member:{name, role, space} }
 *   健康匯入：{ token, action:"health_workout", type, start, end, distance_km, kcal, avg_hr, max_hr }
 * 合併規則：同 id 以 updated_at 較新者為準 (last-write-wins)。
 * 每列資料最後一欄 owner_id 標記擁有者；空白 = 管理者 (舊資料相容)。
 */

var DEFAULT_APP_URL = 'https://lukens124.github.io/personal-telemetry/';

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
var OWNER_ID = 'owner_id';
var OWNER = 'owner';
var MEMBERS = '成員';
var SETTINGS = '設定';


// ---------------------------------------------------------------- 安裝與管理 (在 Apps Script 編輯器執行)

/** 第一次安裝執行一次：建立工作表並產生你的 Token */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABLES).forEach(function (name) {
    ensureSheet_(ss, TABLES[name]);
  });
  ensureMembers_(ss);
  ensureSettings_(ss);
  var token = ownerToken_();
  Logger.log('SYNC TOKEN: ' + token);
  Logger.log('下一步：部署 → 新增部署作業 → 網頁應用程式 (執行身分：我；存取權：所有人)，再執行 showPairing');
  return token;
}

/** 忘記 Token 時執行 */
function showToken() {
  Logger.log('SYNC TOKEN: ' + ownerToken_());
}

/** 自己的配對連結：貼到 App 設定頁 (或在電腦直接打開) 就完成連線 */
function showPairing() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var link = pairingLink_(ss, ownerToken_());
  ensureSettings_(ss).getRange(4, 2).setValue(link);
  Logger.log('你的配對連結 (只給自己的裝置)：' + link);
  return link;
}

/** 社團：為「成員」分頁中還沒有 Token 的名字產生邀請連結 */
function createInvites() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ensureMembers_(ss);
  var last = sheet.getLastRow();
  if (last < 2) {
    Logger.log('請先在「成員」分頁 A 欄 (第 2 列起) 填入成員名字');
    return 0;
  }
  var values = sheet.getRange(2, 1, last - 1, 7).getValues();
  var made = 0;
  values.forEach(function (row, i) {
    var name = String(row[0]).trim();
    if (!name || row[2]) return;
    var id = 'm_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    var token = Utilities.getUuid().replace(/-/g, '');
    var link = pairingLink_(ss, token);
    sheet.getRange(i + 2, 2, 1, 5).setValues([[id, token, 'ACTIVE', link, new Date()]]);
    Logger.log(name + '：' + link);
    made++;
  });
  if (!made) Logger.log('沒有需要產生邀請的新成員');
  return made;
}

// ---------------------------------------------------------------- 端點

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

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var member = auth_(ss, body.token);
    if (!member) return json_({ ok: false, error: 'UNAUTHORIZED' });
    var now = Date.now();
    if (body.action === 'health_workout') return json_(healthWorkout_(ss, body, now, member));

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
        if (r.owner === member.id) index[r.obj[t.key]] = i;
      });

      var changed = false;
      (changes[name] || []).forEach(function (inc) {
        var id = inc && inc[t.key];
        if (!id) return;
        var i = index[id];
        if (i === undefined) {
          rows.push({ obj: pick_(inc, t), ts: now, owner: member.id });
          index[id] = rows.length - 1;
          changed = true;
        } else if (Number(inc.updated_at) > Number(rows[i].obj.updated_at)) {
          rows[i] = { obj: pick_(inc, t), ts: now, owner: member.id };
          changed = true;
        }
      });
      if (changed) writeRows_(sheet, t, rows);

      var mine = rows.filter(function (r) {
        return r.owner === member.id;
      });
      out[name] = mine
        .filter(function (r) {
          return r.ts > since;
        })
        .map(function (r) {
          return r.obj;
        });
      counts[name] = mine.length;
    });

    return json_({
      ok: true,
      server_time: now,
      changes: out,
      counts: counts,
      member: { name: member.name, role: member.role, space: member.space },
    });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- 成員與設定

function ownerToken_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('SYNC_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('SYNC_TOKEN', token);
  }
  return token;
}

/** Token → 成員；管理者 (自己) 的 id 固定為 owner */
function auth_(ss, token) {
  if (!token) return null;
  var space = String(ensureSettings_(ss).getRange(3, 2).getValue() || '').trim();
  var ownerTok = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  if (ownerTok && token === ownerTok) return { id: OWNER, name: '', role: 'owner', space: space };
  var sheet = ss.getSheetByName(MEMBERS);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (r[2] && String(r[2]) === String(token)) {
      if (String(r[3]).toUpperCase() !== 'ACTIVE') return null;
      sheet.getRange(i + 2, 7).setValue(new Date());
      return { id: String(r[1]), name: String(r[0]), role: 'member', space: space };
    }
  }
  return null;
}

function ensureMembers_(ss) {
  var sheet = ss.getSheetByName(MEMBERS);
  if (!sheet) {
    sheet = ss.insertSheet(MEMBERS);
    sheet.getRange(1, 1, 1, 7).setValues([['名字', '成員ID', 'Token', '狀態', '邀請連結', '建立時間', '最後同步']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureSettings_(ss) {
  var sheet = ss.getSheetByName(SETTINGS);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS);
    sheet.getRange(1, 1, 4, 2).setValues([
      ['網頁應用程式網址 (部署後貼上，…/exec 結尾)', ''],
      ['App 網址', DEFAULT_APP_URL],
      ['社團名稱 (選填，成員的 App 會顯示)', ''],
      ['我的配對連結 (執行 showPairing 產生)', ''],
    ]);
  }
  return sheet;
}

function webAppUrl_(ss) {
  var url = String(ensureSettings_(ss).getRange(1, 2).getValue() || '').trim();
  if (/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) return url;
  try {
    var auto = ScriptApp.getService().getUrl();
    if (auto && /\/exec$/.test(auto)) return auto;
  } catch (err) {
    /* 尚未部署 */
  }
  throw new Error('找不到網頁應用程式網址：請先部署，並把網址 (…/exec 結尾) 貼到「設定」分頁的 B1');
}

function pairingLink_(ss, token) {
  var app = String(ensureSettings_(ss).getRange(2, 2).getValue() || DEFAULT_APP_URL).trim();
  var code = Utilities.base64EncodeWebSafe(JSON.stringify({ u: webAppUrl_(ss), t: token })).replace(/=+$/, '');
  return app + '#pair=' + code;
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

function findHabit_(ss, engine, member) {
  var rows = readRows_(ensureSheet_(ss, TABLES.habits), TABLES.habits)
    .filter(function (r) { return r.owner === member.id; })
    .map(function (r) { return r.obj; })
    .filter(function (h) { return h.engine_type === engine && Number(h.deleted) === 0; })
    .sort(function (a, b) { return a.sort_order - b.sort_order; });
  return rows[0] || null;
}

function healthWorkout_(ss, b, now, member) {
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

  var habit = findHabit_(ss, sport === 'STRENGTH' ? 'WORKOUT' : 'CARDIO', member);
  if (!habit) return { ok: false, error: 'NO_HABIT', detail: '找不到' + (sport === 'STRENGTH' ? '重訓' : '有氧') + '項目，請先開啟 App 同步一次' };

  var t = TABLES.logs;
  var sheet = ensureSheet_(ss, t);
  var rows = readRows_(sheet, t);
  var index = {};
  rows.forEach(function (r, i) { if (r.owner === member.id) index[r.obj.log_id] = i; });

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
    owner: member.id,
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
    if (ck) rows[index[ckId]] = { obj: obj, ts: now, owner: member.id };
    else rows.push({ obj: obj, ts: now, owner: member.id });
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
  }).concat([SERVER_TS, OWNER_ID]);
}

function ensureSheet_(ss, t) {
  var sheet = ss.getSheetByName(t.sheet);
  if (!sheet) {
    sheet = ss.insertSheet(t.sheet);
    var h = header_(t);
    sheet.getRange(1, 1, 1, h.length).setValues([h]);
    sheet.setFrozenRows(1);
  } else if (sheet.getRange(1, t.cols.length + 2, 1, 1).getValues()[0][0] !== OWNER_ID) {
    // 舊版試算表：補上 owner_id 欄標題 (既有資料留空 = 管理者)
    sheet.getRange(1, t.cols.length + 2, 1, 1).setValues([[OWNER_ID]]);
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
  var n = t.cols.length + 2;
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
      return { obj: obj, ts: Number(row[n - 2]) || 0, owner: String(row[n - 1] || '') || OWNER };
    });
}

function writeRows_(sheet, t, rows) {
  var n = t.cols.length + 2;
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
      .concat([r.ts, r.owner === OWNER ? '' : r.owner]);
  });
  sheet.getRange(2, 1, rows.length, n).setValues(matrix);
}
