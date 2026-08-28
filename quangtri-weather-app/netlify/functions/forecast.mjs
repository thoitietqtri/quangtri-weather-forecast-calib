// netlify/functions/forecast.mjs
//
// Function THEO YÊU CẦU (không phải scheduled) — frontend gọi vào đây thay
// vì gọi thẳng api.open-meteo.com. Chuyển tiếp y hệt các tham số tới
// Open-Meteo, sau đó CHỈ hiệu chỉnh 2 trường daily.temperature_2m_max và
// daily.temperature_2m_min (theo bảng phân vị đã tính sẵn trong
// bang_phan_vi_hieu_chinh) — mọi trường khác (mưa, gió, dữ liệu hourly...)
// giữ nguyên như Open-Meteo trả về, KHÔNG hiệu chỉnh (mưa đã kiểm chứng
// không cải thiện bằng phương pháp này).
//
// Nếu không tìm được xã hoặc chưa có bảng phân vị cho ngày đó (vd. hạn dự
// báo D+8 trở lên chưa được kiểm chứng, hoặc ngày trong quá khứ) -> TRẢ VỀ
// NGUYÊN GIÁ TRỊ GỐC của Open-Meteo, không suy đoán, không chặn request.

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

// table: mảng đã sắp theo phan_vi_pct tăng dần, mỗi phần tử
// { gia_tri_du_bao, gia_tri_thuc_do }. Nội suy tuyến tính giữa 2 điểm gần
// nhất; ngoài khoảng thì giữ nguyên giá trị biên (không ngoại suy liều lĩnh).
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
  return x; // không nên tới đây, phòng hờ
}

async function loadQuantileTables(ma_xa) {
  const rows = await sql`
    SELECT cum_han_du_bao, bien, phan_vi_pct, gia_tri_du_bao, gia_tri_thuc_do
    FROM bang_phan_vi_hieu_chinh
    WHERE ma_xa = ${ma_xa}
    ORDER BY cum_han_du_bao, bien, phan_vi_pct
  `;
  const tables = {}; // key: `${bucket}|${bien}` -> mảng 101 điểm
  for (const r of rows) {
    const key = `${r.cum_han_du_bao}|${r.bien}`;
    if (!tables[key]) tables[key] = [];
    tables[key].push({ gia_tri_du_bao: r.gia_tri_du_bao, gia_tri_thuc_do: r.gia_tri_thuc_do });
  }
  return tables;
}

export default async (req) => {
  const reqUrl = new URL(req.url);
  const lat = Number(reqUrl.searchParams.get('latitude'));
  const lng = Number(reqUrl.searchParams.get('longitude'));

  // Chuyển tiếp NGUYÊN VẸN mọi tham số khác tới Open-Meteo thật, nhưng LUÔN
  // ép dùng đúng mô hình ECMWF IFS (mô hình chính xác nhất hiện có, miễn phí
  // qua Open-Meteo) — không phụ thuộc vào "Best Match" tự động (có thể đổi
  // mô hình khác mà không báo trước).
  const omUrl = new URL('https://api.open-meteo.com/v1/forecast');
  for (const [k, v] of reqUrl.searchParams.entries()) omUrl.searchParams.set(k, v);
  omUrl.searchParams.set('models', 'ecmwf_ifs');

  let data;
  try {
    const res = await fetch(omUrl.toString());
    data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify(data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: `Không gọi được Open-Meteo: ${e.message}` }), { status: 502 });
  }

  // Không đủ toạ độ hoặc không có dữ liệu daily nhiệt độ -> trả nguyên gốc.
  if (Number.isNaN(lat) || Number.isNaN(lng) || !data?.daily?.time) {
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const nearXa = nearest(lat, lng, XA_PHUONG);
    if (!nearXa) return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const tables = await loadQuantileTables(nearXa.point.ma_xa);
    const today = todayVNDateStr();

    data.daily.time.forEach((dateStr, i) => {
      const lead = leadDays(dateStr, today);
      const bucket = LEAD_BUCKETS.find((b) => b.leads.includes(lead));
      if (!bucket) return; // ngoài phạm vi đã kiểm chứng (D+0 hoặc D+8 trở lên) -> giữ nguyên

      if (Array.isArray(data.daily.temperature_2m_max)) {
        const table = tables[`${bucket.name}|tmax`];
        if (table) data.daily.temperature_2m_max[i] = Math.round(applyQuantileMap(data.daily.temperature_2m_max[i], table) * 10) / 10;
      }
      if (Array.isArray(data.daily.temperature_2m_min)) {
        const table = tables[`${bucket.name}|tmin`];
        if (table) data.daily.temperature_2m_min[i] = Math.round(applyQuantileMap(data.daily.temperature_2m_min[i], table) * 10) / 10;
      }
    });
  } catch (e) {
    // Lỗi hiệu chỉnh (vd. Neon tạm thời lỗi) -> vẫn trả dữ liệu GỐC cho
    // người dùng thay vì báo lỗi trắng màn hình. Ghi log để biết mà kiểm tra.
    console.error('[forecast] Lỗi khi hiệu chỉnh, trả dữ liệu gốc:', e);
  }

  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
