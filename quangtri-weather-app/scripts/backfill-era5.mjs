// scripts/backfill-era5.mjs
//
// Script CHẠY 1 LẦN THỦ CÔNG — tải dữ liệu khí quyển tái phân tích ERA5
// (áp suất mực biển, gió, độ ẩm) từ Open-Meteo Historical Weather API cho cả
// 78 phường/xã, khớp đúng khoảng ngày đã có sẵn dữ liệu dự báo/thực đo mưa
// trong Neon. Đây là GIAI ĐOẠN A — chỉ tải dữ liệu, CHƯA xây mô hình hiệu
// chỉnh (việc đó làm ở bước sau, sau khi kiểm chứng dữ liệu này có ích).
//
// LƯU Ý: ERA5 có độ trễ ~5 ngày (cần thời gian "chốt" dữ liệu), nên KHÔNG
// tải được sát đến hôm nay — mặc định tự lùi lại 7 ngày cho an toàn.
//
// CÁCH CHẠY (đứng ở thư mục quangtri-weather-app):
//   node scripts/backfill-era5.mjs
//   (tuỳ chọn: chạy lại từ 1 ngày cụ thể nếu bị đứt giữa chừng)
//   node scripts/backfill-era5.mjs 2025-03-06 2026-08-20

import fs from 'fs';
import path from 'path';
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

const { XA_PHUONG } = await import(
  (await import('url')).pathToFileURL(path.join(BASE_DIR, 'netlify/functions/lib/geo.js')).href
);

const CHUNK_DAYS = 20; // dữ liệu theo giờ, 4 biến x 24h x 78 xã/ngày -> giữ mỗi lần gọi vừa phải
const HOURLY_VARS = 'pressure_msl,wind_speed_10m,wind_direction_10m,relative_humidity_2m';

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function getDefaultDateRange() {
  const rows = await sql`SELECT min(ngay)::text AS min_ngay FROM thuc_do_hang_ngay`;
  const start = rows[0].min_ngay;
  const end = addDays(new Date().toISOString().slice(0, 10), -7); // lùi 7 ngày, tránh vùng ERA5 chưa "chốt"
  return { start, end };
}

async function fetchChunk(startDate, endDate) {
  const lats = XA_PHUONG.map((x) => x.lat).join(',');
  const lngs = XA_PHUONG.map((x) => x.lng).join(',');
  const url = `https://archive-api.open-meteo.com/v1/archive`
    + `?latitude=${lats}&longitude=${lngs}&start_date=${startDate}&end_date=${endDate}`
    + `&hourly=${HOURLY_VARS}&timezone=auto`;

  const MAX_RETRIES = 6;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      if (attempt === MAX_RETRIES) throw new Error('HTTP 429 - vẫn bị giới hạn tốc độ sau nhiều lần thử lại');
      console.log(`  Bị giới hạn tốc độ (429), đợi 65 giây rồi thử lại (lần ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((r) => setTimeout(r, 65000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} - ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    return Array.isArray(json) ? json : [json];
  }
}

// Gộp chuỗi giờ thành theo ngày: áp suất=min cả ngày, gió=max cả ngày (kèm
// đúng hướng gió tại giờ gió mạnh nhất), độ ẩm=trung bình cả ngày.
function aggregateDailyFromHourly(times, pressure, windSpeed, windDir, humidity) {
  const byDay = new Map(); // ngay -> { pMin, wMax, wDirAtMax, humSum, humCount }
  times.forEach((t, i) => {
    const day = String(t).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { pMin: Infinity, wMax: -Infinity, wDirAtMax: null, humSum: 0, humCount: 0 });
    const rec = byDay.get(day);
    const p = pressure?.[i];
    const w = windSpeed?.[i];
    const wd = windDir?.[i];
    const h = humidity?.[i];
    if (p != null && p < rec.pMin) rec.pMin = p;
    if (w != null && w > rec.wMax) { rec.wMax = w; rec.wDirAtMax = wd ?? null; }
    if (h != null) { rec.humSum += h; rec.humCount += 1; }
  });
  return byDay;
}

async function upsertBatch(batch) {
  if (batch.length === 0) return;
  const ngay = batch.map((r) => r.ngay);
  const ma_xa = batch.map((r) => r.ma_xa);
  const ap_suat = batch.map((r) => r.ap_suat_min_hpa);
  const gio_toc_do = batch.map((r) => r.gio_toc_do_max_kmh);
  const gio_huong = batch.map((r) => r.gio_huong_luc_max_deg);
  const do_am = batch.map((r) => r.do_am_tb_pct);

  await sql`
    INSERT INTO du_lieu_khiquyen_era5 (ngay, ma_xa, ap_suat_min_hpa, gio_toc_do_max_kmh, gio_huong_luc_max_deg, do_am_tb_pct)
    SELECT * FROM unnest(
      ${ngay}::date[], ${ma_xa}::int[], ${ap_suat}::float8[], ${gio_toc_do}::float8[], ${gio_huong}::float8[], ${do_am}::float8[]
    )
    ON CONFLICT (ngay, ma_xa) DO UPDATE SET
      ap_suat_min_hpa = EXCLUDED.ap_suat_min_hpa, gio_toc_do_max_kmh = EXCLUDED.gio_toc_do_max_kmh,
      gio_huong_luc_max_deg = EXCLUDED.gio_huong_luc_max_deg, do_am_tb_pct = EXCLUDED.do_am_tb_pct,
      cap_nhat_luc = now()
  `;
}

async function main() {
  const argStart = process.argv[2];
  const argEnd = process.argv[3];
  let { start, end } = argStart && argEnd ? { start: argStart, end: argEnd } : await getDefaultDateRange();
  console.log(`Khoảng ngày tải ERA5: ${start} -> ${end}`);

  let totalRows = 0;
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = addDays(cursor, CHUNK_DAYS - 1) > end ? end : addDays(cursor, CHUNK_DAYS - 1);
    console.log(`Đang gọi ERA5 cho ${cursor} -> ${chunkEnd} (78 xã)...`);

    let results;
    try {
      results = await fetchChunk(cursor, chunkEnd);
    } catch (e) {
      console.error(`  Lỗi khi gọi API cho đoạn ${cursor}->${chunkEnd}: ${e.message}`);
      cursor = addDays(chunkEnd, 1);
      continue;
    }
    await new Promise((r) => setTimeout(r, 2000)); // nghỉ chủ động giữa các lần gọi

    if (results.length !== XA_PHUONG.length) {
      console.error(`  CẢNH BÁO: API trả về ${results.length} kết quả, kỳ vọng ${XA_PHUONG.length} — bỏ qua đoạn này`);
      cursor = addDays(chunkEnd, 1);
      continue;
    }

    const batch = [];
    results.forEach((r, idx) => {
      const xa = XA_PHUONG[idx];
      const times = r?.hourly?.time || [];
      const byDay = aggregateDailyFromHourly(
        times, r?.hourly?.pressure_msl, r?.hourly?.wind_speed_10m, r?.hourly?.wind_direction_10m, r?.hourly?.relative_humidity_2m,
      );
      for (const [ngay, agg] of byDay.entries()) {
        batch.push({
          ngay,
          ma_xa: xa.ma_xa,
          ap_suat_min_hpa: Number.isFinite(agg.pMin) ? agg.pMin : null,
          gio_toc_do_max_kmh: Number.isFinite(agg.wMax) ? agg.wMax : null,
          gio_huong_luc_max_deg: agg.wDirAtMax,
          do_am_tb_pct: agg.humCount > 0 ? Math.round((agg.humSum / agg.humCount) * 10) / 10 : null,
        });
      }
    });

    await upsertBatch(batch);
    totalRows += batch.length;
    console.log(`  Đã nạp ${batch.length} dòng (tổng cộng ${totalRows})`);

    cursor = addDays(chunkEnd, 1);
  }

  console.log(`XONG. Tổng cộng đã nạp ${totalRows} dòng vào du_lieu_khiquyen_era5.`);
}

main().catch((e) => { console.error('LỖI:', e); process.exit(1); });
