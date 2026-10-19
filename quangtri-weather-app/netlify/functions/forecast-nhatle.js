// netlify/functions/forecast-nhatle.js
//
// Dự báo mực nước 6/12/18/24h cho Kiến Giang (trạm trên) và Lệ Thủy (trạm dưới) — sông Kiến Giang, lưu vực Nhật Lệ.
// Hồi quy tuyến tính riêng cho từng mốc, huấn luyện từ số liệu giờ 2006-2026 (mực nước) và 2011-2026 (mưa),
// các mẫu mùa lũ (tháng 8-1, mỗi 6h một mẫu, mực nước >= BĐI - 1m với Kiến Giang, >= BĐI - 0.2m với Lệ Thủy).
//   Kiến Giang: y = a + b1*mực_nước + b2*tốc_độ_6h + b3*mưa_đã_qua_24h + b4*mưa_dự_báo_đến_mốc
//   Lệ Thủy:    thêm mực nước và tốc độ 6h của Kiến Giang (nước Kiến Giang về Lệ Thủy sau ~2-4h)
// Mưa vùng thấp = trung bình 2 trạm Kiến Giang + Lệ Thủy (KTTV). Kiến Giang còn dùng mưa trạm Trường Sơn (559200, thượng nguồn phía tây).
// Mưa dự báo = ECMWF IFS (Open-Meteo) x hệ số hiệu chỉnh.
// Chưa đủ lũ (dưới ngưỡng huấn luyện) -> trả cheDo 'ngay_thuong', không dự báo (ngoài vùng hiệu lực của mô hình).

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 48;
const LEADS = [6, 12, 18, 24];

const LEVEL_STATIONS = {
  kiengiang: { matram: '555500', ten_table: 'mucnuoc_oday', nguong: { bd1: 8, bd2: 11, bd3: 13 }, nguongMoHinh: 7.0 },
  lethuy: { matram: '556100', ten_table: 'mucnuoc_oday', nguong: { bd1: 1.2, bd2: 2.2, bd3: 2.7 }, nguongMoHinh: 1.0 },
};
const RAIN_STATIONS = [
  { matram: '555500', ten_table: 'mua_oday_thuyvan', lat: 17.117, lng: 106.75, vung: 'thap' },    // Kiến Giang
  { matram: '556100', ten_table: 'mua_oday_khituong', lat: 17.217, lng: 106.783, vung: 'thap' },  // Lệ Thủy
  { matram: '559200', ten_table: 'mua_oday_thuyvan', lat: 17.2169, lng: 106.454, vung: 'nui' },   // Trường Sơn (thượng nguồn)
];

// Kiến Giang: [hằng số, mực nước, tốc độ 1h, tốc độ 3h, tốc độ 6h, mưa vùng thấp 6h qua, mưa vùng thấp 24h qua, mưa dự báo vùng thấp đến mốc,
//              mưa Trường Sơn 6h, 12h, 24h, 48h qua, mưa dự báo Trường Sơn đến mốc]
// Lệ Thủy: [hằng số, mực nước, tốc độ 6h, mưa vùng thấp 24h qua, mưa dự báo vùng thấp đến mốc, nước Kiến Giang, tốc độ 6h Kiến Giang]
const MODEL = {
  kiengiang: {
    6: [3.503036, 0.504897, 1.45197, -1.270822, 0.012376, 0.002934, -0.000434, 0.017187, 0.005553, -0.001026, -0.000878, 0.00027, 0.008887],
    12: [4.466793, 0.363695, 0.92577, -0.83887, -0.244518, -0.002321, -0.000268, 0.012654, 0.005027, -0.003416, -0.0005, 0.000125, 0.009274],
    18: [4.634859, 0.333352, 0.376685, -0.16165, -0.600401, -0.00348, -0.000409, 0.009119, 0.000881, -0.001075, -0.001631, 0.000169, 0.007898],
    24: [4.976482, 0.278896, 0.536423, -0.601251, -0.050159, -0.002318, -0.000528, 0.006688, 0.001612, -0.001968, -0.001922, 0.000394, 0.006704],
  },
  lethuy: {
    6: [-0.207265, 0.899416, -1.308078, 0.00019, 0.004043, 0.04232, 0.618446],
    12: [-0.241642, 0.827332, -2.146109, 0.000038, 0.005153, 0.053948, 0.479401],
    18: [-0.326262, 0.763948, -2.228759, -0.000164, 0.005212, 0.072033, 0.330118],
    24: [-0.375654, 0.708732, -2.180126, -0.000295, 0.005169, 0.083922, 0.337497],
  },
};

const vnNow = () => new Date(Date.now() + 7 * 3600 * 1000);
const fmtVN = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const r2 = (x) => Math.round(x * 100) / 100;

function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchKttvSeries(station, tinhtong) {
  const end = vnNow();
  const start = new Date(end.getTime() - (HOURS_BACK + 1) * 3600 * 1000);
  const url = `${KTTV_BASE_URL}?matram=${station.matram}&ten_table=${station.ten_table}&sophut=60&tinhtong=${tinhtong}`
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

function findValueAt(series, targetT, toleranceMs = 90 * 60 * 1000) {
  let best = null; let bestDiff = Infinity;
  for (const p of series) {
    const diff = Math.abs(p.t - targetT);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  return best && bestDiff <= toleranceMs ? best.v : null;
}

// Mưa lưu vực theo giờ = trung bình các trạm có số liệu trong giờ đó.
function rainBasinByHour(seriesArr) {
  const byHour = new Map();
  for (const series of seriesArr) {
    for (const p of series) {
      const b = Math.floor(p.t / 3600000) * 3600000;
      if (!byHour.has(b)) byHour.set(b, []);
      byHour.get(b).push(p.v);
    }
  }
  return byHour;
}
function sumRainPast(byHour, endT, hours) {
  let sum = 0;
  for (let h = 0; h < hours; h++) {
    const vals = byHour.get(Math.floor((endT - h * 3600000) / 3600000) * 3600000);
    if (vals && vals.length) sum += vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return sum;
}

// Mưa dự báo ECMWF theo giờ, bắt đầu từ giờ SAU thời điểm số liệu (tính theo nhãn thời gian Open-Meteo, giờ VN).
// Trả {thap:[24 giá trị], nui:[24 giá trị]} — trung bình theo nhóm trạm; thiếu khung giờ thì trả null (không điền số).
async function fetchForecastRainAfter(tObs) {
  const results = await Promise.all(RAIN_STATIONS.map(async (s) => {
    try {
      const url = `${OPENMETEO_FORECAST_URL}?latitude=${s.lat}&longitude=${s.lng}`
        + `&hourly=precipitation&forecast_days=3&timezone=Asia%2FBangkok&models=ecmwf_ifs`;
      const res = await fetchWithTimeout(url, 8000);
      if (!res.ok) return null;
      const js = await res.json();
      if (!js?.hourly?.time || !js?.hourly?.precipitation) return null;
      return { vung: s.vung, hr: js.hourly };
    } catch { return null; }
  }));
  const base = Math.floor(tObs / 3600000) * 3600000 + 7 * 3600 * 1000;
  const out = {};
  for (const vung of ['thap', 'nui']) {
    const grp = results.filter((r) => r && r.vung === vung);
    if (grp.length === 0) return null;
    const arr = [];
    for (let h = 1; h <= 24; h++) {
      const lb = fmtVN(new Date(base + h * 3600000)).slice(0, 13).replace(' ', 'T');
      const vals = grp.map(({ hr }) => { const i = hr.time.findIndex((x) => x.startsWith(lb)); return i >= 0 ? hr.precipitation[i] : null; }).filter((v) => v != null);
      if (vals.length === 0) return null;
      arr.push(vals.reduce((x, y) => x + y, 0) / vals.length);
    }
    out[vung] = arr;
  }
  return out;
}

// Nhận diện đỉnh trong 4 mốc: giống Đồng Tâm / Mai Hóa.
function nhanDienDinh(hienTaiV, duBaoTheoMoc) {
  const diem = [{ h: 0, v: hienTaiV }, ...LEADS.map((h) => ({ h, v: duBaoTheoMoc[h] }))];
  for (let i = 1; i < diem.length - 1; i++) {
    if (diem[i].v >= diem[i - 1].v && diem[i].v >= diem[i + 1].v && diem[i].v > diem[i - 1].v) {
      return { coDinh: true, gioTruoc: diem[i - 1].h, gioDinh: diem[i].h, giaTriDinh: diem[i].v };
    }
  }
  const max = diem.reduce((a, b) => (b.v > a.v ? b : a));
  if (max.h === 24 && diem[diem.length - 2].v <= max.v) return { coDinh: false, dangTiepTucLen: true };
  return { coDinh: false, dangTiepTucLen: diem[diem.length - 1].v >= diem[diem.length - 2].v };
}

const sum = (arr, n) => arr.slice(0, n).reduce((a, b) => a + b, 0);

function duBaoMotTram(key, cur, rate, kg, mua, rainFc, heSo) {
  // mua: { thap: {h6,h24}, nui: {h6,h12,h24,h48} } = mưa đã qua; rainFc = { thap:[24], nui:[24] }
  const M = MODEL[key];
  const duBaoTheoMoc = {};
  for (const L of LEADS) {
    const c = M[L];
    let y;
    if (key === 'kiengiang') {
      y = c[0] + c[1] * cur + c[2] * rate.r1 + c[3] * rate.r3 + c[4] * rate.r6
        + c[5] * mua.thap.h6 + c[6] * mua.thap.h24 + c[7] * sum(rainFc.thap, L) * heSo
        + c[8] * mua.nui.h6 + c[9] * mua.nui.h12 + c[10] * mua.nui.h24 + c[11] * mua.nui.h48 + c[12] * sum(rainFc.nui, L) * heSo;
    } else {
      y = c[0] + c[1] * cur + c[2] * rate.r6 + c[3] * mua.thap.h24 + c[4] * sum(rainFc.thap, L) * heSo + c[5] * kg.v + c[6] * kg.rate6;
    }
    duBaoTheoMoc[L] = r2(y);
  }
  return { duBaoTheoMoc, nhanDinhDinh: nhanDienDinh(cur, duBaoTheoMoc) };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const heSoParam = parseFloat(url.searchParams.get('hesoHieuChinh'));
    const heSoHieuChinh = Number.isFinite(heSoParam) && heSoParam > 0 ? heSoParam : 1.0;

    const [kgSeries, ltSeries, ...rainSeries] = await Promise.all([
      fetchKttvSeries(LEVEL_STATIONS.kiengiang, '0'),
      fetchKttvSeries(LEVEL_STATIONS.lethuy, '0'),
      ...RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1')),
    ]);
    if (kgSeries.length === 0 || ltSeries.length === 0) {
      return json({ available: false, reason: 'Không lấy được mực nước Kiến Giang hoặc Lệ Thủy' });
    }
    const out = { available: true, heSoHieuChinh, tram: {} };
    const rainThap = rainBasinByHour(rainSeries.filter((_, i) => RAIN_STATIONS[i].vung === 'thap'));
    const rainNui = rainBasinByHour(rainSeries.filter((_, i) => RAIN_STATIONS[i].vung === 'nui'));

    const cur = {};
    for (const [key, series] of [['kiengiang', kgSeries], ['lethuy', ltSeries]]) {
      const last = series[series.length - 1];
      const at = (h, tol) => findValueAt(series, last.t - h * 3600000, tol);
      const v1 = at(1, 30 * 60000); const v3 = at(3, 45 * 60000); const v6 = at(6);
      cur[key] = {
        t: last.t, v: last.v,
        r1: v1 != null ? last.v - v1 : 0,
        r3: v3 != null ? (last.v - v3) / 3 : 0,
        r6: v6 != null ? (last.v - v6) / 6 : 0,
      };
    }
    // Kiến Giang tại cùng thời điểm với Lệ Thủy (đầu vào của mô hình Lệ Thủy)
    const kgAtLt = findValueAt(kgSeries, cur.lethuy.t);
    const kgForLt = { v: kgAtLt != null ? kgAtLt : cur.kiengiang.v, rate6: cur.kiengiang.r6 };

    const needForecast = Object.keys(LEVEL_STATIONS).some((k) => cur[k].v >= LEVEL_STATIONS[k].nguongMoHinh);
    let rainFc = null;
    if (needForecast) {
      rainFc = await fetchForecastRainAfter(Math.min(cur.kiengiang.t, cur.lethuy.t));
      if (!rainFc) return json({ available: false, reason: 'Không lấy được mưa dự báo ECMWF' });
    }
    const r1d = (x) => Math.round(x * 10) / 10;
    out.mucMuaDuBao = rainFc ? Object.fromEntries(LEADS.map((L) => [L, {
      vungThap: { goc: r1d(sum(rainFc.thap, L)), sauHieuChinh: r1d(sum(rainFc.thap, L) * heSoHieuChinh) },
      truongSon: { goc: r1d(sum(rainFc.nui, L)), sauHieuChinh: r1d(sum(rainFc.nui, L) * heSoHieuChinh) },
    }])) : null;

    for (const key of ['kiengiang', 'lethuy']) {
      const st = LEVEL_STATIONS[key]; const c = cur[key];
      const mua = {
        thap: { h6: sumRainPast(rainThap, c.t, 6), h24: sumRainPast(rainThap, c.t, 24) },
        nui: { h6: sumRainPast(rainNui, c.t, 6), h12: sumRainPast(rainNui, c.t, 12), h24: sumRainPast(rainNui, c.t, 24), h48: sumRainPast(rainNui, c.t, 48) },
      };
      const base = {
        thoiDiemHienTai: c.t, hienTai: r2(c.v), tocDo6h: Math.round(c.r6 * 1000) / 1000,
        rainDaQua24h: r1d(mua.thap.h24), rainTruongSonDaQua24h: r1d(mua.nui.h24), nguong: st.nguong,
      };
      if (c.v < st.nguongMoHinh) { out.tram[key] = { ...base, cheDo: 'ngay_thuong' }; continue; }
      out.tram[key] = { ...base, cheDo: 'lu', ...duBaoMotTram(key, c.v, c, kgForLt, mua, rainFc, heSoHieuChinh) };
    }
    return json(out);
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
