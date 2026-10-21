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
