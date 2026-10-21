# Schema v4.1 與狀態規則

對應規格書 HMI Spec v4.0，以下為定稿後的修訂。程式定義在 `src/data/types.ts`。

## 相對 v4.0 的變更

| 項目 | v4.0 | v4.1 |
|---|---|---|
| 同步欄位 | 只有 `sync_status` | 每張表加入 `created_at`、`updated_at`、`deleted` (軟刪除)、`dirty` |
| 紀錄種類 | 單一 Habit_Logs | 加入 `kind`：`CHECKIN` (每日打卡) / `ENTRY` (實際內容) |
| 日期 | 只有 `timestamp` | `timestamp` 帶時區偏移 + `local_date` (YYYY-MM-DD) |
| visual_flag | 0 / 1 / 3 | 只存 1 (完成)、3 (略過)；0 由排程推算不存檔；2 保留 |
| 星期 | `getDay()` (0=週日) | ISO weekday：1=週一 … 7=週日 |
| JSON 欄位 | `*_json` 字串 | IndexedDB 直接存物件；同步到 Sheets 時才序列化 |

## 狀態規則

1. **打卡唯一性**：TRACK 習慣每天至多一筆 CHECKIN，ID 為 `ck_<habit_id>_<YYYY-MM-DD>`，跨裝置同步也不會重複。
2. **同日打卡 + 書摘**：左點只寫 CHECKIN；之後新增書摘為獨立 ENTRY，不會產生第二筆打卡。
3. **儲存即完成**：TRACK 習慣存任何 ENTRY，當天 CHECKIN 自動設為完成 (會覆蓋略過)。
4. **星期綁定**：只有綁定的星期會自動帶入課表。未綁定的日子點重訓左側 → 回傳 `NEEDS_WORKBENCH`，開啟 2.0-A 手選，不寫入資料。同一天只綁一份課表。
5. **取消打卡**：再點左側一次 = 取消，重訓自動建立的那筆 ENTRY 一併軟刪除。
6. **合理略過**：左滑寫入 flag 3；再滑取消；已完成不可略過。略過從當週目標扣除，不算失敗，也不推進 N:M。
7. **N:M 週期**：只依實際的重訓 ENTRY 推算 (`MAIN` / `DELOAD`)。
8. **網格狀態**：DONE / SKIP / PENDING_TODAY / MISSED (已過的排程日，保留空白框) / UPCOMING / OFF (非排程日)。非排程日完成仍顯示 DONE。
9. **時間軸 (1.0-B)**：LOG 分頁的紀錄 + 所有閱讀/語言筆記。
10. **預填**：存檔時更新容器 `last_payload`；GENERIC 另記 `last_state.template`。

## 引擎

| engine | 用途 | 容器 (下拉) | Payload |
|---|---|---|---|
| WORKOUT | 重訓 | 課表 (可綁星期) | `exercises[{name, sets[{kg, reps}]}]`，sub_mode = MAIN / DELOAD |
| COFFEE | 咖啡 | 豆單 (sub_mode = POUR_OVER / ESPRESSO) | `grinder, temp_c, grind, ratio, rating, flavors, note` |
| READING | 閱讀、英文 | 書 / 來源 (ACTIVE / ARCHIVED) | `nature (INSIGHT/STATUS/CHUNK), text, example, page, tags` |
| GENERIC | 騎車、日記、自建分類 | 選用 (騎車 = 路線/主題) | `values{…}` (依 config.fields) + `text` |

騎車：TRACK、週四/週六、欄位為距離 (km) 與時間 (分鐘)，路線以容器管理 (環台北、巴拉卡公路…)。
