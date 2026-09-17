// netlify/functions/forecast-dongtam.js
//
// Dự báo mực nước Đồng Tâm theo ĐÚNG FORMAT BẢN TIN CHÍNH THỨC — trạm đầu
// nguồn, chỉ dùng mưa (thực đo + dự báo ECMWF). Đưa ra 4 mốc cách nhau 6h
// tính từ giờ phát tin (giờ hiện tại), tự nhận diện nếu đạt đỉnh trong 24h
// tới hoặc còn tiếp tục lên.
//
// Phương trình (huấn luyện từ 332 mẫu giờ mùa lũ 2006-2025, Đồng Tâm >=BĐI,
// lấy 1 mẫu/6h để giảm trùng lặp — mỗi mốc 1 phương trình riêng, dùng đúng
// mực nước hiện tại làm điểm neo + mưa đã qua + mưa dự báo tương ứng):
//   +6h:  level = 1.0372 + 0.7746×hiện_tại - 0.0008×mưa_đã_qua_24h + 0.0378×mưa_dự_báo_6h
//   +12h: level = 2.5392 + 0.5068×hiện_tại - 0.0029×mưa_đã_qua_24h + 0.0408×mưa_dự_báo_12h
//   +18h: level = 3.4477 + 0.3602×hiện_tại - 0.0059×mưa_đã_qua_24h + 0.0360×mưa_dự_báo_18h
//   +24h: level = 3.7644 + 0.2977×hiện_tại - 0.0075×mưa_đã_qua_24h + 0.0291×mưa_dự_báo_24h

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 48;
const LEADS = [6, 12, 18, 24];

const RAIN_STATIONS = [
  { matram: '559100', ten_table: 'mua_oday_domua', lat: 17.8086, lng: 105.969 },  // Minh Hóa
  { matram: '557500', ten_table: 'mua_oday_khituong', lat: 17.8833, lng: 106.017 }, // Tuyên Hóa
  { matram: '091402', ten_table: 'hanquoc_mua', lat: 17.7133, lng: 105.967 },      // Thượng Hóa
  { matram: '091401', ten_table: 'hanquoc_mua', lat: 17.8914, lng: 105.8 },        // Hóa Thanh
];

const MODEL_THEO_MOC = {
  6: { intercept: 1.0372, hienTai: 0.7746, daQua: -0.0008, duBao: 0.0378 },
  12: { intercept: 2.5392, hienTai: 0.5068, daQua: -0.0029, duBao: 0.0408 },
  18: { intercept: 3.4477, hienTai: 0.3602, daQua: -0.0059, duBao: 0.0360 },
  24: { intercept: 3.7644, hienTai: 0.2977, daQua: -0.0075, duBao: 0.0291 },
};

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

async function fetchKttvSeries(station) {
  const end = vnNow();
  const start = new Date(end.getTime() - (HOURS_BACK + 1) * 3600 * 1000);
  const url = `${KTTV_BASE_URL}?matram=${station.matram}&ten_table=${station.ten_table}&sophut=60&tinhtong=1`
    + `&thoigianbd='${fmtVN(start)}'&thoigiankt='${fmtVN(end)}'`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const js = await res.json();
    if (!Array.isArray(js) || js.length === 0) return [];
    const sampleKeys = Object.keys(js[0]).reduce((acc, k) => ({ ...acc, [k.toLowerCase()]: k }), {});
    const valKey = sampleKeys['solieu'] || 'Solieu';
    const timeKey = sampleKeys['thoigian_sl'] || 'Thoigian_SL';
    return js
      .map((r) => ({ t: new Date(`${r[timeKey]}Z`.replace(' ', 'T')).getTime() - 7 * 3600 * 1000, v: parseFloat(r[valKey]) }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
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

// Nhận diện đỉnh trong 4 mốc dự báo — so sánh lần lượt hiện_tại,+6,+12,+18,+24.
// Nếu có 1 điểm cao hơn điểm trước VÀ cao hơn/bằng điểm sau -> đỉnh nằm
// trong khoảng [mốc trước, mốc đó]. Nếu +24h vẫn là điểm cao nhất (còn đang
// lên) -> "tiếp tục lên", không có đỉnh xác định trong 24h.
function nhanDienDinh(hienTaiV, duBaoTheoMoc) {
  const diem = [{ h: 0, v: hienTaiV }, ...LEADS.map((h) => ({ h, v: duBaoTheoMoc[h] }))];
  for (let i = 1; i < diem.length - 1; i++) {
    if (diem[i].v >= diem[i - 1].v && diem[i].v >= diem[i + 1].v && diem[i].v > diem[i - 1].v) {
      return { coDinh: true, gioTruoc: diem[i - 1].h, gioDinh: diem[i].h, giaTriDinh: diem[i].v };
    }
  }
  // Kiểm tra riêng mốc cuối (24h) có phải đỉnh không (giảm ngay trước đó nhưng h24 là cao nhất thì không tính là đỉnh thật, chỉ khi nó là điểm CAO NHẤT và có xu hướng đi lên tới đó)
  const max = diem.reduce((a, b) => (b.v > a.v ? b : a));
  if (max.h === 24 && diem[diem.length - 2].v <= max.v) {
    return { coDinh: false, dangTiepTucLen: true };
  }
  return { coDinh: false, dangTiepTucLen: diem[diem.length - 1].v >= diem[diem.length - 2].v };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const heSoParam = parseFloat(url.searchParams.get('hesoHieuChinh'));
    const heSoHieuChinh = Number.isFinite(heSoParam) && heSoParam > 0 ? heSoParam : 1.0;

    const dongtamSeries = await fetchKttvSeries({ matram: '555300', ten_table: 'mucnuoc_oday' });
    if (dongtamSeries.length === 0) {
      return json({ available: false, reason: 'Không lấy được dữ liệu Đồng Tâm' });
    }
    const current = dongtamSeries[dongtamSeries.length - 1];

    const rainSeriesArr = await Promise.all(RAIN_STATIONS.map((s) => fetchKttvSeries(s)));
    const rainByHour = new Map();
    for (const series of rainSeriesArr) {
      for (const p of series) {
        const bucket = Math.floor(p.t / 3600000) * 3600000;
        if (!rainByHour.has(bucket)) rainByHour.set(bucket, []);
        rainByHour.get(bucket).push(p.v);
      }
    }
    const rainDaQua24h = sumRainInWindow(rainByHour, current.t, 24);

    const forecastHourly = await fetchForecastRainHourly();
    if (!forecastHourly) {
      return json({ available: false, reason: 'Không lấy được mưa dự báo ECMWF' });
    }

    const duBaoTheoMoc = {};
    const mucMuaDuBao = {};
    for (const LEAD of LEADS) {
      const rainGoc = sumWindow(forecastHourly, LEAD);
      const rainSauHieuChinh = rainGoc * heSoHieuChinh;
      mucMuaDuBao[LEAD] = { goc: Math.round(rainGoc * 10) / 10, sauHieuChinh: Math.round(rainSauHieuChinh * 10) / 10 };
      const M = MODEL_THEO_MOC[LEAD];
      duBaoTheoMoc[LEAD] = M.intercept + M.hienTai * current.v + M.daQua * rainDaQua24h + M.duBao * rainSauHieuChinh;
    }

    const dinh = nhanDienDinh(current.v, duBaoTheoMoc);

    return json({
      available: true,
      thoiDiemHienTai: current.t,
      dongtamHienTai: Math.round(current.v * 100) / 100,
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
