// netlify/functions/collect-observed.mjs
//
// Netlify Scheduled Function — chạy mỗi ngày 00:20 giờ VN (5 phút sau
// collect-forecast, tránh dồn việc chung 1 lần chạy làm tăng rủi ro vượt
// giới hạn 10 giây/lần của gói Free). Lấy mưa 24h + nhiệt độ max/min của
// NGÀY HÔM QUA cho từng phường/xã (ghép theo trạm gần nhất), lưu vào bảng
// thuc_do_hang_ngay.

import { neon } from '@neondatabase/serverless';
import { XA_PHUONG, TRAM_NHIET_DO, nearest } from './lib/geo.js';
import { fetchKttvRawSeries, vnCalendarDayRange, vnDateParts, dateStr } from './lib/kttv-client.js';

export const config = { schedule: '20 17 * * *' };

const sql = neon(process.env.DATABASE_URL);

async function fetchRainStations() {
  const base = process.env.URL || 'https://quangtri-dubaothoitiet.netlify.app';
  const res = await fetch(`${base}/.netlify/functions/rainfall`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.stations || []).filter((s) => s.coords);
}

async function fetchTempStationsYesterday() {
  const yday = vnDateParts(-1);
  const { start, end } = vnCalendarDayRange(yday);
  const errors = [];

  const settled = await Promise.allSettled(
    TRAM_NHIET_DO.map(async (st) => {
      const series = await fetchKttvRawSeries(st, start, end);
      const values = series.map((p) => p.value);
      return { ...st, tmax: Math.max(...values), tmin: Math.min(...values) };
    }),
  );

  const stations = [];
  settled.forEach((r, idx) => {
    if (r.status === 'fulfilled') stations.push(r.value);
    else errors.push(`Nhiệt độ ${TRAM_NHIET_DO[idx].name}: ${r.reason?.message || r.reason}`);
  });
  return { stations, errors };
}

export default async () => {
  const summary = { started_at: new Date().toISOString() };
  const errors = [];
  try {
    const yday = vnDateParts(-1);
    const ngayStr = dateStr(yday);

    let rainStations = [];
    try {
      rainStations = await fetchRainStations();
    } catch (e) {
      errors.push(`Mưa (rainfall.js): ${e.message}`);
    }

    const { stations: tempStations, errors: tempErrors } = await fetchTempStationsYesterday();
    errors.push(...tempErrors);

    const ngay = [];
    const ma_xa_col = [];
    const mua_24h = [];
    const mua_tram_id = [];
    const mua_kc = [];
    const nhietdo_max = [];
    const nhietdo_min = [];
    const nhietdo_tram_id = [];
    const nhietdo_kc = [];

    const rainPoints = rainStations.map((s) => ({ ...s, lat: s.coords.lat, lng: s.coords.lng }));

    for (const xa of XA_PHUONG) {
      const rainNear = nearest(xa.lat, xa.lng, rainPoints);
      const tempNear = nearest(xa.lat, xa.lng, tempStations);

      ngay.push(ngayStr);
      ma_xa_col.push(xa.ma_xa);
      mua_24h.push(rainNear ? rainNear.point.rain_24h : null);
      mua_tram_id.push(rainNear ? rainNear.point.id : null);
      mua_kc.push(rainNear ? rainNear.distanceKm : null);
      nhietdo_max.push(tempNear ? tempNear.point.tmax : null);
      nhietdo_min.push(tempNear ? tempNear.point.tmin : null);
      nhietdo_tram_id.push(tempNear ? tempNear.point.matram : null);
      nhietdo_kc.push(tempNear ? tempNear.distanceKm : null);
    }

    await sql`
      INSERT INTO thuc_do_hang_ngay (
        ngay, ma_xa, mua_24h_mm, mua_tram_id, mua_khoang_cach_km,
        nhietdo_max, nhietdo_min, nhietdo_tram_id, nhietdo_khoang_cach_km
      )
      SELECT * FROM unnest(
        ${ngay}::date[], ${ma_xa_col}::int[], ${mua_24h}::float8[], ${mua_tram_id}::text[], ${mua_kc}::float8[],
        ${nhietdo_max}::float8[], ${nhietdo_min}::float8[], ${nhietdo_tram_id}::text[], ${nhietdo_kc}::float8[]
      )
      ON CONFLICT (ngay, ma_xa) DO UPDATE SET
        mua_24h_mm = EXCLUDED.mua_24h_mm, mua_tram_id = EXCLUDED.mua_tram_id, mua_khoang_cach_km = EXCLUDED.mua_khoang_cach_km,
        nhietdo_max = EXCLUDED.nhietdo_max, nhietdo_min = EXCLUDED.nhietdo_min,
        nhietdo_tram_id = EXCLUDED.nhietdo_tram_id, nhietdo_khoang_cach_km = EXCLUDED.nhietdo_khoang_cach_km
    `;

    summary.rows = ngay.length;
    summary.errors = errors;
    console.log('[collect-observed] Xong:', JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[collect-observed] Lỗi:', e);
    return new Response(JSON.stringify({ error: e.message, summary }), { status: 500 });
  }
};
