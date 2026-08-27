// scripts/analyze-calibration.mjs
//
// Script CHẠY 1 LẦN THỦ CÔNG — KHÔNG PHẢI hệ thống tự động. Mục đích: kiểm
// chứng xem "hiệu chỉnh phân vị" (quantile mapping) có thực sự cải thiện độ
// chính xác dự báo mưa/nhiệt độ hay không, TRƯỚC KHI đưa vào chạy tự động.
//
// CÁCH LÀM (để tránh "học thuộc lòng" rồi tự khen mình giỏi):
//   - Với mỗi phường/xã: chia dữ liệu theo thời gian — 70% NGÀY ĐẦU dùng để
//     "học" cách hiệu chỉnh (tập train), 30% NGÀY CUỐI dùng để "kiểm tra"
//     (tập test — mô hình CHƯA từng thấy các ngày này).
//   - Tính sai số (MAE = sai số tuyệt đối trung bình, Bias = sai số trung
//     bình có dấu) của dự báo GỐC so với sai số của dự báo ĐÃ HIỆU CHỈNH,
//     cả hai đều đo trên tập test — so sánh công bằng.
//   - Chỉ tính cho han_du_bao 1-7 (nhóm cụm 1-3 và 4-7) vì D+8-15 hiện còn
//     quá ít dữ liệu (mới tích luỹ vài ngày qua cron), chưa đủ tin cậy.
//
// CÁCH CHẠY (đứng ở thư mục quangtri-weather-app):
//   node scripts/analyze-calibration.mjs
//
// Kết quả in ra màn hình + ghi thêm file ket-qua-hieu-chinh.csv để anh mở
// bằng Excel xem chi tiết từng xã.

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

const TRAIN_FRACTION = 0.7;
const MIN_SAMPLES = 30; // dưới mức này không đủ tin cậy để đánh giá

// ============ Hiệu chỉnh phân vị (empirical quantile mapping) ============
// Học từ tập train: với 1 giá trị dự báo mới, tìm đúng "thứ hạng phân vị"
// của nó trong phân phối dự báo TRAIN, rồi tra giá trị thực đo ở ĐÚNG thứ
// hạng phân vị đó trong phân phối thực đo TRAIN.
function buildQuantileMap(trainForecast, trainObserved) {
  const n = trainForecast.length;
  const fSorted = [...trainForecast].sort((a, b) => a - b);
  const oSorted = [...trainObserved].sort((a, b) => a - b);
  return function apply(x) {
    let lo = 0; let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fSorted[mid] <= x) lo = mid + 1; else hi = mid;
    }
    const quantile = lo / n;
    const idx = Math.min(n - 1, Math.max(0, Math.round(quantile * (n - 1))));
    return oSorted[idx];
  };
}

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

// Chia theo NGÀY (không phải theo dòng) để tránh rò rỉ thông tin giữa train/test
function splitByDate(rows) {
  const uniqueDates = [...new Set(rows.map((r) => r.ngay_ap_dung))].sort();
  const splitIdx = Math.floor(uniqueDates.length * TRAIN_FRACTION);
  const trainDates = new Set(uniqueDates.slice(0, splitIdx));
  const train = rows.filter((r) => trainDates.has(r.ngay_ap_dung));
  const test = rows.filter((r) => !trainDates.has(r.ngay_ap_dung));
  return { train, test };
}

function evaluateVariable(rows, forecastKey, observedKey) {
  const valid = rows.filter((r) => r[forecastKey] != null && r[observedKey] != null);
  if (valid.length < MIN_SAMPLES) return null;

  const { train, test } = splitByDate(valid);
  if (train.length < MIN_SAMPLES || test.length < 10) return null;

  const trainF = train.map((r) => r[forecastKey]);
  const trainO = train.map((r) => r[observedKey]);
  const testF = test.map((r) => r[forecastKey]);
  const testO = test.map((r) => r[observedKey]);

  const qmap = buildQuantileMap(trainF, trainO);
  const testCorrected = testF.map(qmap);

  return {
    n_train: train.length,
    n_test: test.length,
    mae_before: Math.round(mae(testF, testO) * 100) / 100,
    mae_after: Math.round(mae(testCorrected, testO) * 100) / 100,
    bias_before: Math.round(bias(testF, testO) * 100) / 100,
    bias_after: Math.round(bias(testCorrected, testO) * 100) / 100,
  };
}

async function fetchPairedData(ma_xa) {
  return sql`
    SELECT f.han_du_bao, f.ngay_ap_dung::text AS ngay_ap_dung,
           f.mua_mm AS forecast_rain, f.nhietdo_max AS forecast_tmax, f.nhietdo_min AS forecast_tmin,
           o.mua_24h_mm AS observed_rain, o.nhietdo_max AS observed_tmax, o.nhietdo_min AS observed_tmin
    FROM du_bao_hang_ngay f
    JOIN thuc_do_hang_ngay o ON o.ma_xa = f.ma_xa AND o.ngay = f.ngay_ap_dung
    WHERE f.ma_xa = ${ma_xa} AND f.han_du_bao BETWEEN 1 AND 7
    ORDER BY f.ngay_ap_dung
  `;
}

async function main() {
  const xaRows = await sql`SELECT ma_xa, ten_xa FROM xa_phuong ORDER BY ma_xa`;
  console.log(`Đang phân tích ${xaRows.length} phường/xã...`);

  const results = [];
  for (const xa of xaRows) {
    const rows = await fetchPairedData(xa.ma_xa);
    for (const bucket of LEAD_BUCKETS) {
      const bucketRows = rows.filter((r) => bucket.leads.includes(r.han_du_bao));
      for (const [label, fKey, oKey] of [
        ['Mưa (mm)', 'forecast_rain', 'observed_rain'],
        ['Nhiệt độ Max (°C)', 'forecast_tmax', 'observed_tmax'],
        ['Nhiệt độ Min (°C)', 'forecast_tmin', 'observed_tmin'],
      ]) {
        const ev = evaluateVariable(bucketRows, fKey, oKey);
        if (ev) {
          results.push({ ma_xa: xa.ma_xa, ten_xa: xa.ten_xa, bucket: bucket.name, bien: label, ...ev });
        }
      }
    }
  }

  // Ghi CSV chi tiết
  const csvHeader = 'ma_xa,ten_xa,cum_han_du_bao,bien,so_mau_train,so_mau_test,mae_truoc,mae_sau,bias_truoc,bias_sau\n';
  const csvBody = results.map((r) => [
    r.ma_xa, `"${r.ten_xa}"`, r.bucket, `"${r.bien}"`, r.n_train, r.n_test,
    r.mae_before, r.mae_after, r.bias_before, r.bias_after,
  ].join(',')).join('\n');
  fs.writeFileSync(path.join(BASE_DIR, 'ket-qua-hieu-chinh.csv'), csvHeader + csvBody, 'utf-8');

  // Tổng hợp trung bình theo cụm hạn + biến (để xem xu hướng chung toàn tỉnh)
  console.log('\n========== TỔNG HỢP TRUNG BÌNH TOÀN TỈNH ==========');
  for (const bucket of LEAD_BUCKETS) {
    for (const label of ['Mưa (mm)', 'Nhiệt độ Max (°C)', 'Nhiệt độ Min (°C)']) {
      const subset = results.filter((r) => r.bucket === bucket.name && r.bien === label);
      if (subset.length === 0) continue;
      const avgMaeBefore = subset.reduce((s, r) => s + r.mae_before, 0) / subset.length;
      const avgMaeAfter = subset.reduce((s, r) => s + r.mae_after, 0) / subset.length;
      const improvedCount = subset.filter((r) => r.mae_after < r.mae_before).length;
      console.log(
        `${bucket.name} | ${label}: MAE trung bình ${avgMaeBefore.toFixed(2)} -> ${avgMaeAfter.toFixed(2)}`
        + ` | Cải thiện ở ${improvedCount}/${subset.length} xã`,
      );
    }
  }
  console.log('\nĐã ghi chi tiết từng xã vào file: ket-qua-hieu-chinh.csv');
}

main().catch((e) => { console.error('LỖI:', e); process.exit(1); });
