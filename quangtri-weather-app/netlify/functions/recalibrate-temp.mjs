// netlify/functions/recalibrate-temp.mjs
//
// Netlify Scheduled Function — chạy hàng TUẦN (Chủ nhật 01:00 giờ VN). Đọc
// TOÀN BỘ lịch sử dự báo+thực đo nhiệt độ đã tích luỹ, tính lại bảng phân
// vị hiệu chỉnh (101 điểm phân vị 0-100%) cho mỗi tổ hợp (xã, cụm hạn dự
// báo, biến), lưu vào bang_phan_vi_hieu_chinh.
//
// CHỈ hiệu chỉnh nhiệt độ (tmax/tmin) — mưa đã kiểm chứng KHÔNG cải thiện
// bằng phương pháp này (xem kết quả phân tích: MAE mưa tăng thay vì giảm).
//
// QUAN TRỌNG (giống bài học ở collect-forecast.mjs): gói Free giới hạn 30
// giây/lần chạy Scheduled Function — gộp thành VÀI LƯỢT truy vấn lớn, KHÔNG
// lặp qua từng xã gọi DB riêng lẻ (78 xã x nhiều truy vấn sẽ vượt giới hạn).

import { neon } from '@neondatabase/serverless';

export const config = { schedule: '0 18 * * 0' }; // Chủ nhật 18:00 UTC = 01:00 thứ Hai giờ VN

const sql = neon(process.env.DATABASE_URL);

const LEAD_BUCKETS = [
  { name: 'D+1-3', leads: [1, 2, 3] },
  { name: 'D+4-7', leads: [4, 5, 6, 7] },
];
const PERCENTILES = Array.from({ length: 101 }, (_, i) => i);
const MIN_SAMPLES = 30;
const XA_CHUNK = 20; // chia nhỏ số xã mỗi lần fetch để tránh 1 câu query quá nặng

function percentileValue(sortedArr, pct) {
  const n = sortedArr.length;
  const idx = Math.min(n - 1, Math.max(0, Math.round((pct / 100) * (n - 1))));
  return sortedArr[idx];
}

export default async () => {
  const summary = { started_at: new Date().toISOString(), updated_tables: 0, skipped_insufficient_data: 0 };
  try {
    const xaRows = await sql`SELECT ma_xa FROM xa_phuong ORDER BY ma_xa`;
    const allXaIds = xaRows.map((r) => r.ma_xa);

    const allRows = [];
    for (let i = 0; i < allXaIds.length; i += XA_CHUNK) {
      const idsChunk = allXaIds.slice(i, i + XA_CHUNK);
      const rows = await sql`
        SELECT f.ma_xa, f.han_du_bao,
               f.nhietdo_max AS forecast_tmax, f.nhietdo_min AS forecast_tmin,
               o.nhietdo_max AS observed_tmax, o.nhietdo_min AS observed_tmin
        FROM du_bao_hang_ngay f
        JOIN thuc_do_hang_ngay o ON o.ma_xa = f.ma_xa AND o.ngay = f.ngay_ap_dung
        WHERE f.ma_xa = ANY(${idsChunk}) AND f.han_du_bao BETWEEN 1 AND 7
      `;
      allRows.push(...rows);
    }
    console.log(`[recalibrate-temp] Đã tải ${allRows.length} dòng dữ liệu ghép cặp.`);

    const groups = new Map();
    for (const r of allRows) {
      const bucket = LEAD_BUCKETS.find((b) => b.leads.includes(r.han_du_bao));
      if (!bucket) continue;
      const key = `${r.ma_xa}|${bucket.name}`;
      if (!groups.has(key)) groups.set(key, { tmaxF: [], tmaxO: [], tminF: [], tminO: [] });
      const g = groups.get(key);
      if (r.forecast_tmax != null && r.observed_tmax != null) { g.tmaxF.push(r.forecast_tmax); g.tmaxO.push(r.observed_tmax); }
      if (r.forecast_tmin != null && r.observed_tmin != null) { g.tminF.push(r.forecast_tmin); g.tminO.push(r.observed_tmin); }
    }

    const ma_xa_col = []; const bucket_col = []; const bien_col = []; const pct_col = [];
    const fval_col = []; const oval_col = [];

    for (const [key, g] of groups.entries()) {
      const [ma_xa_str, bucketName] = key.split('|');
      const ma_xa = Number(ma_xa_str);

      for (const [bien, fArrRaw, oArrRaw] of [['tmax', g.tmaxF, g.tmaxO], ['tmin', g.tminF, g.tminO]]) {
        if (fArrRaw.length < MIN_SAMPLES) { summary.skipped_insufficient_data += 1; continue; }
        const fArr = [...fArrRaw].sort((a, b) => a - b);
        const oArr = [...oArrRaw].sort((a, b) => a - b);
        for (const pct of PERCENTILES) {
          ma_xa_col.push(ma_xa); bucket_col.push(bucketName); bien_col.push(bien); pct_col.push(pct);
          fval_col.push(percentileValue(fArr, pct)); oval_col.push(percentileValue(oArr, pct));
        }
        summary.updated_tables += 1;
      }
    }

    const WRITE_CHUNK = 8000;
    for (let i = 0; i < ma_xa_col.length; i += WRITE_CHUNK) {
      const s = i; const e = Math.min(i + WRITE_CHUNK, ma_xa_col.length);
      await sql`
        INSERT INTO bang_phan_vi_hieu_chinh (ma_xa, cum_han_du_bao, bien, phan_vi_pct, gia_tri_du_bao, gia_tri_thuc_do)
        SELECT * FROM unnest(
          ${ma_xa_col.slice(s, e)}::int[], ${bucket_col.slice(s, e)}::text[], ${bien_col.slice(s, e)}::text[],
          ${pct_col.slice(s, e)}::smallint[], ${fval_col.slice(s, e)}::float8[], ${oval_col.slice(s, e)}::float8[]
        )
        ON CONFLICT (ma_xa, cum_han_du_bao, bien, phan_vi_pct) DO UPDATE SET
          gia_tri_du_bao = EXCLUDED.gia_tri_du_bao, gia_tri_thuc_do = EXCLUDED.gia_tri_thuc_do, cap_nhat_luc = now()
      `;
    }

    summary.total_quantile_rows = ma_xa_col.length;
    console.log('[recalibrate-temp] Xong:', JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[recalibrate-temp] Lỗi:', e);
    return new Response(JSON.stringify({ error: e.message, summary }), { status: 500 });
  }
};
