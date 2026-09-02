// netlify/functions/forecast.mjs
//
// Function THEO YÊU CẦU (không phải scheduled) — frontend gọi vào đây thay
// vì gọi thẳng api.open-meteo.com. Hỗ trợ 2 chế độ:
//   - 1 xã (latitude/longitude là 1 số) — dùng cho popup chi tiết khi chọn xã.
//   - Hàng loạt (latitude/longitude là danh sách cách nhau dấu phẩy) — dùng
//     cho bảng "Dự báo 7 ngày" hiển thị cả 78 xã cùng lúc.
// Cả 2 chế độ đều CHỈ hiệu chỉnh daily.temperature_2m_max/min theo bảng
// phân vị — mọi trường khác (mưa, gió...) giữ nguyên như Open-Meteo trả về.
//
// Nếu không tìm được xã hoặc chưa có bảng phân vị cho ngày đó (vd. hạn dự
// báo D+8 trở lên, hoặc ngày trong quá khứ) -> TRẢ VỀ NGUYÊN GIÁ TRỊ GỐC.

import { neon } from '@neondatabase/serverless';
import { XA_PHUONG, nearest } from './lib/geo.js';

const sql = neon(process.env.DATABASE_URL);

const LEAD_BUCKETS = [
  { name: 'D+1-3', leads: [1, 2, 3] },
  { name: 'D+4-7', leads: [4, 5, 6, 7] },
];

function todayVNDateStr() {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  return vn.toISOString().slice(0, 10);
}

function leadDays(dateStr, todayStr) {
  const d1 = new Date(`${dateStr}T00:00:00Z`);
  const d0 = new Date(`${todayStr}T00:00:00Z`);
  return Math.round((d1 - d0) / 86400000);
}

function applyQuantileMap(x, table) {
  if (x == null || !table || table.length === 0) return x;
  if (x <= table[0].gia_tri_du_bao) return table[0].gia_tri_thuc_do;
  const last = table[table.length - 1];
  if (x >= last.gia_tri_du_bao) return last.gia_tri_thuc_do;
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i]; const b = table[i + 1];
    if (x >= a.gia_tri_du_bao && x <= b.gia_tri_du_bao) {
      const span = b.gia_tri_du_bao - a.gia_tri_du_bao;
      const frac = span === 0 ? 0 : (x - a.gia_tri_du_bao) / span;
      return a.gia_tri_thuc_do + frac * (b.gia_tri_thuc_do - a.gia_tri_thuc_do);
    }
  }
  return x;
}

// Tải bảng phân vị cho MỘT HOẶC NHIỀU xã cùng lúc — luôn đúng 1 lượt truy
// vấn Neon duy nhất (dùng WHERE ma_xa = ANY(...)), tránh phải gọi Neon 78
// lần riêng lẻ khi phục vụ bảng "Dự báo 7 ngày" (sẽ chậm/dễ vượt giới hạn).
async function loadQuantileTablesForXaList(maXaList) {
  const rows = await sql`
    SELECT ma_xa, cum_han_du_bao, bien, phan_vi_pct, gia_tri_du_bao, gia_tri_thuc_do
    FROM bang_phan_vi_hieu_chinh
    WHERE ma_xa = ANY(${maXaList})
    ORDER BY ma_xa, cum_han_du_bao, bien, phan_vi_pct
  `;
  const byXa = {}; // ma_xa -> { "bucket|bien" -> mảng 101 điểm }
  for (const r of rows) {
    if (!byXa[r.ma_xa]) byXa[r.ma_xa] = {};
    const key = `${r.cum_han_du_bao}|${r.bien}`;
    if (!byXa[r.ma_xa][key]) byXa[r.ma_xa][key] = [];
    byXa[r.ma_xa][key].push({ gia_tri_du_bao: r.gia_tri_du_bao, gia_tri_thuc_do: r.gia_tri_thuc_do });
  }
  return byXa;
}

async function loadWithTimeout(maXaList, timeoutMs = 2500) {
  return Promise.race([
    loadQuantileTablesForXaList(maXaList),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Neon phản hồi quá ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

// Áp hiệu chỉnh vào 1 object `daily` (theo đúng shape Open-Meteo trả về)
// dùng đúng bảng phân vị của 1 xã cụ thể.
function correctDailyObject(daily, tables, today) {
  if (!daily?.time) return;
  daily.time.forEach((dateStr, i) => {
    const lead = leadDays(dateStr, today);
    const bucket = LEAD_BUCKETS.find((b) => b.leads.includes(lead));
    if (!bucket) return;
    if (Array.isArray(daily.temperature_2m_max)) {
      const table = tables?.[`${bucket.name}|tmax`];
      if (table) daily.temperature_2m_max[i] = Math.round(applyQuantileMap(daily.temperature_2m_max[i], table) * 10) / 10;
    }
    if (Array.isArray(daily.temperature_2m_min)) {
      const table = tables?.[`${bucket.name}|tmin`];
      if (table) daily.temperature_2m_min[i] = Math.round(applyQuantileMap(daily.temperature_2m_min[i], table) * 10) / 10;
    }
  });
}

export default async (req) => {
  const reqUrl = new URL(req.url);
  const latParam = reqUrl.searchParams.get('latitude') || '';
  const lngParam = reqUrl.searchParams.get('longitude') || '';
  const isBatch = latParam.includes(',');

  const omUrl = new URL('https://api.open-meteo.com/v1/forecast');
  for (const [k, v] of reqUrl.searchParams.entries()) omUrl.searchParams.set(k, v);
  omUrl.searchParams.set('models', 'ecmwf_ifs');

  let data;
  try {
    const controller = new AbortController();
    // Chế độ hàng loạt (78 xã) cần payload lớn hơn nhiều so với 1 xã -> cho
    // thêm thời gian, nhưng bù lại giảm thời gian chờ Neon ở bước sau để
    // tổng cộng vẫn nằm trong giới hạn cứng 10 giây của Netlify Function.
    const omTimeoutMs = isBatch ? 7000 : 6000;
    const timer = setTimeout(() => controller.abort(), omTimeoutMs);
    let res;
    try {
      res = await fetch(omUrl.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify(data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: `Không gọi được Open-Meteo: ${e.message}` }), { status: 502 });
  }

  const today = todayVNDateStr();

  try {
    if (isBatch) {
      const lats = latParam.split(',').map(Number);
      const lngs = lngParam.split(',').map(Number);
      if (!Array.isArray(data) || data.length !== lats.length) {
        return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // Xác định đúng xã cho từng vị trí trong danh sách gửi lên.
      const xaPerIndex = lats.map((lat, i) => nearest(lat, lngs[i], XA_PHUONG)?.point?.ma_xa).filter(Boolean);
      const uniqueXaIds = [...new Set(xaPerIndex)];
      const tablesByXa = await loadWithTimeout(uniqueXaIds);

      data.forEach((entry, i) => {
        const maXa = xaPerIndex[i];
        if (maXa != null) correctDailyObject(entry.daily, tablesByXa[maXa], today);
      });
    } else {
      const lat = Number(latParam);
      const lng = Number(lngParam);
      if (Number.isNaN(lat) || Number.isNaN(lng) || !data?.daily?.time) {
        return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const nearXa = nearest(lat, lng, XA_PHUONG);
      if (nearXa) {
        const tablesByXa = await loadWithTimeout([nearXa.point.ma_xa]);
        correctDailyObject(data.daily, tablesByXa[nearXa.point.ma_xa], today);
      }
    }
  } catch (e) {
    console.error('[forecast] Lỗi khi hiệu chỉnh, trả dữ liệu gốc:', e);
  }

  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
