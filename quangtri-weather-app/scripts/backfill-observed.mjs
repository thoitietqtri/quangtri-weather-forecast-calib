// scripts/backfill-observed.mjs
//
// Script CHẠY 1 LẦN THỦ CÔNG trên máy anh Hudson (KHÔNG PHẢI Netlify
// Function — không giới hạn thời gian, không cần deploy). Đọc 3 file Excel
// lịch sử thực đo (mưa KTTV, nhiệt độ KTTV, mưa VRain) rồi ghép vào từng
// phường/xã theo trạm gần nhất, nạp vào bảng thuc_do_hang_ngay trong Neon.
//
// CÁCH CHẠY:
//   1. Copy 3 file Excel vào thư mục quangtri-weather-app/data/ với ĐÚNG
//      tên: MUA_APIKTTV.xlsx, NHIETDO.xlsx, vrain1.xlsx
//   2. cd quangtri-weather-app
//   3. npm install xlsx --save-dev   (nếu chưa cài)
//   4. node scripts/backfill-observed.mjs   (chạy ở thư mục gốc repo, vì
//      đường dẫn data/ tính tương đối theo đó — xem BASE_DIR bên dưới)
//
// Script tự đọc DATABASE_URL từ file .env trong quangtri-weather-app/.env
// (không cần "netlify dev" đang chạy).

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';

// ============ Đọc .env thủ công (script chạy độc lập, không qua Netlify) ============
const BASE_DIR = path.resolve(process.cwd().endsWith('quangtri-weather-app') ? process.cwd() : path.join(process.cwd(), 'quangtri-weather-app'));
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

const DATA_DIR = path.join(BASE_DIR, 'data');

import { XA_PHUONG, nearest } from '../netlify/functions/lib/geo.js';

// ============ 5 trạm khí tượng KTTV có trong 2 file MUA_APIKTTV.xlsx / NHIETDO.xlsx ============
// (tên cột Excel -> id ổn định + toạ độ, lấy từ danh sách KTTV_STATIONS đã dùng ở rainfall.js)
const KTTV_METEO_5 = {
  'Dong Hoi meteo': { id: 'kttv_555600', lat: 17.4833, lng: 106.6 },
  'Tuyen Hoa':      { id: 'kttv_557500', lat: 17.8833, lng: 106.017 },
  'Ba Don':         { id: 'kttv_557700', lat: 17.75, lng: 106.417 },
  'Khe Sanh':       { id: 'kttv_557200', lat: 16.6333, lng: 106.733 },
  'Dong Ha meteo':  { id: 'kttv_557300', lat: 16.85, lng: 107.083 },
};

// ============ 64/74 trạm VRain khớp được toạ độ (10 trạm còn lại tên quá khác biệt, bỏ qua) ============
const VRAIN_HIST_COORDS = {
  'A Bung': { lat: 16.368303, lng: 107.026057 },
  'A Dơi': { lat: 16.481504, lng: 106.744225 },
  'A Vao': { lat: 16.389444, lng: 106.949444 },
  'Ba Nang': { lat: 16.585439, lng: 106.866494 },
  'Bắc Trạch': { lat: 17.697859, lng: 106.454657 },
  'Bến Quan': { lat: 17.022222, lng: 106.903056 },
  'Cam Chính': { lat: 16.74775, lng: 106.965581 },
  'Cao Quảng': { lat: 17.76983, lng: 106.18847 },
  'Cửa Tùng': { lat: 17.028889, lng: 107.106389 },
  'Hóa Sơn': { lat: 17.761111, lng: 105.884167 },
  'Húc': { lat: 16.599167, lng: 106.760556 },
  'Hướng Linh': { lat: 16.711911, lng: 106.744083 },
  'Hướng Lập': { lat: 16.886691, lng: 106.568597 },
  'Hướng Lộc': { lat: 16.546111, lng: 106.7125 },
  'Hướng Phùng PCTT': { lat: 16.74214, lng: 106.581653 },
  'Hướng Việt': { lat: 16.829722, lng: 106.564444 },
  'Hải An': { lat: 16.777313, lng: 107.330052 },
  'Hải Lâm': { lat: 16.691236, lng: 107.241427 },
  'Hải Phong': { lat: 16.67319, lng: 107.325761 },
  'Hải Thái': { lat: 16.874567, lng: 106.983422 },
  'Hồ An Mã': { lat: 17.109668, lng: 106.817695 },
  'Hồ Cẩm Ly': { lat: 17.2, lng: 106.65 },
  'Hồ Sông Thai': { lat: 17.928356, lng: 106.412901 },
  'Hồ Thác Chuối': { lat: 17.437924, lng: 106.461041 },
  'Hồ Troóc Trâu': { lat: 17.400757, lng: 106.587735 },
  'Hồ Vực Tròn': { lat: 17.881587, lng: 106.36725 },
  'Hồ Đồng Ran': { lat: 17.701469, lng: 106.439971 },
  'Lao Bảo': { lat: 16.615556, lng: 106.598611 },
  'Linh Thượng': { lat: 16.919769, lng: 106.961779 },
  'Liên Trạch': { lat: 17.67866, lng: 106.3948 },
  'Lâm Hóa': { lat: 17.930833, lng: 105.812778 },
  'Lâm Thủy': { lat: 17.063855, lng: 106.509122 },
  'Lìa': { lat: 16.472222, lng: 106.7175 },
  'Nam Thạch Hãn': { lat: 16.694444, lng: 107.146389 },
  'Quán Hàu': { lat: 17.402222, lng: 106.640278 },
  'Quảng Minh': { lat: 17.715716, lng: 106.380848 },
  'Quảng Tiên': { lat: 17.76, lng: 106.321111 },
  'Quảng Trạch': { lat: 17.802778, lng: 106.4075 },
  'Quảng Tùng': { lat: 17.867778, lng: 106.428333 },
  'Thanh': { lat: 16.49169, lng: 106.665938 },
  'Thanh Hóa': { lat: 17.983447, lng: 105.84169 },
  'Thái Thủy': { lat: 17.150278, lng: 106.858889 },
  'Thủy văn Liên Trạch': { lat: 17.67866, lng: 106.3948 },
  'Thủy văn Lý Hòa': { lat: 17.63275, lng: 106.51605 },
  'Thủy văn Roòn': { lat: 17.89313, lng: 106.42433 },
  'Triệu Hòa': { lat: 16.802222, lng: 107.191944 },
  'Triệu Ái': { lat: 16.758044, lng: 107.135221 },
  'Trung Hóa': { lat: 17.739167, lng: 105.961667 },
  'Trung Sơn': { lat: 16.962778, lng: 107.040556 },
  'Trường Xuân PCTT': { lat: 17.307739, lng: 106.621876 },
  'Trọng Hóa': { lat: 17.858056, lng: 105.802778 },
  'Tà Long': { lat: 16.575033, lng: 106.957696 },
  'Tân Hóa': { lat: 17.788952, lng: 106.094498 },
  'Tân Long': { lat: 16.597261, lng: 106.654815 },
  'Vĩnh Khê': { lat: 17.077392, lng: 106.863583 },
  'Vĩnh Tú': { lat: 17.112023, lng: 107.010364 },
  'Vạn Ninh': { lat: 17.280833, lng: 106.684444 },
  'Vạn Trạch': { lat: 17.616207, lng: 106.4534 },
  'Xuân Trạch': { lat: 17.663538, lng: 106.252028 },
  'Đầu mối hồ La Ngà': { lat: 17.025515, lng: 106.95367 },
  'Đầu mối hồ Trung Thuần': { lat: 17.818611, lng: 106.343611 },
  'Đầu mối hồ Trúc Kinh': { lat: 16.870833, lng: 107.0625 },
  'Đầu mối hồ Đá Mài': { lat: 16.82, lng: 106.940833 },
  'Đập, thủy điện La Tó': { lat: 16.505556, lng: 107.029444 },};

function readSheetRows(filename, sheetName) {
  const buf = fs.readFileSync(path.join(DATA_DIR, filename));
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[sheetName || wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
}

// "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DD" (giờ VN, KHÔNG cần quy đổi múi giờ —
// đã xác nhận cột times trong 3 file Excel này vốn là giờ Việt Nam sẵn).
function dayOf(timeStr) {
  return String(timeStr).slice(0, 10);
}

// ============ 1. Mưa KTTV (MUA_APIKTTV.xlsx) — tổng theo ngày, 5 trạm ============
function parseRainKttv() {
  const rows = readSheetRows('MUA_APIKTTV.xlsx');
  const headers = rows[0];
  const colToStation = headers.slice(1).map((h) => {
    const name = h.replace(/^Mua \[mm\] -\s*/, '').trim();
    return KTTV_METEO_5[name] || null;
  });

  // Map<ngay, Map<stationId, tổng mm>>
  const byDay = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0] || String(row[0]).length < 10) continue; // bỏ dòng rỗng/thiếu ngày (dòng thừa cuối file)
    const d = dayOf(row[0]);
    if (!byDay.has(d)) byDay.set(d, new Map());
    const dayMap = byDay.get(d);
    for (let c = 0; c < colToStation.length; c++) {
      const st = colToStation[c];
      if (!st) continue;
      const v = Number(row[c + 1]);
      if (Number.isNaN(v)) continue;
      dayMap.set(st.id, (dayMap.get(st.id) || 0) + v);
    }
  }
  return byDay; // Map<ngay, Map<stationId, mm>>
}

// ============ 2. Nhiệt độ KTTV (NHIETDO.xlsx) — max/min theo ngày, 5 trạm ============
function parseTempKttv() {
  const rows = readSheetRows('NHIETDO.xlsx');
  const headers = rows[0];
  const colToStation = headers.slice(1).map((h) => {
    const name = h.replace(/^NhietDo0\s*C\s*-\s*/, '').trim();
    return KTTV_METEO_5[name] || null;
  });

  // Map<ngay, Map<stationId, {max, min}>>
  const byDay = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0] || String(row[0]).length < 10) continue;
    const d = dayOf(row[0]);
    if (!byDay.has(d)) byDay.set(d, new Map());
    const dayMap = byDay.get(d);
    for (let c = 0; c < colToStation.length; c++) {
      const st = colToStation[c];
      if (!st) continue;
      const v = Number(row[c + 1]);
      if (Number.isNaN(v)) continue;
      const cur = dayMap.get(st.id) || { max: -Infinity, min: Infinity };
      cur.max = Math.max(cur.max, v);
      cur.min = Math.min(cur.min, v);
      dayMap.set(st.id, cur);
    }
  }
  return byDay;
}

// ============ 3. Mưa VRain (vrain1.xlsx) — tổng theo ngày, 64 trạm khớp toạ độ ============
function parseRainVrain() {
  const rows = readSheetRows('vrain1.xlsx', 'wide');
  const headers = rows[0];
  const colToStation = headers.slice(1).map((h) => {
    const coords = VRAIN_HIST_COORDS[h];
    return coords ? { id: `vrain_${h}`, ...coords } : null;
  });

  const byDay = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0] || String(row[0]).length < 10) continue;
    const d = dayOf(row[0]);
    if (!byDay.has(d)) byDay.set(d, new Map());
    const dayMap = byDay.get(d);
    for (let c = 0; c < colToStation.length; c++) {
      const st = colToStation[c];
      if (!st) continue;
      const v = Number(row[c + 1]);
      if (Number.isNaN(v)) continue;
      dayMap.set(st.id, (dayMap.get(st.id) || 0) + v);
    }
  }
  return byDay;
}

// Toạ độ tra cứu nhanh theo id (dùng chung cho việc tìm trạm gần nhất mỗi ngày)
const RAIN_COORDS = {};
for (const [name, st] of Object.entries(KTTV_METEO_5)) RAIN_COORDS[st.id] = { lat: st.lat, lng: st.lng };
for (const [name, c] of Object.entries(VRAIN_HIST_COORDS)) RAIN_COORDS[`vrain_${name}`] = c;

const TEMP_COORDS = {};
for (const [name, st] of Object.entries(KTTV_METEO_5)) TEMP_COORDS[st.id] = { lat: st.lat, lng: st.lng };

async function upsertBatch(rowsForDays) {
  // rowsForDays: mảng { ngay, ma_xa, mua_24h_mm, mua_tram_id, mua_khoang_cach_km,
  //                      nhietdo_max, nhietdo_min, nhietdo_tram_id, nhietdo_khoang_cach_km }
  const ngay = rowsForDays.map((r) => r.ngay);
  const ma_xa = rowsForDays.map((r) => r.ma_xa);
  const mua_24h = rowsForDays.map((r) => r.mua_24h_mm);
  const mua_tram = rowsForDays.map((r) => r.mua_tram_id);
  const mua_kc = rowsForDays.map((r) => r.mua_khoang_cach_km);
  const t_max = rowsForDays.map((r) => r.nhietdo_max);
  const t_min = rowsForDays.map((r) => r.nhietdo_min);
  const t_tram = rowsForDays.map((r) => r.nhietdo_tram_id);
  const t_kc = rowsForDays.map((r) => r.nhietdo_khoang_cach_km);

  await sql`
    INSERT INTO thuc_do_hang_ngay (
      ngay, ma_xa, mua_24h_mm, mua_tram_id, mua_khoang_cach_km,
      nhietdo_max, nhietdo_min, nhietdo_tram_id, nhietdo_khoang_cach_km
    )
    SELECT * FROM unnest(
      ${ngay}::date[], ${ma_xa}::int[], ${mua_24h}::float8[], ${mua_tram}::text[], ${mua_kc}::float8[],
      ${t_max}::float8[], ${t_min}::float8[], ${t_tram}::text[], ${t_kc}::float8[]
    )
    ON CONFLICT (ngay, ma_xa) DO UPDATE SET
      mua_24h_mm = EXCLUDED.mua_24h_mm, mua_tram_id = EXCLUDED.mua_tram_id, mua_khoang_cach_km = EXCLUDED.mua_khoang_cach_km,
      nhietdo_max = EXCLUDED.nhietdo_max, nhietdo_min = EXCLUDED.nhietdo_min,
      nhietdo_tram_id = EXCLUDED.nhietdo_tram_id, nhietdo_khoang_cach_km = EXCLUDED.nhietdo_khoang_cach_km
  `;
}

async function main() {
  console.log('Đang đọc 3 file Excel...');
  const rainKttv = parseRainKttv();
  const tempKttv = parseTempKttv();
  const rainVrain = parseRainVrain();

  // Gộp toàn bộ ngày có mặt trong bất kỳ nguồn nào
  const allDays = new Set([...rainKttv.keys(), ...tempKttv.keys(), ...rainVrain.keys()]);
  const sortedDays = [...allDays].sort();
  console.log(`Tổng số ngày cần nạp: ${sortedDays.length} (${sortedDays[0]} -> ${sortedDays[sortedDays.length - 1]})`);

  const CHUNK_DAYS = 20; // ~20 ngày x 78 xã = 1560 dòng/lần ghi — an toàn cho 1 lần gọi Neon
  let totalRows = 0;

  for (let start = 0; start < sortedDays.length; start += CHUNK_DAYS) {
    const chunk = sortedDays.slice(start, start + CHUNK_DAYS);
    const batch = [];

    for (const ngay of chunk) {
      // Gộp trạm mưa của đúng ngày này (KTTV + VRain nếu có)
      const rainPoints = [];
      const kttvDay = rainKttv.get(ngay);
      if (kttvDay) for (const [id, mm] of kttvDay.entries()) rainPoints.push({ id, rain_24h: mm, ...RAIN_COORDS[id] });
      const vrainDay = rainVrain.get(ngay);
      if (vrainDay) for (const [id, mm] of vrainDay.entries()) rainPoints.push({ id, rain_24h: mm, ...RAIN_COORDS[id] });

      const tempDay = tempKttv.get(ngay);
      const tempPoints = [];
      if (tempDay) for (const [id, mm] of tempDay.entries()) tempPoints.push({ id, ...mm, ...TEMP_COORDS[id] });

      for (const xa of XA_PHUONG) {
        const rainNear = rainPoints.length ? nearest(xa.lat, xa.lng, rainPoints) : null;
        const tempNear = tempPoints.length ? nearest(xa.lat, xa.lng, tempPoints) : null;
        batch.push({
          ngay,
          ma_xa: xa.ma_xa,
          mua_24h_mm: rainNear ? rainNear.point.rain_24h : null,
          mua_tram_id: rainNear ? rainNear.point.id : null,
          mua_khoang_cach_km: rainNear ? rainNear.distanceKm : null,
          nhietdo_max: tempNear ? tempNear.point.max : null,
          nhietdo_min: tempNear ? tempNear.point.min : null,
          nhietdo_tram_id: tempNear ? tempNear.point.id : null,
          nhietdo_khoang_cach_km: tempNear ? tempNear.distanceKm : null,
        });
      }
    }

    await upsertBatch(batch);
    totalRows += batch.length;
    console.log(`Đã nạp xong ${chunk[0]} -> ${chunk[chunk.length - 1]} (${batch.length} dòng, tổng cộng ${totalRows})`);
  }

  console.log(`XONG. Tổng cộng đã nạp ${totalRows} dòng vào thuc_do_hang_ngay.`);
}

main().catch((e) => { console.error('LỖI:', e); process.exit(1); });
