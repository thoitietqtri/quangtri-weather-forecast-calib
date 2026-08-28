// scripts/analyze-calibration-rain.mjs
//
// Script CHẠY 1 LẦN THỦ CÔNG — kiểm chứng phương pháp hiệu chỉnh MƯA mới
// (khác nhiệt độ), trước khi quyết định có đưa vào hệ thống tự động không.
//
// Ý TƯỞNG (khác hẳn cách làm nhiệt độ — quantile mapping thẳng đã thất bại
// với mưa ở lần thử trước):
//   BƯỚC 1 — Hiệu chỉnh "có mưa hay không": mô hình NWP hay báo mưa lất
//     phất (drizzle bias) nhiều hơn thực tế. Tìm 1 ngưỡng trên giá trị DỰ
//     BÁO sao cho tỷ lệ "ngày dự báo vượt ngưỡng" khớp đúng tỷ lệ "ngày
//     thực đo có mưa" (frequency matching). Dự báo dưới ngưỡng -> coi như
//     không mưa (0mm).
//   BƯỚC 2 — Chỉ với các ngày ĐÃ XÁC ĐỊNH có mưa (cả 2 phía), mới áp
//     quantile mapping cho phần CƯỜNG ĐỘ — tách hẳn khỏi khối ngày khô,
//     tránh làm méo phân phối như lần thử trước.
//   + CHIA THEO MÙA (mùa mưa 9-12, mùa khô còn lại) — nghi ngờ lần thử
//     trước tập train/test bị lệch mùa gây sai lệch thêm.
//
// CÁCH CHẠY (đứng ở thư mục quangtri-weather-app):
//   node scripts/analyze-calibration-rain.mjs

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
const sql = neon(process.env.DATABASE_URL);

const LEAD_BUCKETS = [
  { name: 'D+1-3', leads: [1, 2, 3] },
  { name: 'D+4-7', leads: [4, 5, 6, 7] },
];
const SEASONS = [
  { name: 'Mùa mưa (T9-T12)', months: [9, 10, 11, 12] },
  { name: 'Mùa khô (T1-T8)', months: [1, 2, 3, 4, 5, 6, 7, 8] },
];
const WET_THRESHOLD_MM = 0.1; // >= mức này coi là "có mưa" (loại nhiễu đo lường vặt)
const TRAIN_FRACTION = 0.7;
const MIN_SAMPLES = 30;
const MIN_WET_SAMPLES = 15; // cần đủ ngày mưa mới tin cậy hiệu chỉnh cường độ

function mae(pred, actual) {
  let s = 0;
  for (let i = 0; i < pred.length; i++) s += Math.abs(pred[i] - actual[i]);
  return s / pred.length;
}
function bias(pred, actual) {
  let s = 0;
  for (let i = 0; i < pred.length; i++) s += (pred[i] - actual[i]);
  return s / pred.length;
}

// Tìm ngưỡng trên forecast (tập train) sao cho tỷ lệ forecast > ngưỡng
// khớp đúng tỷ lệ observed >= WET_THRESHOLD_MM (frequency matching).
function findWetThreshold(trainForecast, trainObserved) {
  const wetFraction = trainObserved.filter((v) => v >= WET_THRESHOLD_MM).length / trainObserved.length;
  const sortedF = [...trainForecast].sort((a, b) => a - b);
  const idx = Math.min(sortedF.length - 1, Math.max(0,
    Math.round((1 - wetFraction) * sortedF.length)));
  return sortedF[idx];
}

// Quantile mapping thực nghiệm CHỈ trên tập con "có mưa" (đã lọc trước).
function buildIntensityMap(trainWetForecast, trainWetObserved) {
  const n = trainWetForecast.length;
  const fSorted = [...trainWetForecast].sort((a, b) => a - b);
  const oSorted = [...trainWetObserved].sort((a, b) => a - b);
  return function apply(x) {
    let lo = 0; let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fSorted[mid] <= x) lo = mid + 1; else hi = mid;
    }
    const idx = Math.min(n - 1, Math.max(0, Math.round((lo / n) * (n - 1))));
    return oSorted[idx];
  };
}

function splitByDate(rows) {
  const uniqueDates = [...new Set(rows.map((r) => r.ngay_ap_dung))].sort();
  const splitIdx = Math.floor(uniqueDates.length * TRAIN_FRACTION);
  const trainDates = new Set(uniqueDates.slice(0, splitIdx));
  return {
    train: rows.filter((r) => trainDates.has(r.ngay_ap_dung)),
    test: rows.filter((r) => !trainDates.has(r.ngay_ap_dung)),
  };
}

function evaluateTwoStep(rows) {
  const valid = rows.filter((r) => r.forecast_rain != null && r.observed_rain != null);
  if (valid.length < MIN_SAMPLES) return null;
  const { train, test } = splitByDate(valid);
  if (train.length < MIN_SAMPLES || test.length < 10) return null;

  const trainF = train.map((r) => r.forecast_rain);
  const trainO = train.map((r) => r.observed_rain);
  const threshold = findWetThreshold(trainF, trainO);

  const wetIdx = trainF.map((v, i) => (v > threshold ? i : -1)).filter((i) => i >= 0);
  const trainWetF = wetIdx.map((i) => trainF[i]);
  const trainWetO = wetIdx.map((i) => trainO[i]);

  let intensityMap = null;
  if (trainWetF.length >= MIN_WET_SAMPLES) intensityMap = buildIntensityMap(trainWetF, trainWetO);

  const testF = test.map((r) => r.forecast_rain);
  const testO = test.map((r) => r.observed_rain);
  const testCorrected = testF.map((x) => {
    if (x <= threshold) return 0;
    return intensityMap ? intensityMap(x) : x; // không đủ mẫu ướt -> giữ nguyên dự báo gốc cho phần cường độ
  });

  return {
    n_train: train.length,
    n_test: test.length,
    threshold: Math.round(threshold * 100) / 100,
    mae_before: Math.round(mae(testF, testO) * 100) / 100,
    mae_after: Math.round(mae(testCorrected, testO) * 100) / 100,
    bias_before: Math.round(bias(testF, testO) * 100) / 100,
    bias_after: Math.round(bias(testCorrected, testO) * 100) / 100,
  };
}

async function fetchPairedData(ma_xa) {
  return sql`
    SELECT f.han_du_bao, f.ngay_ap_dung::text AS ngay_ap_dung,
           extract(month from f.ngay_ap_dung)::int AS thang,
           f.mua_mm AS forecast_rain, o.mua_24h_mm AS observed_rain
    FROM du_bao_hang_ngay f
    JOIN thuc_do_hang_ngay o ON o.ma_xa = f.ma_xa AND o.ngay = f.ngay_ap_dung
    WHERE f.ma_xa = ${ma_xa} AND f.han_du_bao BETWEEN 1 AND 7
    ORDER BY f.ngay_ap_dung
  `;
}

async function main() {
  const xaRows = await sql`SELECT ma_xa, ten_xa FROM xa_phuong ORDER BY ma_xa`;
  console.log(`Đang phân tích ${xaRows.length} phường/xã (mưa — 2 bước + theo mùa)...`);

  const results = [];
  for (const xa of xaRows) {
    const rows = await fetchPairedData(xa.ma_xa);
    for (const bucket of LEAD_BUCKETS) {
      for (const season of SEASONS) {
        const subset = rows.filter((r) => bucket.leads.includes(r.han_du_bao) && season.months.includes(r.thang));
        const ev = evaluateTwoStep(subset);
        if (ev) results.push({ ma_xa: xa.ma_xa, ten_xa: xa.ten_xa, bucket: bucket.name, season: season.name, ...ev });
      }
    }
  }

  const csvHeader = 'ma_xa,ten_xa,cum_han_du_bao,mua,so_mau_train,so_mau_test,nguong_kho_uot,mae_truoc,mae_sau,bias_truoc,bias_sau\n';
  const csvBody = results.map((r) => [
    r.ma_xa, `"${r.ten_xa}"`, r.bucket, `"${r.season}"`, r.n_train, r.n_test, r.threshold,
    r.mae_before, r.mae_after, r.bias_before, r.bias_after,
  ].join(',')).join('\n');
  fs.writeFileSync(path.join(BASE_DIR, 'ket-qua-hieu-chinh-mua.csv'), csvHeader + csvBody, 'utf-8');

  console.log('\n========== TỔNG HỢP TRUNG BÌNH TOÀN TỈNH (MƯA) ==========');
  for (const bucket of LEAD_BUCKETS) {
    for (const season of SEASONS) {
      const subset = results.filter((r) => r.bucket === bucket.name && r.season === season.name);
      if (subset.length === 0) { console.log(`${bucket.name} | ${season.name}: không đủ dữ liệu`); continue; }
      const avgBefore = subset.reduce((s, r) => s + r.mae_before, 0) / subset.length;
      const avgAfter = subset.reduce((s, r) => s + r.mae_after, 0) / subset.length;
      const improved = subset.filter((r) => r.mae_after < r.mae_before).length;
      console.log(
        `${bucket.name} | ${season.name}: MAE trung bình ${avgBefore.toFixed(2)} -> ${avgAfter.toFixed(2)}`
        + ` | Cải thiện ở ${improved}/${subset.length} xã`,
      );
    }
  }
  console.log('\nĐã ghi chi tiết vào file: ket-qua-hieu-chinh-mua.csv');
}

main().catch((e) => { console.error('LỖI:', e); process.exit(1); });
