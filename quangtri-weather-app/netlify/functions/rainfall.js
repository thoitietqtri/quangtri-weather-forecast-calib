// netlify/functions/rainfall.js
//
// Hàm serverless (chạy theo yêu cầu, KHÔNG phải server sống 24/7) — lấy dữ
// liệu mưa thực đo cho toàn tỉnh Quảng Trị:
//   1. Toàn bộ trạm KTTV (API 203.209.181.170) — danh sách KTTV_STATIONS bên
//      dưới, lấy từ file thongtintramkttv.xlsx do anh Hudson cung cấp
//      (21/8/2026). Đã LOẠI BỎ các trạm bảng "vrain_mua" trong file gốc vì
//      đó là bản KTTV mirror lại đúng dữ liệu Vrain đã lấy riêng ở mục 2 —
//      giữ cả hai sẽ bị trùng trạm trên bản đồ.
//   2. Toàn bộ trạm Vrain thuộc tổ chức Quảng Trị — qua API Vrain, cổng
//      https://www.vrain.vn (đăng nhập lấy "sid" rồi gọi API thống kê theo
//      tổ chức), mô phỏng lại đúng logic đã kiểm chứng trong
//      vrain_qtri_script.py (script khai thác Vrain desktop) và trong
//      netlify/functions/rainfall.js của dự án satloluquetkhesanh. Tài
//      khoản đăng nhập lấy từ biến môi trường VRAIN_USERNAME / VRAIN_PASSWORD
//      trên Netlify (Site settings → Environment variables). BẮT BUỘC phải
//      cấu hình — không có giá trị mặc định viết cứng trong code (Netlify
//      secrets scanning sẽ chặn build nếu phát hiện giá trị bí mật thật nằm
//      thẳng trong mã nguồn).
//
// KHÁC với bản bên satloluquetkhesanh: dự án này hiển thị TOÀN TỈNH Quảng
// Trị, nên KHÔNG lọc theo tên trạm huyện Hướng Hoá — giữ lại tất cả trạm mà
// tổ chức (VRAIN_ORG_UUID) trả về.

const WINDOWS = [1, 3, 6, 24, 48, 72];
const HOURS_BACK = Math.max(...WINDOWS) + 3;

// Timeout mỗi request gọi API KTTV — 43 trạm gọi song song, nếu 1 trạm bị
// treo sẽ kéo dài toàn bộ hàm (Netlify Functions mặc định timeout 10s trên
// gói free) nên phải chặn cứng từng request, trạm nào timeout thì bỏ qua.
const KTTV_FETCH_TIMEOUT_MS = 8000;

// Danh sách trạm KTTV toàn tỉnh Quảng Trị (nguồn: thongtintramkttv.xlsx).
// sophut=60 (gộp theo giờ) và tinhtong=1 (API trả tổng dồn theo mốc) áp
// dụng chung cho mọi trạm — đúng quy ước đã kiểm chứng với trạm Khe Sanh.
const KTTV_STATIONS = [
  { matram: 'TDQT_MUA03QT', name: 'Đo Mưa TĐ Đập Tràn - TĐ Quảng Trị', ten_table: 'chuyendung_mua', lat: 16.687985, lng: 106.70367 },
  { matram: 'TDQT_MUA02QT', name: 'Đo Mưa TĐ Hướng Sơn - TĐ Quảng Trị', ten_table: 'chuyendung_mua', lat: 16.76368, lng: 106.6456 },
  { matram: 'TDQT_MUA01QT', name: 'Đo Mưa TĐ Hướng Linh - TĐ Quảng Trị', ten_table: 'chuyendung_mua', lat: 16.68816, lng: 106.7036 },
  { matram: 'AWS0000025', name: 'Khí Tượng TĐ Lệ Thủy', ten_table: 'muakhituong_wb5', lat: 17.2359, lng: 106.8205 },
  { matram: 'ARG0000032', name: 'Đo Mưa TĐ Vĩnh Kim', ten_table: 'mua_wb5', lat: 17.0833, lng: 107.0833 },
  { matram: 'ARG0000030', name: 'Đo Mưa TĐ Việt Trung', ten_table: 'mua_wb5', lat: 17.4833, lng: 106.5166 },
  { matram: '559200', name: 'Thủy Văn TĐ Trường Sơn', ten_table: 'mua_oday_thuyvan', lat: 17.2169, lng: 106.454 },
  { matram: '559100', name: 'Đo Mưa TĐ Minh Hóa', ten_table: 'mua_oday_domua', lat: 17.8086, lng: 105.969 },
  { matram: '559000', name: 'Đo Mưa TĐ Tà Rụt', ten_table: 'mua_oday_domua', lat: 16.391, lng: 106.995 },
  { matram: '557700', name: 'Khí Tượng TĐ Ba Đồn', ten_table: 'mua_oday_khituong', lat: 17.75, lng: 106.417 },
  { matram: '557600', name: 'Thủy Văn TĐ Đồng Hới', ten_table: 'mua_oday_thuyvan', lat: 17.472, lng: 106.626 },
  { matram: '557500', name: 'Khí Tượng TĐ Tuyên Hóa', ten_table: 'mua_oday_khituong', lat: 17.8833, lng: 106.017 },
  { matram: '557400', name: 'Khí Tượng TĐ Cồn Cỏ', ten_table: 'mua_oday_khituong', lat: 17.1667, lng: 107.34 },
  { matram: '557300', name: 'Khí Tượng TĐ Đông Hà', ten_table: 'mua_oday_khituong', lat: 16.85, lng: 107.083 },
  { matram: '557200', name: 'Khí Tượng TĐ Khe Sanh', ten_table: 'mua_oday_khituong', lat: 16.6333, lng: 106.733 },
  { matram: '556100', name: 'Thủy Văn TĐ Lệ Thủy', ten_table: 'mua_oday_khituong', lat: 17.217, lng: 106.783 },
  { matram: '555900', name: 'Thủy Văn TĐ Tân Lâm', ten_table: 'mua_oday_thuyvan', lat: 17.9128, lng: 106.234 },
  { matram: '555800', name: 'Thủy Văn TĐ Tân Mỹ', ten_table: 'mua_oday_thuyvan', lat: 17.7075, lng: 106.482 },
  { matram: '555700', name: 'Thủy Văn TĐ Phong Nha', ten_table: 'mua_oday_thuyvan', lat: 17.615, lng: 106.316 },
  { matram: '555600', name: 'Khí Tượng TĐ Đồng Hới', ten_table: 'mua_oday_khituong', lat: 17.4833, lng: 106.6 },
  { matram: '555500', name: 'Thủy Văn TĐ Kiến Giang', ten_table: 'mua_oday_thuyvan', lat: 17.117, lng: 106.75 },
  { matram: '555400', name: 'Thủy Văn TĐ Mai Hóa', ten_table: 'mua_oday_thuyvan', lat: 17.823, lng: 106.186 },
  { matram: '555300', name: 'Thủy Văn TĐ Đông Tâm', ten_table: 'mua_oday_thuyvan', lat: 17.917, lng: 106 },
  { matram: '555200', name: 'Thủy Văn TĐ Đầu Mầu', ten_table: 'mua_oday_thuyvan', lat: 16.7833, lng: 106.917 },
  { matram: '555100', name: 'Thủy Văn TĐ Mỹ Chánh', ten_table: 'mua_oday_thuyvan', lat: 16.6, lng: 107.267 },
  { matram: '555000', name: 'Thủy Văn TĐ Hiền Lương', ten_table: 'mua_oday_thuyvan', lat: 17.006, lng: 107.055 },
  { matram: '554900', name: 'Thủy Văn TĐ Gia Vòng', ten_table: 'mua_oday_thuyvan', lat: 16.9564, lng: 106.951 },
  { matram: '554800', name: 'Thủy Văn TĐ Cửa Việt', ten_table: 'mua_oday_thuyvan', lat: 16.8883, lng: 107.163 },
  { matram: '554700', name: 'Thủy Văn TĐ Đông hà', ten_table: 'mua_oday_thuyvan', lat: 16.8233, lng: 107.079 },
  { matram: '554600', name: 'Thủy Văn TĐ Thạch Hãn', ten_table: 'mua_oday_thuyvan', lat: 16.7336, lng: 107.153 },
  { matram: '554500', name: 'Thủy Văn TĐ Dakrong', ten_table: 'mua_oday_thuyvan', lat: 16.6575, lng: 106.815 },
  { matram: '091460', name: 'Đo Mưa TĐ Hướng Hiệp', ten_table: 'hanquoc_mua', lat: 16.7615, lng: 106.851 },
  { matram: '091459', name: 'Đo Mưa TĐ Hướng Sơn', ten_table: 'hanquoc_mua', lat: 16.7399, lng: 106.639 },
  { matram: '091458', name: 'Đo Mưa TĐ Vĩnh Ô', ten_table: 'hanquoc_mua', lat: 16.9325, lng: 106.802 },
  { matram: '091457', name: 'Đo Mưa TĐ Tà Rut', ten_table: 'hanquoc_mua', lat: 16.4278, lng: 106.989 },
  { matram: '091456', name: 'Đo Mưa TĐ Ba Lòng', ten_table: 'hanquoc_mua', lat: 16.635, lng: 107.011 },
  { matram: '091406', name: 'Đo Mưa TĐ Phúc Trạch', ten_table: 'hanquoc_mua', lat: 17.6474, lng: 106.265 },
  { matram: '091405', name: 'Đo Mưa TĐ Hương Hóa QB', ten_table: 'hanquoc_mua', lat: 18.0306, lng: 105.857 },
  { matram: '091404', name: 'Đo Mưa TĐ Sen Thủy', ten_table: 'hanquoc_mua', lat: 17.1201, lng: 106.899 },
  { matram: '091403', name: 'Đo Mưa TĐ Quảng Hợp', ten_table: 'hanquoc_mua', lat: 17.9169, lng: 106.342 },
  { matram: '091402', name: 'Đo Mưa TĐ Thượng Hóa', ten_table: 'hanquoc_mua', lat: 17.7133, lng: 105.967 },
  { matram: '091401', name: 'Đo Mưa TĐ Hóa Thanh', ten_table: 'hanquoc_mua', lat: 17.8914, lng: 105.8 },
  { matram: '09003181', name: 'Đo Mưa TĐ Cẩm Ly', ten_table: 'hanquoc_mua', lat: 17.2143, lng: 106.66041 },
];

// ============ CẤU HÌNH VRAIN ============
const VRAIN_BASE = 'https://www.vrain.vn';
const VRAIN_LOGIN_URL = `${VRAIN_BASE}/api/vrain/public/v1/login`;
const VRAIN_DETAILS_URL = `${VRAIN_BASE}/api/kttv/private/v1/organizations/details`;
const VRAIN_ORG_UUID = process.env.VRAIN_ORG_UUID || '74a14178-9fcd-4511-8e18-75e50dd71707';
const VRAIN_USERNAME = process.env.VRAIN_USERNAME;
const VRAIN_PASSWORD = process.env.VRAIN_PASSWORD;
const VRAIN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
// Vrain trả dữ liệu theo mốc 10 phút — lấy đủ số ngày để phủ HOURS_BACK
// (quy theo giờ Việt Nam, cộng dư 1 ngày hai đầu cho chắc múi giờ).
const VRAIN_DAYS_BACK = Math.ceil(HOURS_BACK / 24) + 1;

// Server (Netlify Functions) chạy theo giờ UTC, nhưng API trạm hoạt động
// theo giờ Việt Nam (UTC+7) — PHẢI quy đổi tường minh, nếu không khung thời
// gian gửi lên API sẽ bị lùi 7 tiếng so với thực tế.
function fmtDateTime(d) {
  const vn = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${vn.getUTCFullYear()}-${p(vn.getUTCMonth() + 1)}-${p(vn.getUTCDate())} ${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}:${p(vn.getUTCSeconds())}`;
}

function computeWindows(hourlyMap) {
  const now = new Date();
  const out = {};
  for (const w of WINDOWS) {
    const cutoff = new Date(now.getTime() - w * 3600 * 1000);
    let total = 0;
    for (const [key, mm] of hourlyMap.entries()) {
      const t = new Date(`${key.replace(' ', 'T')}:00:00`);
      if (t >= cutoff) total += mm;
    }
    out[`rain_${w}h`] = Math.round(total * 10) / 10;
  }
  return out;
}

function hourKey(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}`;
}

// Chuỗi ngày YYYY-MM-DD theo giờ Việt Nam (dùng cho tham số from/to của Vrain).
function vnDateStr(d) {
  const vn = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${vn.getUTCFullYear()}-${p(vn.getUTCMonth() + 1)}-${p(vn.getUTCDate())}`;
}

// Lấy giá trị đầu tiên khớp một trong các tên field khả dĩ (không phân biệt
// hoa/thường) — API Vrain không có tài liệu chính thức nên phải dò tên field
// tương tự cách vrain_qtri_script.py dò (findKey/flatten_stats_json).
function pick(obj, candidates) {
  if (!obj || typeof obj !== 'object') return undefined;
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = k;
  for (const c of candidates) {
    const real = lower[c.toLowerCase()];
    if (real !== undefined && obj[real] !== undefined && obj[real] !== null && obj[real] !== '') {
      return obj[real];
    }
  }
  return undefined;
}

function slugifyId(raw) {
  return String(raw)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tram';
}

// Gọi fetch với tự thử lại — chỉ hữu ích cho lỗi mạng thoáng qua (DNS/kết
// nối chập chờn lúc khởi động lạnh), KHÔNG thử lại nếu server đã phản hồi
// (dù là lỗi HTTP 4xx/5xx) vì lúc đó thử lại cũng vô ích.
async function fetchWithRetry(url, options, retries = 2, delayMs = 1500) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// ============ NGUỒN: TOÀN BỘ TRẠM KTTV (API 203.209.181.170) ============

// Lấy dữ liệu giờ cho 1 trạm KTTV bất kỳ (tổng quát hoá từ hàm gốc chỉ dùng
// riêng cho Khe Sanh — nay dùng chung cho cả KTTV_STATIONS).
async function getKttvStationHourly(station) {
  const end = new Date();
  const start = new Date(end.getTime() - HOURS_BACK * 3600 * 1000);
  const url = `http://203.209.181.170:2018/API_TTB/JSON/solieu.php`
    + `?matram=${station.matram}&ten_table=${station.ten_table}&sophut=60`
    + `&tinhtong=1&thoigianbd='${fmtDateTime(start)}'&thoigiankt='${fmtDateTime(end)}'`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KTTV_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('API trả về rỗng');

  const sample = rows[0];
  const sampleKeysLower = Object.keys(sample).reduce((acc, k) => ({ ...acc, [k.toLowerCase()]: k }), {});
  const findKey = (candidates) => {
    for (const c of candidates) {
      if (sampleKeysLower[c.toLowerCase()]) return sampleKeysLower[c.toLowerCase()];
    }
    return null;
  };
  const timeKey = findKey(['thoigian_sl', 'thoigian', 'thoi_gian']) || 'Thoigian_SL';
  const valKey = findKey(['solieu', 'so_lieu', 'luong_mua', 'gia_tri', 'giatri']) || 'Solieu';

  const hourlyMap = new Map();
  let skipped = 0;
  for (const r of rows) {
    const t = new Date(`${String(r[timeKey]).replace(' ', 'T')}+07:00`);
    if (Number.isNaN(t.getTime())) { skipped += 1; continue; }
    const mm = Number(String(r[valKey]).replace(',', '.')) || 0;
    const key = hourKey(t);
    hourlyMap.set(key, (hourlyMap.get(key) || 0) + mm);
  }

  // CHÚ Ý: KHÔNG coi tổng = 0mm là lỗi — trời không mưa trong suốt khung giờ
  // là dữ liệu hợp lệ, rất phổ biến. Chỉ báo lỗi khi thật sự không đọc được
  // dòng nào (API trả rỗng) hoặc không parse được mốc thời gian nào.
  if (hourlyMap.size === 0 || skipped === rows.length) {
    throw new Error(
      `Đọc được ${rows.length} dòng nhưng không parse được mốc thời gian nào `
      + `(timeKey='${timeKey}', valKey='${valKey}')`,
    );
  }
  return hourlyMap;
}

// Gọi song song toàn bộ KTTV_STATIONS — mỗi trạm thất bại độc lập, không
// làm hỏng các trạm khác (Promise.allSettled).
async function getAllKttvStations() {
  const results = await Promise.allSettled(
    KTTV_STATIONS.map((station) => getKttvStationHourly(station)),
  );
  const stations = [];
  const errors = [];
  results.forEach((r, i) => {
    const station = KTTV_STATIONS[i];
    if (r.status === 'fulfilled') {
      stations.push({
        id: `kttv_${slugifyId(station.matram)}`,
        name: station.name,
        ...computeWindows(r.value),
        coords: { lat: station.lat, lng: station.lng },
      });
    } else {
      errors.push(`KTTV ${station.name} (${station.matram}): ${r.reason?.message || r.reason}`);
    }
  });
  return { stations, errors };
}

// Toạ độ dự phòng cho trạm Vrain toàn tỉnh Quảng Trị — API Vrain
// (organizations/details) KHÔNG trả field lat/lng đáng tin cậy, nên phải
// tra theo TÊN trạm (nguồn: file Toado_Muavrain.xlsx do anh Hudson cung cấp,
// 24/8/2026). Vài tên trùng giữa các dòng gốc (vd. "Ba Lòng", "Minh Hóa",
// "Sen Thủy" xuất hiện 2 lần với toạ độ gần giống nhau) — giữ bản ghi cuối.
const VRAIN_FALLBACK_COORDS = {
  'Việt Trung': { lat: 17.483333, lng: 106.516667 },
  'Cẩm Ly': { lat: 17.2, lng: 106.65 },
  'Vĩnh Kim': { lat: 17.0833, lng: 107.0833 },
  'Hóa Thanh': { lat: 17.891389, lng: 105.813333 },
  'Thượng Hóa': { lat: 17.713333, lng: 105.966944 },
  'Quảng Hợp': { lat: 17.92, lng: 106.342222 },
  'Hương Hóa': { lat: 18.030556, lng: 105.856944 },
  'Phúc Trạch': { lat: 17.647434, lng: 106.265446 },
  'Ba Lòng': { lat: 16.63, lng: 107.011278 },
  'Tà Rụt': { lat: 16.427787, lng: 106.988726 },
  'Vĩnh Ô': { lat: 16.932467, lng: 106.80236 },
  'Hướng Sơn': { lat: 16.739938, lng: 106.639282 },
  'Hướng Hiệp': { lat: 16.761485, lng: 106.850961 },
  'Sen Thủy': { lat: 17.120121, lng: 106.898897 },
  'Minh Hóa': { lat: 17.808611, lng: 105.968889 },
  'Hướng Hóa': { lat: 18.048168, lng: 105.912956 },
  'Trường Xuân': { lat: 17.307739, lng: 106.621876 },
  'Sơn Trạch': { lat: 17.611111, lng: 106.305278 },
  'Trường Thủy': { lat: 17.149444, lng: 106.786944 },
  'TTNT. Lệ Ninh': { lat: 17.232163, lng: 106.693077 },
  'Dân Hóa 2': { lat: 17.8025, lng: 105.779722 },
  'A Vao': { lat: 16.389444, lng: 106.949444 },
  'Lâm Thủy': { lat: 17.063855, lng: 106.509122 },
  'Vạn Trạch': { lat: 17.616207, lng: 106.4534 },
  'Cam Chính': { lat: 16.74775, lng: 106.965581 },
  'Tân Long': { lat: 16.597261, lng: 106.654815 },
  'Hướng Linh': { lat: 16.711911, lng: 106.744083 },
  'Ba Nang': { lat: 16.585439, lng: 106.866494 },
  'Linh Thượng': { lat: 16.919769, lng: 106.961779 },
  'Cửa Tùng': { lat: 17.028889, lng: 107.106389 },
  'Triệu Ái': { lat: 16.758044, lng: 107.135221 },
  'Hướng Lộc': { lat: 16.546111, lng: 106.7125 },
  'A Dơi': { lat: 16.481504, lng: 106.744225 },
  'Thủy điện Quảng Trị': { lat: 16.681667, lng: 106.706944 },
  'A Bung': { lat: 16.368303, lng: 107.026057 },
  'Lao Bảo': { lat: 16.615556, lng: 106.598611 },
  'Thanh': { lat: 16.49169, lng: 106.665938 },
  'Hải An': { lat: 16.777313, lng: 107.330052 },
  'Vinh Tú': { lat: 17.112023, lng: 107.010364 },
  'Thủy điện Đakrông 2': { lat: 16.651444, lng: 106.816704 },
  'Hải Thái': { lat: 16.874567, lng: 106.983422 },
  'Vinh Khê': { lat: 17.077392, lng: 106.863583 },
  'Hải Lâm': { lat: 16.691236, lng: 107.241427 },
  'Tà Long': { lat: 16.575033, lng: 106.957696 },
  'Tân Hóa': { lat: 17.788952, lng: 106.094498 },
  'Hướng Phùng': { lat: 16.74214, lng: 106.581653 },
  'Lệ Thủy': { lat: 17.25, lng: 106.8 },
  'Vinh Kim': { lat: 17.083306, lng: 107.083306 },
  'Khe Sanh': { lat: 16.625556, lng: 106.733333 },
  'Cam Thanh': { lat: 16.7837, lng: 106.983 },
  'Hồ Hô': { lat: 18.046328, lng: 105.833538 },
  'Trung Sơn': { lat: 16.962778, lng: 107.040556 },
  'Cam Tuyên': { lat: 16.818889, lng: 106.983611 },
  'Nam Thạch Hãn': { lat: 16.694444, lng: 107.146389 },
  'Hướng Lập': { lat: 16.886691, lng: 106.568597 },
  'Quảng Trạch': { lat: 17.802778, lng: 106.4075 },
  'Quảng Minh': { lat: 17.715716, lng: 106.380848 },
  'Quảng Tiên': { lat: 17.76, lng: 106.321111 },
  'Bắc Trạch': { lat: 17.697859, lng: 106.454657 },
  'Hồ Đồng Ran': { lat: 17.701469, lng: 106.439971 },
  'Lý Hòa': { lat: 17.63275, lng: 106.51605 },
  'Liên Trạch': { lat: 17.67866, lng: 106.3948 },
  'Thác Chuối': { lat: 17.437924, lng: 106.461041 },
  'Xuân Trạch': { lat: 17.663538, lng: 106.252028 },
  'An Mã': { lat: 17.109668, lng: 106.817695 },
  'Thái Thủy': { lat: 17.150278, lng: 106.858889 },
  'Hóa Sơn': { lat: 17.761111, lng: 105.884167 },
  'Trung Hóa': { lat: 17.739167, lng: 105.961667 },
  'Trọng Hóa': { lat: 17.858056, lng: 105.802778 },
  'Quán Hàu': { lat: 17.402222, lng: 106.640278 },
  'Vạn Ninh': { lat: 17.280833, lng: 106.684444 },
  'Trốc Trâu': { lat: 17.400757, lng: 106.587735 },
  'Vực Tròn': { lat: 17.881587, lng: 106.36725 },
  'Sông Thai': { lat: 17.928356, lng: 106.412901 },
  'Ròon': { lat: 17.89313, lng: 106.42433 },
  'Trung Thuần': { lat: 17.818611, lng: 106.343611 },
  'Quảng Tùng': { lat: 17.867778, lng: 106.428333 },
  'Cao Quảng': { lat: 17.76983, lng: 106.18847 },
  'Lâm Hóa': { lat: 17.930833, lng: 105.812778 },
  'Hồ Bụt': { lat: 17.823738, lng: 106.193009 },
  'Thanh Hóa': { lat: 17.983447, lng: 105.84169 },
  'Đá Mài': { lat: 16.82, lng: 106.940833 },
  'Trúc Kinh': { lat: 16.870833, lng: 107.0625 },
  'Thủy điện La Tó': { lat: 16.505556, lng: 107.029444 },
  'Hải Phong': { lat: 16.67319, lng: 107.325761 },
  'Húc': { lat: 16.599167, lng: 106.760556 },
  'Hướng Việt': { lat: 16.829722, lng: 106.564444 },
  'Lìa': { lat: 16.472222, lng: 106.7175 },
  'Triệu Hòa': { lat: 16.802222, lng: 107.191944 },
  'Bến Quan': { lat: 17.022222, lng: 106.903056 },
  'Bảo Đại': { lat: 17.058056, lng: 106.927778 },
  'La Ngà': { lat: 17.025515, lng: 106.95367 },
};

// ============ NGUỒN: TOÀN BỘ TRẠM VRAIN (TỔ CHỨC QUẢNG TRỊ) ============

// Trích cookie "sid" từ header Set-Cookie của response fetch (Node/Netlify).
function extractSidFromResponse(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    for (const raw of res.headers.getSetCookie()) {
      const m = /(?:^|;\s*)sid=([^;]+)/.exec(raw);
      if (m) return decodeURIComponent(m[1]);
    }
  }
  const single = res.headers.get('set-cookie');
  if (single) {
    const m = /(?:^|;\s*)sid=([^;]+)/.exec(single);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

// Đăng nhập Vrain lấy "sid" — tương đương login_async()/sync_login() trong
// vrain_qtri_script.py (POST /api/vrain/public/v1/login).
async function vrainLogin() {
  if (!VRAIN_USERNAME || !VRAIN_PASSWORD) {
    throw new Error('chưa cấu hình VRAIN_USERNAME/VRAIN_PASSWORD (Netlify Environment variables)');
  }
  const res = await fetchWithRetry(VRAIN_LOGIN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: `${VRAIN_BASE}/landing`,
      'user-agent': VRAIN_USER_AGENT,
    },
    body: JSON.stringify({ username: VRAIN_USERNAME, password: VRAIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`đăng nhập lỗi HTTP ${res.status}`);

  const sid = extractSidFromResponse(res);
  if (sid) return sid;

  try {
    const body = await res.json();
    if (typeof body?.sid === 'string') return body.sid;
    if (typeof body?.token === 'string') return body.token;
    if (typeof body?.data?.sid === 'string') return body.data.sid;
    if (typeof body?.data?.token === 'string') return body.data.token;
  } catch { /* body không phải JSON hoặc đã đọc rồi — bỏ qua */ }

  throw new Error('không lấy được sid (kiểm tra VRAIN_USERNAME/VRAIN_PASSWORD)');
}

// Gọi API thống kê theo tổ chức — tương đương API_PATH trong vrain_qtri_script.py
// (GET /api/kttv/private/v1/organizations/details?from=...&to=...&i=_10m).
async function fetchVrainDetails(sid, fromDate, toDate) {
  const url = `${VRAIN_DETAILS_URL}?from=${fromDate}&to=${toDate}&i=_10m`;
  const res = await fetchWithRetry(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `${VRAIN_BASE}/home/54/dashboard`,
      'user-agent': VRAIN_USER_AGENT,
      'x-org-uuid': VRAIN_ORG_UUID,
      'x-vrain-user-agent': VRAIN_USER_AGENT,
      cookie: `sid=${sid}`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Tìm mảng "stats" (mỗi phần tử { timePoint, stations: [...] }) — tương đương
// find_first_list_of_dicts()/flatten_stats_json() trong vrain_qtri_script.py,
// phòng khi Vrain đổi cấu trúc bọc ngoài JSON.
function extractStatsList(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.stats)) return json.stats;
  const queue = [json];
  while (queue.length) {
    const cur = queue.shift();
    if (Array.isArray(cur) && cur.length && cur[0] && typeof cur[0] === 'object'
      && 'timePoint' in cur[0] && 'stations' in cur[0]) {
      return cur;
    }
    if (cur && typeof cur === 'object') {
      for (const v of Object.values(cur)) if (v && typeof v === 'object') queue.push(v);
    }
  }
  return [];
}

// "HH:MM DD/MM" hoặc "HH:MM DD/MM/YYYY" (giờ Việt Nam) → Date tuyệt đối.
function parseVrainTimePoint(timePoint, fallbackYear) {
  const m = /^(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(String(timePoint).trim());
  if (!m) return null;
  const [, hh, mi, dd, mo, yr] = m;
  const p = (n) => String(n).padStart(2, '0');
  const year = yr ? Number(yr) : fallbackYear;
  const d = new Date(`${year}-${p(mo)}-${p(dd)}T${p(hh)}:${mi}:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Trả về Map<stationId, { name, lat, lng, hourly: Map<hourKey, mm> }> — GIỮ
// TẤT CẢ trạm mà tổ chức trả về (không lọc theo huyện, vì đây là web toàn
// tỉnh Quảng Trị, khác với satloluquetkhesanh chỉ lọc riêng Hướng Hoá).
// Toạ độ ưu tiên lấy trực tiếp từ API nếu có, nếu không thì tra theo tên
// trong VRAIN_FALLBACK_COORDS ở trên.
async function getVrainStationsHourly() {
  const sid = await vrainLogin();

  const now = new Date();
  const to = vnDateStr(new Date(now.getTime() + 24 * 3600 * 1000));
  const from = vnDateStr(new Date(now.getTime() - VRAIN_DAYS_BACK * 24 * 3600 * 1000));

  const json = await fetchVrainDetails(sid, from, to);
  const stats = extractStatsList(json);
  if (!stats.length) throw new Error('API trả về rỗng (không thấy "stats")');

  const year = now.getFullYear();
  const byStation = new Map();
  let parsedPoints = 0;

  for (const entry of stats) {
    const t = parseVrainTimePoint(entry.timePoint, year);
    if (!t) continue;
    parsedPoints += 1;
    const hk = hourKey(t);

    for (const st of entry.stations || []) {
      const rawId = pick(st, ['sid', 'id', 'stationId', 'station_id', 'code', 'ma_tram']);
      const name = pick(st, ['name', 'stationName', 'station_name', 'tenTram', 'ten_tram']);
      const id = rawId != null ? String(rawId) : name;
      if (!id) continue;

      const depthRaw = pick(st, ['depth', 'value', 'rain', 'luongMua', 'luong_mua', 'mua', 'giaTri', 'gia_tri']);
      const mm = Number(String(depthRaw ?? 0).replace(',', '.')) || 0;
      const lat = Number(pick(st, ['lat', 'latitude', 'viDo', 'vi_do']));
      const lng = Number(pick(st, ['lng', 'lon', 'long', 'longitude', 'kinhDo', 'kinh_do']));

      if (!byStation.has(id)) {
        const fallback = VRAIN_FALLBACK_COORDS[(name || '').trim()] || null;
        byStation.set(id, {
          name: name || id,
          lat: Number.isFinite(lat) ? lat : (fallback ? fallback.lat : null),
          lng: Number.isFinite(lng) ? lng : (fallback ? fallback.lng : null),
          hourly: new Map(),
        });
      }
      const rec = byStation.get(id);
      rec.hourly.set(hk, (rec.hourly.get(hk) || 0) + mm);
      if (rec.lat === null && Number.isFinite(lat)) rec.lat = lat;
      if (rec.lng === null && Number.isFinite(lng)) rec.lng = lng;
    }
  }

  if (parsedPoints === 0) {
    throw new Error(`không phân tích được mốc thời gian nào (mẫu timePoint: "${stats[0]?.timePoint}")`);
  }
  return byStation;
}

export async function handler() {
  const stations = [];
  const errors = [];

  const kttvResult = await getAllKttvStations();
  stations.push(...kttvResult.stations);
  errors.push(...kttvResult.errors);

  try {
    const vrainStations = await getVrainStationsHourly();
    let keptCount = 0;
    for (const [id, rec] of vrainStations.entries()) {
      // Bỏ qua trạm không có toạ độ — không thể vẽ lên bản đồ.
      if (rec.lat == null || rec.lng == null) continue;
      stations.push({
        id: `vrain_${slugifyId(id)}`,
        name: rec.name,
        ...computeWindows(rec.hourly),
        coords: { lat: rec.lat, lng: rec.lng },
      });
      keptCount += 1;
    }
    if (vrainStations.size === 0) errors.push('Vrain: không có trạm nào trong dữ liệu trả về');
    else if (keptCount === 0) {
      errors.push('Vrain: API trả về dữ liệu nhưng không trạm nào có toạ độ (lat/lng)');
    }
  } catch (e) {
    const causeMsg = e.cause ? ` — nguyên nhân gốc: ${e.cause.code || e.cause.message || e.cause}` : '';
    errors.push(`Vrain: ${e.message}${causeMsg}`);
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ updated_at: new Date().toISOString(), stations, errors }),
  };
}
