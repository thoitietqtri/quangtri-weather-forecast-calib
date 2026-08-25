// netlify/functions/collect-forecast.mjs
//
// Netlify Scheduled Function — chạy mỗi ngày 00:15 giờ VN (cron UTC).
// Lưu TOÀN BỘ vector 15-16 ngày dự báo Open-Meteo cho cả 78 phường/xã vào
// bảng du_bao_hang_ngay.
//
// QUAN TRỌNG: gói Netlify Free giới hạn CỨNG 10 giây/lần chạy function,
// không có ngoại lệ. Vì vậy dùng đúng 1 lần gọi Open-Meteo cho TẤT CẢ 78 xã
// cùng lúc (Open-Meteo hỗ trợ nhiều toạ độ cách nhau dấu phẩy trong 1
// request, trả về mảng kết quả theo đúng thứ tự) — vừa nhanh hơn nhiều lần
// gọi riêng lẻ, vừa tránh bị chặn HTTP 429 (rate limit) như lúc gọi 78 lần
// đồng thời.

import { neon } from '@neondatabase/serverless';
import { XA_PHUONG } from './lib/geo.js';

export const config = { schedule: '15 17 * * *' };

const sql = neon(process.env.DATABASE_URL);

async function seedCommunes() {
  const ma_xa = XA_PHUONG.map((x) => x.ma_xa);
  const ten_xa = XA_PHUONG.map((x) => x.ten_xa);
  const lat = XA_PHUONG.map((x) => x.lat);
  const lng = XA_PHUONG.map((x) => x.lng);
  await sql`
    INSERT INTO xa_phuong (ma_xa, ten_xa, lat, lng)
    SELECT * FROM unnest(${ma_xa}::int[], ${ten_xa}::text[], ${lat}::float8[], ${lng}::float8[])
    ON CONFLICT (ma_xa) DO UPDATE SET ten_xa = EXCLUDED.ten_xa, lat = EXCLUDED.lat, lng = EXCLUDED.lng
  `;
}

async function fetchBatchForecast() {
  const lats = XA_PHUONG.map((x) => x.lat).join(',');
  const lngs = XA_PHUONG.map((x) => x.lng).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}`
    + `&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&forecast_days=16&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // Nhiều toạ độ -> Open-Meteo trả về MẢNG kết quả (đúng thứ tự với input).
  // Phòng trường hợp chỉ 1 xã (mảng có 1 phần tử -> API có thể trả object
  // đơn thay vì mảng) thì tự bọc lại thành mảng cho nhất quán.
  return Array.isArray(json) ? json : [json];
}

export default async () => {
  const summary = { started_at: new Date().toISOString() };
  try {
    await seedCommunes();

    const today = new Date(Date.now() + 7 * 3600 * 1000); // giờ VN
    const issuedDateStr = today.toISOString().slice(0, 10);

    const results = await fetchBatchForecast();
    if (results.length !== XA_PHUONG.length) {
      throw new Error(`Open-Meteo trả về ${results.length} kết quả, kỳ vọng ${XA_PHUONG.length}`);
    }

    const ngay_du_bao = [];
    const ngay_ap_dung = [];
    const han_du_bao = [];
    const ma_xa_col = [];
    const mua_mm = [];
    const nhietdo_max = [];
    const nhietdo_min = [];

    results.forEach((r, idx) => {
      const xa = XA_PHUONG[idx];
      const dates = r?.daily?.time || [];
      const rain = r?.daily?.precipitation_sum || [];
      const tmax = r?.daily?.temperature_2m_max || [];
      const tmin = r?.daily?.temperature_2m_min || [];
      dates.forEach((d, lead) => {
        ngay_du_bao.push(issuedDateStr);
        ngay_ap_dung.push(d);
        han_du_bao.push(lead);
        ma_xa_col.push(xa.ma_xa);
        mua_mm.push(rain[lead] ?? null);
        nhietdo_max.push(tmax[lead] ?? null);
        nhietdo_min.push(tmin[lead] ?? null);
      });
    });

    if (ngay_du_bao.length > 0) {
      await sql`
        INSERT INTO du_bao_hang_ngay (ngay_du_bao, ngay_ap_dung, han_du_bao, ma_xa, mua_mm, nhietdo_max, nhietdo_min)
        SELECT * FROM unnest(
          ${ngay_du_bao}::date[], ${ngay_ap_dung}::date[], ${han_du_bao}::smallint[],
          ${ma_xa_col}::int[], ${mua_mm}::float8[], ${nhietdo_max}::float8[], ${nhietdo_min}::float8[]
        )
        ON CONFLICT (ngay_du_bao, ma_xa, han_du_bao) DO UPDATE SET
          mua_mm = EXCLUDED.mua_mm, nhietdo_max = EXCLUDED.nhietdo_max, nhietdo_min = EXCLUDED.nhietdo_min
      `;
    }

    summary.rows = ngay_du_bao.length;
    console.log('[collect-forecast] Xong:', JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[collect-forecast] Lỗi:', e);
    return new Response(JSON.stringify({ error: e.message, summary }), { status: 500 });
  }
};
