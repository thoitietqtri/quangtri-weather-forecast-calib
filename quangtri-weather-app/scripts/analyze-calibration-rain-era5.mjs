// scripts/analyze-calibration-rain-era5.mjs
//
// Script CHẠY 1 LẦN THỦ CÔNG — GIAI ĐOẠN B: kiểm chứng xem kết hợp dự báo
// mưa gốc VỚI các biến khí quyển ERA5 (áp suất min, gió max, độ ẩm TB) qua
// hồi quy tuyến tính đa biến có cải thiện độ chính xác hơn so với chỉ dùng
// riêng dự báo mưa hay không.
//
// Mô hình: observed_rain ~ b0 + b1*forecast_rain + b2*pressure_min + b3*wind_max + b4*humidity_mean
// (Chuẩn hoá z-score các biến trước khi hồi quy để ổn định số học, sau đó
// quy đổi lại hệ số về thang đo gốc.)
//
// Kiểm chứng: chia 70% ngày đầu để "học" (train), 30% ngày cuối để "kiểm
// tra" (test — mô hình chưa từng thấy), so MAE của dự báo GỐC với MAE sau
// khi ĐÃ HỒI QUY, cả 2 đo trên đúng tập test.
//
// CÁCH CHẠY (đứng ở thư mục quangtri-weather-app):
//   node scripts/analyze-calibration-rain-era5.mjs

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
const MIN_SAMPLES = 40; // hồi quy 4 biến cần nhiều mẫu hơn quantile mapping 1 biến

// ============ Hồi quy tuyến tính đa biến (OLS) qua khử Gauss ============
function standardize(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance) || 1; // tránh chia 0 nếu biến không đổi
  return { mean, std, apply: (v) => (v - mean) / std };
}

// Giải hệ (X'X)β = X'y bằng khử Gauss — X đã gồm cột hệ số chặn (toàn số 1).
function solveOLS(X, y) {
  const nFeat = X[0].length;
  const XtX = Array.from({ length: nFeat }, () => new Array(nFeat).fill(0));
  const Xty = new Array(nFeat).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < nFeat; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < nFeat; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  // Khử Gauss có chọn trục (partial pivoting) cho ổn định số học
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  const n = nFeat;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    if (Math.abs(A[col][col]) < 1e-10) continue; // ma trận suy biến -> bỏ qua cột này
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = A[r][col] / A[col][col];
      for (let c = col; c <= n; c++) A[r][c] -= factor * A[col][c];
    }
  }
  return A.map((row, i) => (Math.abs(row[i]) < 1e-10 ? 0 : row[n] / row[i]));
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

function splitByDate(rows) {
  const uniqueDates = [...new Set(rows.map((r) => r.ngay_ap_dung))].sort();
  const splitIdx = Math.floor(uniqueDates.length * TRAIN_FRACTION);
  const trainDates = new Set(uniqueDates.slice(0, splitIdx));
  return {
    train: rows.filter((r) => trainDates.has(r.ngay_ap_dung)),
    test: rows.filter((r) => !trainDates.has(r.ngay_ap_dung)),
  };
}

function evaluateRegression(rows) {
  const valid = rows.filter((r) => [r.forecast_rain, r.observed_rain, r.pressure_min, r.wind_max, r.humidity_mean].every((v) => v != null));
  if (valid.length < MIN_SAMPLES) return null;
  const { train, test } = splitByDate(valid);
  if (train.length < MIN_SAMPLES || test.length < 15) return null;

  const cols = ['forecast_rain', 'pressure_min', 'wind_max', 'humidity_mean'];
  const scalers = cols.map((c) => standardize(train.map((r) => r[c])));

  const buildDesignMatrix = (rows2) => rows2.map((r) => [1, ...cols.map((c, i) => scalers[i].apply(r[c]))]);
  const Xtrain = buildDesignMatrix(train);
  const ytrain = train.map((r) => r.observed_rain);
  const beta = solveOLS(Xtrain, ytrain);

  const Xtest = buildDesignMatrix(test);
  const predicted = Xtest.map((row) => Math.max(0, row.reduce((s, v, i) => s + v * beta[i], 0))); // mưa không âm

  const testForecast = test.map((r) => r.forecast_rain);
  const testObserved = test.map((r) => r.observed_rain);

  return {
    n_train: train.length,
    n_test: test.length,
    mae_before: Math.round(mae(testForecast, testObserved) * 100) / 100,
    mae_after: Math.round(mae(predicted, testObserved) * 100) / 100,
    bias_before: Math.round(bias(testForecast, testObserved) * 100) / 100,
    bias_after: Math.round(bias(predicted, testObserved) * 100) / 100,
  };
}

async function fetchJoinedData(ma_xa) {
  return sql`
    SELECT f.han_du_bao, f.ngay_ap_dung::text AS ngay_ap_dung,
           f.mua_mm AS forecast_rain, o.mua_24h_mm AS observed_rain,
           e.ap_suat_min_hpa AS pressure_min, e.gio_toc_do_max_kmh AS wind_max, e.do_am_tb_pct AS humidity_mean
    FROM du_bao_hang_ngay f
    JOIN thuc_do_hang_ngay o ON o.ma_xa = f.ma_xa AND o.ngay = f.ngay_ap_dung
    JOIN du_lieu_khiquyen_era5 e ON e.ma_xa = f.ma_xa AND e.ngay = f.ngay_ap_dung
    WHERE f.ma_xa = ${ma_xa} AND f.han_du_bao BETWEEN 1 AND 7
    ORDER BY f.ngay_ap_dung
  `;
}

async function main() {
  const xaRows = await sql`SELECT ma_xa, ten_xa FROM xa_phuong ORDER BY ma_xa`;
  console.log(`Đang phân tích ${xaRows.length} phường/xã (mưa + ERA5, hồi quy đa biến)...`);

  const results = [];
  for (const xa of xaRows) {
    const rows = await fetchJoinedData(xa.ma_xa);
    for (const bucket of LEAD_BUCKETS) {
      const bucketRows = rows.filter((r) => bucket.leads.includes(r.han_du_bao));
      const ev = evaluateRegression(bucketRows);
      if (ev) results.push({ ma_xa: xa.ma_xa, ten_xa: xa.ten_xa, bucket: bucket.name, ...ev });
    }
  }

  const csvHeader = 'ma_xa,ten_xa,cum_han_du_bao,so_mau_train,so_mau_test,mae_truoc,mae_sau,bias_truoc,bias_sau\n';
  const csvBody = results.map((r) => [
    r.ma_xa, `"${r.ten_xa}"`, r.bucket, r.n_train, r.n_test, r.mae_before, r.mae_after, r.bias_before, r.bias_after,
  ].join(',')).join('\n');
  fs.writeFileSync(path.join(BASE_DIR, 'ket-qua-hieu-chinh-mua-era5.csv'), csvHeader + csvBody, 'utf-8');

  console.log('\n========== TỔNG HỢP TRUNG BÌNH TOÀN TỈNH (MƯA + ERA5) ==========');
  for (const bucket of LEAD_BUCKETS) {
    const subset = results.filter((r) => r.bucket === bucket.name);
    if (subset.length === 0) { console.log(`${bucket.name}: không đủ dữ liệu`); continue; }
    const avgBefore = subset.reduce((s, r) => s + r.mae_before, 0) / subset.length;
    const avgAfter = subset.reduce((s, r) => s + r.mae_after, 0) / subset.length;
    const improved = subset.filter((r) => r.mae_after < r.mae_before).length;
    console.log(
      `${bucket.name}: MAE trung bình ${avgBefore.toFixed(2)} -> ${avgAfter.toFixed(2)}`
      + ` | Cải thiện ở ${improved}/${subset.length} xã (${subset.length}/78 xã đủ dữ liệu để đánh giá)`,
    );
  }
  console.log('\nĐã ghi chi tiết vào file: ket-qua-hieu-chinh-mua-era5.csv');
}

main().catch((e) => { console.error('LỖI:', e); process.exit(1); });
