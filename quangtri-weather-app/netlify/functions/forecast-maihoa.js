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
// PHƯƠNG ÁN DỰ PHÒNG KHI TÂN LÂM MẤT SỐ LIỆU (22/10/2026): nếu không có số liệu Tân Lâm trong
// ±2h quanh giờ đo mới nhất của Mai Hóa thì BỎ QUA Tân Lâm, dùng công thức MODEL_KHONG_TANLAM
// (chỉ Mai Hóa + Đồng Tâm + mưa lưu vực), thay vì báo lỗi. Cách tính hệ số: xem MODEL_KHONG_TANLAM.

import { neon } from '@neondatabase/serverless';

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 48;
const LEADS = [6, 12, 18, 24];
const NEON_CUTOFF = new Date('2026-01-01T00:00:00Z');
const NGUONG_CHUYEN_DOI_DONGTAM = 5.6; // 80% BĐI Đồng Tâm (7m) — dưới ngưỡng này dùng mô hình triều (Tân Mỹ), từ ngưỡng này trở lên dùng mô hình lũ (bỏ Tân Mỹ)
const TANMY_MUCNUOC = { matram: '555800', ten_table: 'mucnuoc_oday', neonColumn: null }; // trạm cửa biển, đại diện triều — cần Hudson xác nhận đúng matram
const MODEL_NGAY_THUONG = { intercept: -0.6241, tanmy: 0.4856, rain24h: 0.0036, dongtam: 0.2189 };

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

    // ============ NHÁNH NGÀY THƯỜNG (Đồng Tâm dưới ngưỡng 80% BĐI) ============
    // Chỉ dùng triều Tân Mỹ khi mực nước còn thấp — lúc có lũ, sóng lũ phá
    // vỡ hẳn quy luật triều nên KHÔNG dùng Tân Mỹ (theo đúng yêu cầu).
    let tanmyLyDo = null; // vì sao không dùng được mô hình Tân Mỹ (để báo trên khung dự báo)
    if (dongtamNow != null && dongtamNow < NGUONG_CHUYEN_DOI_DONGTAM) {
      const tanmySeries = refNow && refNow < NEON_CUTOFF
        ? await fetchSoLieuLichSu('Tan My', 'mucnuoc', new Date(refNow.getTime() - 60 * 3600000), refNow)
        : await fetchKttvSeries(TANMY_MUCNUOC, '0', refNow);

      // Kiểm tra máy Tân Mỹ có đang hỏng không (đứng yên bất thường) — đo độ
      // lệch chuẩn 48h gần nhất, dưới 0.2m coi như nghi ngờ hỏng, không dùng.
      const tanmyGanDay = tanmySeries.filter((p) => p.t >= current.t - 48 * 3600000 && p.t <= current.t);
      const tanmyValues = tanmyGanDay.map((p) => p.v);
      const tanmyMean = tanmyValues.reduce((a, b) => a + b, 0) / (tanmyValues.length || 1);
      const tanmyStd = tanmyValues.length > 1
        ? Math.sqrt(tanmyValues.reduce((a, b) => a + (b - tanmyMean) ** 2, 0) / tanmyValues.length)
        : 0;
      const tanmyDangHoat = tanmyValues.length >= 10 && tanmyStd >= 0.2;

      const tanmyLag8h = findValueAt(tanmySeries, current.t - 8 * 3600000, 2 * 3600000);

      if (tanmyDangHoat && tanmyLag8h != null) {
        const predicted = MODEL_NGAY_THUONG.intercept + MODEL_NGAY_THUONG.tanmy * tanmyLag8h + MODEL_NGAY_THUONG.rain24h * rainDaQua24h + MODEL_NGAY_THUONG.dongtam * dongtamNow;
        return json({
          available: true,
          cheDo: 'ngay_thuong',
          backtestMode,
          dataSource,
          thoiDiemHienTai: current.t,
          maihoaHienTai: Math.round(current.v * 100) / 100,
          dongtamHienTai: Math.round(dongtamNow * 100) / 100,
          tanmyLag8h: Math.round(tanmyLag8h * 100) / 100,
          rainDaQua24h: Math.round(rainDaQua24h * 10) / 10,
          maihoaDuBao: Math.round(predicted * 100) / 100,
        });
      }
      // Nếu Tân Mỹ hỏng/thiếu số liệu — RƠI XUỐNG dùng mô hình lũ bên dưới
      // như phương án dự phòng (dù đang ở mức thấp, vẫn còn hơn không có gì).
      if (tanmySeries.length === 0) tanmyLyDo = `Tân Mỹ: ${tanmySeries.lyDo || 'không có số liệu'}`;
      else if (tanmyValues.length < 10) tanmyLyDo = `Tân Mỹ chỉ có ${tanmyValues.length} số liệu trong 48 giờ qua (cần ít nhất 10; số liệu mới nhất lúc ${gioVN(tanmySeries[tanmySeries.length - 1].t)})`;
      else if (tanmyStd < 0.2) tanmyLyDo = `Tân Mỹ dao động quá nhỏ trong 48 giờ qua (độ lệch chuẩn ${tanmyStd.toFixed(2)}m, dưới 0.2m — nghi máy đứng hoặc kỳ triều kém)`;
      else tanmyLyDo = `Tân Mỹ thiếu số liệu cách đây 8 giờ (quanh ${gioVN(current.t - 8 * 3600000)})`;
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
      tanmyLyDo,
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
