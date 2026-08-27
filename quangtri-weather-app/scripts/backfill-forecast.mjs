// scripts/backfill-forecast.mjs
//
// Script CHẠY 1 LẦN THỦ CÔNG trên máy (KHÔNG PHẢI Netlify Function). Tải
// ngược dữ liệu dự báo lịch sử D+1 -> D+7 từ Open-Meteo "Previous Runs API"
// (cùng endpoint historical-forecast-api.open-meteo.com, chỉ khác tên biến
// có hậu tố "_previous_dayN") cho cả 78 phường/xã, ghi vào bảng
// du_bao_hang_ngay — khớp đúng cấu trúc cột với dữ liệu cron hàng đêm đang
// tạo ra (ngay_du_bao, ngay_ap_dung, han_du_bao, ma_xa, mua_mm, nhietdo_max,
// nhietdo_min).
//
// CHỈ tải được D+1 -> D+7 (không phải D+15) — đây là giới hạn của Previous
// Runs API, không phải giới hạn của script. Từ D+8 trở đi, dữ liệu sẽ tự
// tích luỹ dần qua cron collect-forecast.mjs (không tải ngược được).
//
// CÁCH CHẠY (đứng ở thư mục quangtri-weather-app):
//   node scripts/backfill-forecast.mjs
//   (tuỳ chọn: thêm ngày bắt đầu/kết thúc riêng)
//   node scripts/backfill-forecast.mjs 2025-01-01 2026-08-26
//
// Mặc định tự lấy khoảng ngày khớp với dữ liệu thực đo đã có trong bảng
// thuc_do_hang_ngay (không cần gõ tay).

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { neon } from '@neondatabase/serverless';

const BASE_DIR = process.cwd().endsWith('quangtri-weather-app')
  ? process.cwd()
  : path.join(process.cwd(), 'quangtri-weather-app');
const envPath = path.join(BASE_DIR, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!process.env.DATABASE_URL) {
  console.error('Không tìm thấy DATABASE_URL. Kiểm tra file quangtri-weather-app/.env');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const { XA_PHUONG } = await import(pathToFileURL(path.join(BASE_DIR, 'netlify/functions/lib/geo.js')).href);

const LEAD_DAYS = [1, 2, 3, 4, 5, 6, 7];
const CHUNK_DAYS = 14; // dữ liệu theo GIỜ (14 biến x 24h x 78 xã/ngày) nặng hơn nhiều so với theo ngày -> giảm kích thước mỗi lần gọi

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function getDefaultDateRange() {
  const rows = await sql`SELECT min(ngay)::text AS min_ngay, max(ngay)::text AS max_ngay FROM thuc_do_hang_ngay`;
  return { start: rows[0].min_ngay, end: rows[0].max_ngay };
}

function buildHourlyParam() {
  const rainVars = LEAD_DAYS.map((n) => `precipitation_previous_day${n}`);
  const tempVars = LEAD_DAYS.map((n) => `temperature_2m_previous_day${n}`);
  return [...rainVars, ...tempVars].join(',');
}

async function fetchChunk(startDate, endDate) {
  const lats = XA_PHUONG.map((x) => x.lat).join(',');
  const lngs = XA_PHUONG.map((x) => x.lng).join(',');
  const hourly = buildHourlyParam();
  // Endpoint riêng cho Previous Runs API (KHÁC với historical-forecast-api
  // dùng cho dự báo gốc) — chỉ endpoint này mới hiểu hậu tố "_previous_dayN".
  const url = `https://previous-runs-api.open-meteo.com/v1/forecast`
    + `?latitude=${lats}&longitude=${lngs}&start_date=${startDate}&end_date=${endDate}&hourly=${hourly}&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} - ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return Array.isArray(json) ? json : [json];
}

// Gộp chuỗi giờ thành theo ngày cho 1 lead cụ thể: mưa = tổng cả ngày,
// nhiệt độ = max/min cả ngày. Trả về Map<ngày, {mua, tmax, tmin}>.
function aggregateHourlyByDay(hourlyTimes, rainArr, tempArr) {
  const byDay = new Map();
  hourlyTimes.forEach((t, i) => {
    const day = String(t).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { mua: 0, tmax: -Infinity, tmin: Infinity, hasRain: false, hasTemp: false });
    const rec = byDay.get(day);
    const r = rainArr?.[i];
    const tp = tempArr?.[i];
    if (r != null) { rec.mua += r; rec.hasRain = true; }
    if (tp != null) { rec.tmax = Math.max(rec.tmax, tp); rec.tmin = Math.min(rec.tmin, tp); rec.hasTemp = true; }
  });
  return byDay;
}

async function upsertBatch(batch) {
  if (batch.length === 0) return;
  const ngay_du_bao = batch.map((r) => r.ngay_du_bao);
  const ngay_ap_dung = batch.map((r) => r.ngay_ap_dung);
  const han_du_bao = batch.map((r) => r.han_du_bao);
  const ma_xa = batch.map((r) => r.ma_xa);
  const mua_mm = batch.map((r) => r.mua_mm);
  const nhietdo_max = batch.map((r) => r.nhietdo_max);
  const nhietdo_min = batch.map((r) => r.nhietdo_min);

  await sql`
    INSERT INTO du_bao_hang_ngay (ngay_du_bao, ngay_ap_dung, han_du_bao, ma_xa, mua_mm, nhietdo_max, nhietdo_min)
    SELECT * FROM unnest(
      ${ngay_du_bao}::date[], ${ngay_ap_dung}::date[], ${han_du_bao}::smallint[],
      ${ma_xa}::int[], ${mua_mm}::float8[], ${nhietdo_max}::float8[], ${nhietdo_min}::float8[]
    )
    ON CONFLICT (ngay_du_bao, ma_xa, han_du_bao) DO UPDATE SET
      mua_mm = EXCLUDED.mua_mm, nhietdo_max = EXCLUDED.nhietdo_max, nhietdo_min = EXCLUDED.nhietdo_min
  `;
}

async function main() {
  const argStart = process.argv[2];
  const argEnd = process.argv[3];
  let { start, end } = argStart && argEnd ? { start: argStart, end: argEnd } : await getDefaultDateRange();
  console.log(`Khoảng ngày tải ngược dự báo: ${start} -> ${end}`);

  let totalRows = 0;
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = addDays(cursor, CHUNK_DAYS - 1) > end ? end : addDays(cursor, CHUNK_DAYS - 1);
    console.log(`Đang gọi Open-Meteo cho ${cursor} -> ${chunkEnd} (78 xã)...`);

    let results;
    try {
      results = await fetchChunk(cursor, chunkEnd);
    } catch (e) {
      console.error(`  Lỗi khi gọi API cho đoạn ${cursor}->${chunkEnd}: ${e.message}`);
      cursor = addDays(chunkEnd, 1);
      continue;
    }

    if (results.length !== XA_PHUONG.length) {
      console.error(`  CẢNH BÁO: API trả về ${results.length} kết quả, kỳ vọng ${XA_PHUONG.length} — bỏ qua đoạn này`);
      cursor = addDays(chunkEnd, 1);
      continue;
    }

    const batch = [];
    results.forEach((r, idx) => {
      const xa = XA_PHUONG[idx];
      const times = r?.hourly?.time || [];
      for (const lead of LEAD_DAYS) {
        const rainArr = r.hourly[`precipitation_previous_day${lead}`];
        const tempArr = r.hourly[`temperature_2m_previous_day${lead}`];
        if (!rainArr && !tempArr) continue;
        const byDay = aggregateHourlyByDay(times, rainArr, tempArr);
        for (const [validDate, agg] of byDay.entries()) {
          if (!agg.hasRain && !agg.hasTemp) continue;
          batch.push({
            ngay_du_bao: addDays(validDate, -lead),
            ngay_ap_dung: validDate,
            han_du_bao: lead,
            ma_xa: xa.ma_xa,
            mua_mm: agg.hasRain ? Math.round(agg.mua * 10) / 10 : null,
            nhietdo_max: agg.hasTemp ? agg.tmax : null,
            nhietdo_min: agg.hasTemp ? agg.tmin : null,
          });
        }
      }
    });

    await upsertBatch(batch);
    totalRows += batch.length;
    console.log(`  Đã nạp ${batch.length} dòng (tổng cộng ${totalRows})`);

    cursor = addDays(chunkEnd, 1);
  }

  console.log(`XONG. Tổng cộng đã nạp ${totalRows} dòng vào du_bao_hang_ngay.`);
}

main().catch((e) => { console.error('LỖI:', e); process.exit(1); });
