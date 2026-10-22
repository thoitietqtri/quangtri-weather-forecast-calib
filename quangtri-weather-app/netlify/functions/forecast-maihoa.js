// netlify/functions/forecast-maihoa.js
//
// Dự báo mực nước Mai Hóa theo ĐÚNG FORMAT BẢN TIN CHÍNH THỨC — 4 mốc cách
// nhau 6h tính từ giờ phát tin, tự nhận diện đạt đỉnh trong 24h tới hay
// còn tiếp tục lên. Dùng mực nước hiện tại của CHÍNH Mai Hóa + Đồng Tâm
// (trạm trên) + Tân Lâm (nhánh phụ lưu) làm điểm neo, cộng mưa lưu vực
// (thực đo + dự báo ECMWF).
//
// Phương trình (huấn luyện từ 212 mẫu giờ mùa lũ 2010-2025, Mai Hóa >=BĐI,
// lấy 1 mẫu/6h):
//   +6h:  = -1.3375 + 0.6204×MaiHóa + 0.2636×ĐồngTâm - 0.0143×TânLâm - 0.0011×mưa_đã_qua + 0.0179×mưa_dự_báo_6h
//   +12h: = -1.4981 + 0.4246×MaiHóa + 0.2946×ĐồngTâm - 0.0227×TânLâm - 0.0019×mưa_đã_qua + 0.0224×mưa_dự_báo_12h
//   +18h: = -1.1161 + 0.4004×MaiHóa + 0.2150×ĐồngTâm - 0.0256×TânLâm - 0.0040×mưa_đã_qua + 0.0236×mưa_dự_báo_18h
//   +24h: = -0.7898 + 0.4349×MaiHóa + 0.1336×ĐồngTâm - 0.0255×TânLâm - 0.0059×mưa_đã_qua + 0.0222×mưa_dự_báo_24h
//
// NGÀY THƯỜNG (22/10/2026): khi Mai Hóa < 3m VÀ Đồng Tâm < 5,6m dùng HÀM ĐIỀU HÒA (thủy triều 12 phân triều dựng từ
// chính số liệu Mai Hóa 2020-2025) + hiệu chỉnh theo phần dư thực đo 24 giờ gần nhất + mưa lưu vực, thay cho công thức
// Tân Mỹ cũ (không còn gọi Tân Mỹ). Sai số TB 0,08 / 0,09 / 0,10 / 0,10 m cho +6/+12/+18/+24h (kiểm chứng bỏ-một-năm
// 2020-2025). Từ Đồng Tâm >= 5,6m hoặc Mai Hóa >= 3m: GIỮ NGUYÊN công thức lũ bên dưới. Tính lại hệ số mỗi năm một lần:
// tinh-he-so-dieu-hoa.py (đi kèm gói maihoa-dieu-hoa, không nằm trong repo).
//
// PHƯƠNG ÁN DỰ PHÒNG KHI TÂN LÂM MẤT SỐ LIỆU (22/10/2026): nếu không có số liệu Tân Lâm trong
// ±2h quanh giờ đo mới nhất của Mai Hóa thì BỎ QUA Tân Lâm, dùng công thức MODEL_KHONG_TANLAM
// (chỉ Mai Hóa + Đồng Tâm + mưa lưu vực), thay vì báo lỗi. Cách tính hệ số: xem MODEL_KHONG_TANLAM.

import { neon } from '@neondatabase/serverless';

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 48;
const LEADS = [6, 12, 18, 24];
const NEON_CUTOFF = new Date('2026-01-01T00:00:00Z');
const NGUONG_CHUYEN_DOI_DONGTAM = 5.6; // 80% BĐI Đồng Tâm (7m) — dưới ngưỡng này (và Mai Hóa < 3m) là "ngày thường" dùng hàm điều hòa, từ ngưỡng này trở lên dùng công thức lũ

const DONGTAM = { matram: '555300', ten_table: 'mucnuoc_oday', neonColumn: 'dongtam_m' };
const MAIHOA = { matram: '555400', ten_table: 'mucnuoc_oday', neonColumn: 'maihoa_m' };
const TANLAM_MUCNUOC = { matram: '555900', ten_table: 'mucnuoc_oday' };

const RAIN_STATIONS = [
  { matram: '559100', ten_table: 'mua_oday_domua', lat: 17.8086, lng: 105.969, neonColumn: 'minh_hoa_mm' },
  { matram: '557500', ten_table: 'mua_oday_khituong', lat: 17.8833, lng: 106.017, neonColumn: 'tuyen_hoa_mm' },
  { matram: '091402', ten_table: 'hanquoc_mua', lat: 17.7133, lng: 105.967, neonColumn: 'thuong_hoa_mm' },
  { matram: '091401', ten_table: 'hanquoc_mua', lat: 17.8914, lng: 105.8, neonColumn: 'hoa_thanh_mm' },
];

const MODEL_THEO_MOC = {
  6: { intercept: -1.3375, maihoa: 0.6204, dongtam: 0.2636, tanlam: -0.0143, daQua: -0.0011, duBao: 0.0179 },
  12: { intercept: -1.4981, maihoa: 0.4246, dongtam: 0.2946, tanlam: -0.0227, daQua: -0.0019, duBao: 0.0224 },
  18: { intercept: -1.1161, maihoa: 0.4004, dongtam: 0.2150, tanlam: -0.0256, daQua: -0.0040, duBao: 0.0236 },
  24: { intercept: -0.7898, maihoa: 0.4349, dongtam: 0.1336, tanlam: -0.0255, daQua: -0.0059, duBao: 0.0222 },
};

// ===== CÔNG THỨC DỰ PHÒNG — KHÔNG DÙNG TÂN LÂM =====
// Học lại bằng bình phương tối thiểu từ CHÍNH 212 mẫu của công thức trên (mẫu 6h: giờ 5/11/17/23,
// Mai Hóa >= 3m, tháng 9-12, 2010-2025; mưa dự báo = mưa thật sau mốc), bỏ biến Tân Lâm, thêm một
// hệ số "thời đại": từ 2019 mực nước Mai Hóa ứng với cùng Đồng Tâm thấp hơn khoảng 0,4-0,6m so với
// trước đó, nên hằng số dưới đây là hằng số của thời đại hiện tại (đã cộng hệ số thời đại).
// Kiểm chứng chéo theo năm (loại từng năm): sai số tuyệt đối TB 0,50 / 0,76 / 0,79 / 0,68 m cho
// +6 / +12 / +18 / +24h, đạt ±1m: 91,5% / 70,3% / 67,5% / 78,8% — sai số TB ngang công thức có Tân Lâm
// khi học lại và kiểm chứng cùng cách (có Tân Lâm: 0,51 / 0,79 / 0,81 / 0,68 m).
// Lưu ý: số liệu lịch sử Tân Lâm đứng yên ở 7,65m suốt 2014-2018 (và lệch gốc 2011-2012) nên hệ số Tân Lâm
// của công thức cũ mang dấu ÂM (vô lý về vật lý); học riêng từ 2019 thì dương.
// Tính lại hệ số: script tinh-he-so-khong-tanlam.py (đi kèm gói maihoa-khong-tanlam, không nằm trong repo).
const MODEL_KHONG_TANLAM = {
  6: { intercept: -1.6181, maihoa: 0.5464, dongtam: 0.2811, daQua: -0.0005, duBao: 0.0202 },
  12: { intercept: -1.9553, maihoa: 0.3324, dongtam: 0.3109, daQua: -0.0009, duBao: 0.0236 },
  18: { intercept: -1.5974, maihoa: 0.3273, dongtam: 0.2214, daQua: -0.0030, duBao: 0.0244 },
  24: { intercept: -1.2711, maihoa: 0.3788, dongtam: 0.1374, daQua: -0.0050, duBao: 0.0227 },
};
// ===== HÀM ĐIỀU HÒA CHO NGÀY THƯỜNG =====
// Hằng số + hệ số học trên các giờ ngày thường 2020-2025 (biên độ triều Mai Hóa đã tăng ~30% so với 2006-2016 nên không dùng số liệu cũ hơn).
// Sinh từ tinh-he-so-dieu-hoa.py (file he-so-dieu-hoa.json). Gốc thời gian: 00h 01/01/2000 giờ VN.
// Hai tầng: day_du (cần đủ số liệu giờ 0/3/6/12/24 trước giờ phát tin) và rut_gon (khi thiếu giờ giữa chừng).
const PHAN_TRIEU = [
  { ten: 'Q1', w: 13.3986609, a: 0.06802891436810404, b: 0.01985657291307313 },
  { ten: 'O1', w: 13.9430356, a: 0.07399096868511468, b: -0.31813044429643883 },
  { ten: 'P1', w: 14.9589314, a: -0.04639301008281349, b: 0.06623659571908577 },
  { ten: 'K1', w: 15.0410686, a: -0.06720371657753184, b: 0.2265481331982655 },
  { ten: 'N2', w: 28.4397295, a: 0.048392893974178376, b: -0.005119041767292436 },
  { ten: 'M2', w: 28.9841042, a: -0.06697767282588282, b: -0.2863666429427042 },
  { ten: 'S2', w: 30.0, a: -0.016512990203918686, b: 0.07583417285634597 },
  { ten: 'K2', w: 30.0821373, a: -0.000411021516062175, b: -0.04628758323788101 },
  { ten: 'M4', w: 57.9682084, a: 0.00846346247121594, b: 0.0014701794151035586 },
  { ten: 'MS4', w: 58.9841042, a: -0.004652101012601827, b: -0.0027420063364692803 },
  { ten: 'MN4', w: 57.4238337, a: -0.0008426910131179852, b: 0.003321027225796119 },
  { ten: 'M6', w: 86.9523127, a: -0.002829007614767266, b: -0.0035863013739837303 },
];
const HE_SO_DIEU_HOA = {
  day_du: {
    6: { intercept: -0.0005753864735957922, Hf: 1.00145984095027, zt: 2.3355480354406724, r0: 0.3822647258848818, r3: -0.3828677799487883, r6: -0.24526752652976871, r12: -0.7216669410378286, r24: -0.4754429311003271, daqua: 0.0011675114106928966, dubao: 0.007661335823043595 },
    12: { intercept: -0.01035633655988716, Hf: 0.9975113259479379, zt: 0.43401777829932553, r0: 0.40546264951587546, r3: 0.04024479469765096, r6: -0.21871213440650522, r12: 0.5098497240194791, r24: -0.3002347533377654, daqua: 0.0012313649933156105, dubao: 0.009781897345327296 },
    18: { intercept: -0.021173208585714375, Hf: 0.9980523757717232, zt: 0.19661597346706794, r0: 0.2812146295800619, r3: -0.3092160203988817, r6: 0.8079118520076977, r12: 0.004174873535453628, r24: -0.1361929709741574, daqua: 0.000724799893083695, dubao: 0.011334139007556138 },
    24: { intercept: -0.028804290671803814, Hf: 0.994375330203141, zt: 0.026799646567285087, r0: 0.6685814389363985, r3: 0.2853386032773879, r6: -0.04412036127125828, r12: 0.01577000690667878, r24: -0.08724241937996938, daqua: -0.0009753785431653093, dubao: 0.011465509383706175 },
  },
  rut_gon: {
    6: { intercept: -0.0019410013887348955, Hf: 0.9981279060574285, zt: 0.7522196831402717, r0: 0.10844657122331934, daqua: 0.0017768162694136902, dubao: 0.00863066450915621 },
    12: { intercept: -0.011906604290598742, Hf: 0.9962765226988665, zt: 0.537308106356508, r0: 0.31178010044103366, daqua: 0.0017394742527061908, dubao: 0.009900197279474323 },
    18: { intercept: -0.02179498587045939, Hf: 0.9967999961917624, zt: 0.7885492489355264, r0: 0.0014407699971915164, daqua: 0.0016038968391811975, dubao: 0.011649521474991468 },
    24: { intercept: -0.029208147816067294, Hf: 0.9944081001156744, zt: 0.08928378384094215, r0: 0.7598813859983236, daqua: -0.0006859045034758117, dubao: 0.011512934412836576 },
  },
};
const T0_DIEU_HOA_MS = Date.UTC(2000, 0, 1) - 7 * 3600000; // 00h 01/01/2000 giờ VN, tính bằng ms UTC thật
const RAD = Math.PI / 180;
const NGUONG_LECH_TRIEU_RMS = 0.5; // m: nếu 24 giờ qua lệch khỏi triều điều hòa hơn mức này thì không dùng (có thể đang lũ/nước dâng hoặc sai mốc giờ số liệu)
const NGUONG_MUA_VANG_MM = 30; // mưa dự báo 24h (đã hiệu chỉnh) từ mức này: sai số hàm điều hòa tăng (khoảng 0,3 đến 0,5 m)
const NGUONG_MUA_DO_MM = 100; // từ mức này: nguy cơ lũ lên (khoảng 1/3 đến 1/2 trường hợp Mai Hóa vượt 3m trong 24h), hàm điều hòa thường hụt thấp
const BDI_MAIHOA_M = 3; // Báo động I Mai Hóa — công thức lũ chỉ được xây từ các giờ Mai Hóa >= mức này

function vnNow() {
  return new Date(Date.now() + 7 * 3600 * 1000);
}
function fmtVN(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Gắn lý do vào mảng rỗng (mảng vẫn dùng bình thường) để thông báo đúng vì sao thiếu số liệu.
function coTrangThai(arr, lyDo) {
  arr.lyDo = lyDo;
  return arr;
}
// "HHh dd/MM" theo giờ VN, từ mốc thời gian UTC (ms) — cùng kiểu hiển thị với khung dự báo.
function gioVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}
function moTaSoLieu(ten, series) {
  if (!series || series.length === 0) return `${ten}: ${(series && series.lyDo) || 'không có số liệu'}`;
  const cuoi = series[series.length - 1];
  return `${ten}: số liệu mới nhất lúc ${gioVN(cuoi.t)} (${Math.round(cuoi.v * 100) / 100}m)`;
}

let sqlClient = null;
function getSql() {
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}
function parseNeonTimestamp(raw) {
  if (raw instanceof Date) return raw.getTime() - 7 * 3600 * 1000;
  return new Date(`${raw}Z`.replace(' ', 'T')).getTime() - 7 * 3600 * 1000;
}

async function fetchKttvSeries(station, tinhtong = '1', refNow = null) {
  const end = refNow || vnNow();
  const start = new Date(end.getTime() - (HOURS_BACK + 1) * 3600 * 1000);
  const url = `${KTTV_BASE_URL}?matram=${station.matram}&ten_table=${station.ten_table}&sophut=60&tinhtong=${tinhtong}`
    + `&thoigianbd='${fmtVN(start)}'&thoigiankt='${fmtVN(end)}'`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return coTrangThai([], `máy chủ KTTV trả lỗi ${res.status}`);
    const js = await res.json();
    if (!Array.isArray(js) || js.length === 0) return coTrangThai([], 'KTTV không có số liệu trong 48 giờ qua');
    const sampleKeys = Object.keys(js[0]).reduce((acc, k) => ({ ...acc, [k.toLowerCase()]: k }), {});
    const valKey = sampleKeys['solieu'] || 'Solieu';
    const timeKey = sampleKeys['thoigian_sl'] || 'Thoigian_SL';
    const ketQua = js
      .map((r) => ({ t: new Date(`${r[timeKey]}Z`.replace(' ', 'T')).getTime() - 7 * 3600 * 1000, v: parseFloat(r[valKey]) }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => a.t - b.t);
    return ketQua.length === 0 ? coTrangThai(ketQua, 'KTTV trả về số liệu rỗng') : ketQua;
  } catch (e) {
    return coTrangThai([], e && e.name === 'AbortError' ? 'máy chủ KTTV không trả lời kịp (quá 8 giây)' : 'không kết nối được máy chủ KTTV');
  }
}

async function fetchNeonSeries(neonColumn, start, end) {
  try {
    const sql = getSql();
    const rows = await sql(
      `SELECT thoi_gian, ${neonColumn} AS v FROM lichsu_maihoa WHERE thoi_gian >= $1 AND thoi_gian <= $2 AND ${neonColumn} IS NOT NULL ORDER BY thoi_gian`,
      [fmtVN(start), fmtVN(end)],
    );
    return rows
      .map((r) => ({ t: parseNeonTimestamp(r.thoi_gian), v: Number(r.v) }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => a.t - b.t);
  } catch (e) {
    console.error(`[Neon] Lỗi đọc cột ${neonColumn}:`, e.message);
    return [];
  }
}

async function fetchSoLieuLichSu(tram, loai, start, end) {
  try {
    const sql = getSql();
    const rows = await sql(
      `SELECT thoi_gian, gia_tri AS v FROM so_lieu_lichsu WHERE tram = $1 AND loai = $2 AND thoi_gian >= $3 AND thoi_gian <= $4 ORDER BY thoi_gian`,
      [tram, loai, fmtVN(start), fmtVN(end)],
    );
    return rows
      .map((r) => ({ t: parseNeonTimestamp(r.thoi_gian), v: Number(r.v) }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => a.t - b.t);
  } catch (e) {
    console.error(`[Neon] Lỗi đọc so_lieu_lichsu (${tram}/${loai}):`, e.message);
    return [];
  }
}

async function fetchSeriesSmart(station, tinhtong, refNow) {
  const end = refNow || vnNow();
  if (refNow && refNow < NEON_CUTOFF && station.neonColumn) {
    const start = new Date(end.getTime() - (HOURS_BACK + 1) * 3600 * 1000);
    return fetchNeonSeries(station.neonColumn, start, end);
  }
  return fetchKttvSeries(station, tinhtong, refNow);
}

async function fetchTanLamMucNuocSmart(refNow) {
  const end = refNow || vnNow();
  if (refNow && refNow < NEON_CUTOFF) {
    const start = new Date(end.getTime() - (HOURS_BACK + 1) * 3600 * 1000);
    return fetchSoLieuLichSu('Tan Lam', 'mucnuoc', start, end);
  }
  return fetchKttvSeries(TANLAM_MUCNUOC, '0', refNow);
}

function findValueAt(series, targetT, toleranceMs = 90 * 60 * 1000) {
  let best = null; let bestDiff = Infinity;
  for (const p of series) {
    const diff = Math.abs(p.t - targetT);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  return best && bestDiff <= toleranceMs ? best.v : null;
}

function sumRainInWindow(rainByHour, endT, hours) {
  let sum = 0;
  for (let h = 0; h < hours; h++) {
    const bucket = Math.floor((endT - h * 3600000) / 3600000) * 3600000;
    const vals = rainByHour.get(bucket);
    if (vals && vals.length > 0) sum += vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return sum;
}

async function fetchForecastRainHourly() {
  const results = await Promise.all(RAIN_STATIONS.map(async (s) => {
    try {
      const url = `${OPENMETEO_FORECAST_URL}?latitude=${s.lat}&longitude=${s.lng}`
        + `&hourly=precipitation&forecast_days=2&timezone=Asia%2FBangkok&models=ecmwf_ifs`;
      const res = await fetchWithTimeout(url, 8000);
      if (!res.ok) return null;
      const js = await res.json();
      return js?.hourly?.precipitation || null;
    } catch {
      return null;
    }
  }));
  const valid = results.filter(Boolean);
  if (valid.length === 0) return null;
  const hoursCount = Math.min(...valid.map((v) => v.length));
  const avgHourly = [];
  for (let h = 0; h < hoursCount; h++) {
    avgHourly.push(valid.reduce((a, v) => a + (v[h] || 0), 0) / valid.length);
  }
  return avgHourly;
}

function sumWindow(arr, hours) {
  if (!arr) return null;
  return arr.slice(0, hours).reduce((a, b) => a + b, 0);
}

// Mưa "dự báo" khi kiểm nghiệm quá khứ — dùng đúng mưa thật xảy ra SAU mốc
// asof (giả lập dự báo hoàn hảo, đúng kỹ thuật đã dùng để huấn luyện).
async function fetchRainRangeSmart(station, start, end) {
  if (end < NEON_CUTOFF && station.neonColumn) {
    return fetchNeonSeries(station.neonColumn, start, end);
  }
  const full = await fetchKttvSeries(station, '1', end);
  return full.filter((p) => p.t >= start.getTime() && p.t <= end.getTime());
}

function nhanDienDinh(hienTaiV, duBaoTheoMoc) {
  const diem = [{ h: 0, v: hienTaiV }, ...LEADS.map((h) => ({ h, v: duBaoTheoMoc[h] }))];
  for (let i = 1; i < diem.length - 1; i++) {
    if (diem[i].v >= diem[i - 1].v && diem[i].v >= diem[i + 1].v && diem[i].v > diem[i - 1].v) {
      return { coDinh: true, gioTruoc: diem[i - 1].h, gioDinh: diem[i].h, giaTriDinh: diem[i].v };
    }
  }
  const max = diem.reduce((a, b) => (b.v > a.v ? b : a));
  if (max.h === 24 && diem[diem.length - 2].v <= max.v) {
    return { coDinh: false, dangTiepTucLen: true };
  }
  return { coDinh: false, dangTiepTucLen: diem[diem.length - 1].v >= diem[diem.length - 2].v };
}

// ===================== HÀM ĐIỀU HÒA (NGÀY THƯỜNG) =====================
// (f, u[rad]) hiệu chỉnh nút (Schureman rút gọn) của phân triều `ten` tại h = số giờ kể từ T0_DIEU_HOA_MS
function heSoNut(h, ten) {
  const d = (h - 19) / 24;
  const N = (125.0445479 - 0.0529539222 * d) * RAD;
  const c1 = Math.cos(N); const c2 = Math.cos(2 * N); const c3 = Math.cos(3 * N);
  const s1 = Math.sin(N); const s2 = Math.sin(2 * N); const s3 = Math.sin(3 * N);
  const m2 = () => [1.0004 - 0.0373 * c1 + 0.0002 * c2, -2.14 * s1 * RAD];
  switch (ten) {
    case 'M2': case 'N2': case 'MS4': return m2();
    case 'O1': case 'Q1': return [1.0089 + 0.1871 * c1 - 0.0147 * c2 + 0.0014 * c3, (10.80 * s1 - 1.34 * s2 + 0.19 * s3) * RAD];
    case 'K1': return [1.0060 + 0.1150 * c1 - 0.0088 * c2 + 0.0006 * c3, (-8.86 * s1 + 0.68 * s2 - 0.07 * s3) * RAD];
    case 'K2': return [1.0241 + 0.2863 * c1 + 0.0083 * c2 - 0.0015 * c3, (-17.74 * s1 + 0.68 * s2 - 0.04 * s3) * RAD];
    case 'M4': case 'MN4': { const [f, u] = m2(); return [f * f, 2 * u]; }
    case 'M6': { const [f, u] = m2(); return [f * f * f, 3 * u]; }
    default: return [1, 0]; // S2, P1
  }
}

// Thủy triều điều hòa tại Mai Hóa (m, quanh mực nền) tại thời điểm tMs (ms UTC thật)
function trieuDieuHoa(tMs) {
  const h = (tMs - T0_DIEU_HOA_MS) / 3600000;
  let tong = 0;
  for (const c of PHAN_TRIEU) {
    const [f, u] = heSoNut(h, c.ten);
    const x = c.w * RAD * h + u;
    tong += f * (c.a * Math.cos(x) + c.b * Math.sin(x));
  }
  return tong;
}

// Sóng mưa dự báo ECMWF CÓ NHÃN GIỜ (Open-Meteo: chuỗi giờ bắt đầu từ 00h hôm nay, nhãn T = mưa của giờ trước T).
// Chỉ nhánh hàm điều hòa dùng; nhánh lũ cũ vẫn dùng fetchForecastRainHourly/sumWindow như trước.
async function fetchForecastRainTimed() {
  const results = await Promise.all(RAIN_STATIONS.map(async (s) => {
    try {
      const url = `${OPENMETEO_FORECAST_URL}?latitude=${s.lat}&longitude=${s.lng}`
        + `&hourly=precipitation&forecast_days=2&timezone=Asia%2FBangkok&models=ecmwf_ifs`;
      const res = await fetchWithTimeout(url, 8000);
      if (!res.ok) return null;
      const js = await res.json();
      const time = js?.hourly?.time; const pr = js?.hourly?.precipitation;
      if (!Array.isArray(time) || !Array.isArray(pr) || time.length === 0) return null;
      return { time, pr };
    } catch {
      return null;
    }
  }));
  const valid = results.filter(Boolean);
  if (valid.length === 0) return null;
  const goc = valid[0].time[0];
  const dongBo = valid.filter((v) => v.time[0] === goc); // cùng trục thời gian
  const n = Math.min(...dongBo.map((v) => v.pr.length));
  const values = [];
  for (let i = 0; i < n; i++) values.push(dongBo.reduce((a, v) => a + (v.pr[i] || 0), 0) / dongBo.length);
  const gio0 = Math.round((Date.parse(`${goc}:00Z`) - 7 * 3600000) / 3600000); // chỉ số giờ (UTC thật) của phần tử đầu
  return { gio0, values };
}

// Mưa thực đo trong khoảng [tBd, tKt] (ms UTC thật) cho 1 trạm — dùng khi kiểm nghiệm quá khứ (mưa "dự báo hoàn hảo").
async function fetchMuaKhoang(station, tBd, tKt) {
  const nhanKt = new Date(tKt + 7 * 3600000); // nhãn giờ VN (dạng "UTC giả") để hỏi DB/API
  if (nhanKt < NEON_CUTOFF && station.neonColumn) {
    return fetchNeonSeries(station.neonColumn, new Date(tBd + 7 * 3600000), nhanKt);
  }
  const full = await fetchKttvSeries(station, '1', nhanKt);
  return full.filter((p) => p.t >= tBd && p.t <= tKt);
}

// Dự báo ngày thường bằng hàm điều hòa. Trả { ok:true, ... } hoặc { ok:false, lyDo } (khi đó nhánh lũ làm phương án dự phòng).
async function duBaoDieuHoa({ maihoaSeries, current, rainDaQua24h, backtestMode, heSoHieuChinh }) {
  const Tc = Math.round(current.t / 3600000); // chỉ số giờ phát tin
  const mh = new Map();
  const lech = new Map();
  for (const p of maihoaSeries) {
    const k = Math.round(p.t / 3600000);
    const d = Math.abs(p.t - k * 3600000);
    if (!lech.has(k) || d < lech.get(k)) { mh.set(k, p.v); lech.set(k, d); }
  }
  const phanDu = (lag) => {
    const v = mh.get(Tc - lag);
    return v == null ? null : v - trieuDieuHoa((Tc - lag) * 3600000);
  };
  const r0 = phanDu(0);
  if (r0 == null) return { ok: false, lyDo: `Mai Hóa chưa có số liệu đúng giờ ${gioVN(Tc * 3600000)} để hiệu chỉnh theo triều` };
  const cuaSo = [];
  for (let k = 0; k < 24; k++) { const r = phanDu(k); if (r != null) cuaSo.push(r); }
  if (cuaSo.length < 12) return { ok: false, lyDo: `Mai Hóa chỉ có ${cuaSo.length}/24 số liệu giờ trong 24 giờ qua (cần ít nhất 12)` };
  const zt = cuaSo.reduce((a, b) => a + b, 0) / cuaSo.length;
  const doLech = Math.sqrt(cuaSo.reduce((a, b) => a + (b - zt) ** 2, 0) / cuaSo.length);
  if (doLech >= NGUONG_LECH_TRIEU_RMS) {
    return { ok: false, lyDo: `Mai Hóa lệch khỏi quy luật triều quá nhiều trong 24 giờ qua (độ lệch ${doLech.toFixed(2)}m, từ ${NGUONG_LECH_TRIEU_RMS}m trở lên): có thể đang có lũ hoặc nước dâng, hoặc mốc giờ số liệu bị lệch` };
  }
  const r3 = phanDu(3); const r6 = phanDu(6); const r12 = phanDu(12); const r24 = phanDu(24);
  const dayDu = [r3, r6, r12, r24].every((v) => v != null);
  const tang = dayDu ? 'day_du' : 'rut_gon';

  // mưa dự báo trong từng hạn (mm, đã nhân hệ số hiệu chỉnh khi chạy thật)
  const mucMuaDuBao = {};
  let thieuMuaDuBao = false;
  const muaTheoHan = {};
  if (!backtestMode) {
    const fc = await fetchForecastRainTimed();
    for (const L of LEADS) {
      let tong = 0; let du = fc != null;
      for (let j = 1; j <= L && du; j++) {
        const v = fc.values[Tc + j - fc.gio0];
        if (v == null || !Number.isFinite(v)) du = false; else tong += v;
      }
      if (du) {
        muaTheoHan[L] = tong * heSoHieuChinh;
        mucMuaDuBao[L] = { goc: Math.round(tong * 10) / 10, sauHieuChinh: Math.round(tong * heSoHieuChinh * 10) / 10 };
      } else {
        thieuMuaDuBao = true; muaTheoHan[L] = 0; mucMuaDuBao[L] = { goc: null, sauHieuChinh: null };
      }
    }
  } else {
    const arr = await Promise.all(RAIN_STATIONS.map((s) => fetchMuaKhoang(s, Tc * 3600000 + 1, (Tc + 24) * 3600000)));
    const theoGio = new Map();
    for (const series of arr) {
      for (const p of series) {
        const b = Math.floor(p.t / 3600000) * 3600000;
        if (!theoGio.has(b)) theoGio.set(b, []);
        theoGio.get(b).push(p.v);
      }
    }
    for (const L of LEADS) {
      const that = sumRainInWindow(theoGio, (Tc + L) * 3600000, L); // mưa thật t+1..t+L (dự báo hoàn hảo)
      muaTheoHan[L] = that;
      mucMuaDuBao[L] = { goc: Math.round(that * 10) / 10, sauHieuChinh: Math.round(that * 10) / 10 };
    }
  }

  const duBaoRaw = {};
  const phanDuMoc = [r0];
  for (const L of LEADS) {
    const c = HE_SO_DIEU_HOA[tang][L];
    const Hf = trieuDieuHoa((Tc + L) * 3600000);
    let y = c.intercept + c.Hf * Hf + c.zt * zt + c.r0 * r0 + c.daqua * rainDaQua24h + c.dubao * muaTheoHan[L];
    if (dayDu) y += c.r3 * r3 + c.r6 * r6 + c.r12 * r12 + c.r24 * r24;
    duBaoRaw[L] = y;
    phanDuMoc.push(y - Hf);
  }
  // đường triều từng giờ: triều điều hòa + phần hiệu chỉnh nội suy tuyến tính giữa các mốc 0/6/12/18/24h
  const mocGio = [0, ...LEADS];
  const duongTrieu = [];
  for (let k = 0; k <= 24; k++) {
    let i = 0;
    while (i < mocGio.length - 2 && k > mocGio[i + 1]) i++;
    const w = (k - mocGio[i]) / (mocGio[i + 1] - mocGio[i]);
    const hc = phanDuMoc[i] + w * (phanDuMoc[i + 1] - phanDuMoc[i]);
    duongTrieu.push({ h: k, v: trieuDieuHoa((Tc + k) * 3600000) + hc });
  }
  let cao = 1; let thap = 1;
  for (let k = 2; k <= 24; k++) {
    if (duongTrieu[k].v > duongTrieu[cao].v) cao = k;
    if (duongTrieu[k].v < duongTrieu[thap].v) thap = k;
  }
  const lamTron = (v) => Math.round(v * 100) / 100;
  const diem = (k) => ({ gio: k, t: (Tc + k) * 3600000, v: lamTron(duongTrieu[k].v) });

  const mua24 = mucMuaDuBao[24].sauHieuChinh;
  const canhBaoMua = mua24 == null ? null : (mua24 >= NGUONG_MUA_DO_MM ? 'do' : (mua24 >= NGUONG_MUA_VANG_MM ? 'vang' : null));
  return {
    ok: true,
    gioHienTai: Tc * 3600000,
    tang,
    doLechTrieu: lamTron(doLech),
    duBaoTheoMoc: Object.fromEntries(LEADS.map((h) => [h, lamTron(duBaoRaw[h])])),
    duongTrieu: duongTrieu.map((p) => ({ h: p.h, v: lamTron(p.v) })),
    trieuCao: diem(cao),
    trieuThap: diem(thap),
    mucMuaDuBao,
    thieuMuaDuBao,
    canhBaoMua,
  };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const asofParam = url.searchParams.get('asof');
    let refNow = null;
    let backtestMode = false;
    if (asofParam) {
      const parsed = new Date(asofParam.trim().replace(' ', 'T') + 'Z');
      if (!Number.isNaN(parsed.getTime())) { refNow = parsed; backtestMode = true; }
    }
    const heSoParam = parseFloat(url.searchParams.get('hesoHieuChinh'));
    const heSoHieuChinh = Number.isFinite(heSoParam) && heSoParam > 0 ? heSoParam : 1.0;
    const epKhongTanLam = url.searchParams.get('khongTanLam') === '1'; // chỉ để thử/so sánh: ép dùng công thức không Tân Lâm
    const dataSource = backtestMode ? (refNow < NEON_CUTOFF ? 'Neon (lịch sử 2006-2025)' : 'API KTTV sống') : 'API KTTV sống';

    const [dongtamSeries, maihoaSeries, tanlamSeries] = await Promise.all([
      fetchSeriesSmart(DONGTAM, '0', refNow),
      fetchSeriesSmart(MAIHOA, '0', refNow),
      fetchTanLamMucNuocSmart(refNow),
    ]);
    if (maihoaSeries.length === 0) {
      return json({ available: false, reason: `Không lấy được dữ liệu Mai Hóa (${maihoaSeries.lyDo || 'không có số liệu'})`, backtestMode });
    }
    const current = maihoaSeries[maihoaSeries.length - 1];
    const dongtamNow = findValueAt(dongtamSeries, current.t, 2 * 3600000);

    // Mưa lưu vực đã qua 24h — dùng chung cho cả 2 nhánh (ngày thường/lũ)
    const rainSeriesArr = await Promise.all(RAIN_STATIONS.map((s) => fetchSeriesSmart(s, '1', refNow)));
    const rainByHour = new Map();
    for (const series of rainSeriesArr) {
      for (const p of series) {
        const bucket = Math.floor(p.t / 3600000) * 3600000;
        if (!rainByHour.has(bucket)) rainByHour.set(bucket, []);
        rainByHour.get(bucket).push(p.v);
      }
    }
    const rainDaQua24h = sumRainInWindow(rainByHour, current.t, 24);

    // ============ NHÁNH NGÀY THƯỜNG: HÀM ĐIỀU HÒA (Mai Hóa < 3m và Đồng Tâm < 5,6m) ============
    // Khi có lũ, sóng lũ phá vỡ quy luật triều nên KHÔNG dùng hàm điều hòa: từ Đồng Tâm >= 5,6m hoặc Mai Hóa >= 3m
    // chạy tiếp công thức lũ bên dưới (giữ nguyên). Hàm điều hòa không cần Đồng Tâm (chỉ dùng để xác định ngày thường),
    // nên thiếu Đồng Tâm vẫn chạy được (có báo trên khung).
    let dieuHoaLyDo = null; // vì sao không dùng được hàm điều hòa (để báo trên khung dự báo)
    const maiHoaThap = current.v < BDI_MAIHOA_M;
    if (maiHoaThap && (dongtamNow == null || dongtamNow < NGUONG_CHUYEN_DOI_DONGTAM)) {
      const dh = await duBaoDieuHoa({ maihoaSeries, current, rainDaQua24h, backtestMode, heSoHieuChinh });
      if (dh.ok) {
        return json({
          available: true,
          cheDo: 'dieu_hoa',
          backtestMode,
          dataSource,
          asof: asofParam || null,
          thoiDiemHienTai: dh.gioHienTai,
          maihoaHienTai: Math.round(current.v * 100) / 100,
          dongtamHienTai: dongtamNow != null ? Math.round(dongtamNow * 100) / 100 : null,
          thieuDongTam: dongtamNow == null,
          tang: dh.tang,
          doLechTrieu: dh.doLechTrieu,
          rainDaQua24h: Math.round(rainDaQua24h * 10) / 10,
          heSoHieuChinh,
          mucMuaDuBao: dh.mucMuaDuBao,
          thieuMuaDuBao: dh.thieuMuaDuBao,
          canhBaoMua: dh.canhBaoMua,
          duBaoTheoMoc: dh.duBaoTheoMoc,
          duongTrieu: dh.duongTrieu,
          trieuCao: dh.trieuCao,
          trieuThap: dh.trieuThap,
        });
      }
      dieuHoaLyDo = dh.lyDo; // rơi xuống công thức lũ làm phương án dự phòng (thường hụt thấp khi Mai Hóa < 3m)
    } else if (maiHoaThap) {
      dieuHoaLyDo = `Đồng Tâm đang ${(Math.round(dongtamNow * 100) / 100)}m, từ ${NGUONG_CHUYEN_DOI_DONGTAM}m trở lên là chế độ lũ`;
    }
    // ============ HẾT NHÁNH NGÀY THƯỜNG — TỪ ĐÂY LÀ MÔ HÌNH LŨ (CŨ) ============

    // Đồng Tâm là trạm trên chính của Mai Hóa — thiếu thì không dự báo được (báo rõ lý do).
    if (dongtamNow == null) {
      return json({
        available: false,
        reason: `Thiếu số liệu Đồng Tâm quanh giờ đo mới nhất của Mai Hóa (${gioVN(current.t)}). ${moTaSoLieu('Đồng Tâm', dongtamSeries)}.`,
        backtestMode,
      });
    }
    // Tân Lâm mất số liệu (không có giá trị trong ±2h quanh giờ đo Mai Hóa) -> BỎ QUA Tân Lâm,
    // dùng công thức dự phòng MODEL_KHONG_TANLAM (chỉ Mai Hóa + Đồng Tâm + mưa), không báo lỗi nữa.
    const tanlamNow = findValueAt(tanlamSeries, current.t, 2 * 3600000);
    const khongDungTanLam = tanlamNow == null || epKhongTanLam;

    const tinhMoc = (LEAD, mucMua) => {
      const M = khongDungTanLam ? MODEL_KHONG_TANLAM[LEAD] : MODEL_THEO_MOC[LEAD];
      const phanTanLam = khongDungTanLam ? 0 : M.tanlam * tanlamNow;
      return M.intercept + M.maihoa * current.v + M.dongtam * dongtamNow + phanTanLam + M.daQua * rainDaQua24h + M.duBao * mucMua;
    };

    const duBaoTheoMoc = {};
    const mucMuaDuBao = {};
    if (!backtestMode) {
      const forecastHourly = await fetchForecastRainHourly();
      for (const LEAD of LEADS) {
        const rainGoc = sumWindow(forecastHourly, LEAD);
        const rainSauHieuChinh = rainGoc != null ? rainGoc * heSoHieuChinh : null;
        mucMuaDuBao[LEAD] = { goc: rainGoc != null ? Math.round(rainGoc * 10) / 10 : null, sauHieuChinh: rainSauHieuChinh != null ? Math.round(rainSauHieuChinh * 10) / 10 : null };
        duBaoTheoMoc[LEAD] = tinhMoc(LEAD, rainSauHieuChinh || 0);
      }
    } else {
      for (const LEAD of LEADS) {
        const startF = new Date(current.t);
        const endF = new Date(current.t + LEAD * 3600000);
        const rainFArr = await Promise.all(RAIN_STATIONS.map((s) => fetchRainRangeSmart(s, startF, endF)));
        const rainFByHour = new Map();
        for (const series of rainFArr) {
          for (const p of series) {
            const bucket = Math.floor(p.t / 3600000) * 3600000;
            if (!rainFByHour.has(bucket)) rainFByHour.set(bucket, []);
            rainFByHour.get(bucket).push(p.v);
          }
        }
        const rainThat = sumRainInWindow(rainFByHour, endF.getTime(), LEAD);
        mucMuaDuBao[LEAD] = { goc: Math.round(rainThat * 10) / 10, sauHieuChinh: Math.round(rainThat * 10) / 10 };
        duBaoTheoMoc[LEAD] = tinhMoc(LEAD, rainThat);
      }
    }

    const dinh = nhanDienDinh(current.v, duBaoTheoMoc);

    return json({
      available: true,
      backtestMode,
      dataSource,
      asof: asofParam || null,
      thoiDiemHienTai: current.t,
      maihoaHienTai: Math.round(current.v * 100) / 100,
      dongtamHienTai: Math.round(dongtamNow * 100) / 100,
      tanlamHienTai: tanlamNow != null ? Math.round(tanlamNow * 100) / 100 : null,
      khongDungTanLam,
      // số liệu Tân Lâm cuối cùng còn lấy được (kể cả cũ) và lý do thiếu — để khung hiển thị báo cho người xem
      tanlamMoiNhat: tanlamSeries.length > 0
        ? { t: tanlamSeries[tanlamSeries.length - 1].t, v: Math.round(tanlamSeries[tanlamSeries.length - 1].v * 100) / 100 }
        : null,
      tanlamLyDo: tanlamNow == null ? (tanlamSeries.lyDo || 'không có số liệu quanh giờ đo Mai Hóa') : null,
      // Mai Hóa dưới BĐ I: công thức lũ ngoài vùng xây dựng, kết quả thường thấp hơn thực tế
      mucNuocThap: current.v < BDI_MAIHOA_M,
      dieuHoaLyDo,
      rainDaQua24h: Math.round(rainDaQua24h * 10) / 10,
      heSoHieuChinh,
      mucMuaDuBao,
      duBaoTheoMoc: Object.fromEntries(LEADS.map((h) => [h, Math.round(duBaoTheoMoc[h] * 100) / 100])),
      nhanDinhDinh: dinh,
    });
  } catch (e) {
    return json({ available: false, reason: `Lỗi: ${e.message}` });
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
