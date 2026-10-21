// netlify/functions/forecast-thachhan.js
//
// Dự báo mực nước 6/12/18/24h cho Đakrông (trạm thượng nguồn) và Thạch Hãn (trạm dưới) — lưu vực sông Thạch Hãn.
// Hồi quy tuyến tính riêng cho từng mốc, huấn luyện từ số liệu giờ: mực nước 2013-2026, mưa 2011-2026.
//   Thạch Hãn (lũ: Thạch Hãn >= 1.0 m hoặc Đakrông >= 26 m): y = a + mực nước + tốc độ 3h/6h + mực nước Đakrông (trễ truyền ~8-9h) + tốc độ + mưa đã qua 6/24/48h + mưa dự báo đến mốc
//   Thạch Hãn (ngày thường, chịu triều): hồi quy điều hòa triều (M2, S2, K1, O1 tại thời điểm dự báo) + mực nước hiện tại + Đakrông + Cửa Việt (554800)
//   Đakrông (lũ >= 25 m / ngày thường): mực nước, tốc độ, mưa Đakrông và mưa Tà Rụt (đã qua, dự báo) — mỗi trạm một hệ số riêng
// Mưa: Đakrông, Thạch Hãn (gộp trung bình) và Tà Rụt (hệ số riêng) — KTTV.
// Mưa dự báo = ECMWF IFS (Open-Meteo) x hệ số hiệu chỉnh.
// Kiểm nghiệm bỏ-từng-năm (mưa dự báo hoàn hảo): Thạch Hãn lũ đạt sai số cho phép 98/97.9/94.7/93.6% (6/12/18/24h); đỉnh ~78% (sai số cho phép 83cm).

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 60;
const LEADS = [6, 12, 18, 24];

const LEVEL_STATIONS = {
  dakrong: { matram: '554500', ten_table: 'mucnuoc_oday', nguong: { bd1: 29.5, bd2: 31.5, bd3: 33.5 }, nguongMoHinh: 25.0 },
  thachhan: { matram: '554600', ten_table: 'mucnuoc_oday', nguong: { bd1: 3, bd2: 4.5, bd3: 6 }, nguongMoHinh: 1.0 },
};
const CUAVIET = { matram: '554800', ten_table: 'mucnuoc_oday' };
const RAIN_STATIONS = [
  { matram: '554500', ten_table: 'mua_oday_thuyvan', lat: 16.6575, lng: 106.815, key: 'dk' },   // Đakrông
  { matram: '554600', ten_table: 'mua_oday_thuyvan', lat: 16.7336, lng: 107.153, key: 'th' },   // Thạch Hãn
  { matram: '559000', ten_table: 'mua_oday_domua', lat: 16.391, lng: 106.995, key: 'ta' },      // Tà Rụt
];

// Thạch Hãn lũ: [hằng số, th, tốc độ 3h, tốc độ 6h, dk, dk tốc độ 3h, dk tốc độ 6h, mưa lưu vực 6h qua,
//   mưa TB(Đakrông,Thạch Hãn) 24h qua, mưa Tà Rụt 24h qua, mưa lưu vực 48h qua, mưa dự báo TB(Đakrông,Thạch Hãn) đến mốc, mưa dự báo Tà Rụt đến mốc]
const MODEL_TH = {
  6: [-7.52337, 0.687789, 0.996035, -0.898062, 0.299889, -0.297723, 0.0868345, 0.00875459, 2.52737e-05, -7.77539e-05, -0.000537066, 0.00393133, 0.000445666],
  12: [-6.34848, 0.582334, 0.706578, 0.148232, 0.257462, -0.0463623, 0.252003, 0.016823, -0.00213594, 0.00023483, -0.000793823, 0.00704982, 0.00313438],
  18: [-7.6596, 0.423448, 0.881449, -1.562, 0.311828, -0.0738609, -0.22272, 0.0186186, -0.00179898, 0.000182901, -0.00200388, 0.00743397, 0.00627701],
  24: [-5.20675, 0.409862, 0.17042, 0.384751, 0.218529, 0.0743442, -0.0363955, 0.0118221, -0.00205609, -0.000865664, -0.00207595, 0.00737168, 0.00790168],
};
// Thạch Hãn ngày thường: [hằng số, sin/cos M2, S2, K1, O1 (8 số), th, tốc độ 6h, dk, cửa việt]
const MODEL_TH_NT = {
  6: [-1.03848, 0.183045, -0.0244332, 0.0334901, 0.0279339, 0.07984, -0.0258401, 0.171144, -0.134408, 0.494149, -3.32966, 0.0450012, 0.463658],
  12: [-1.03468, 0.0792754, -0.0639704, 0.0251674, 0.00769857, 0.0821321, -0.0611015, 0.149335, -0.215312, 0.746671, -0.642182, 0.0439285, 0.147583],
  18: [-0.964895, 0.116354, -0.0414139, 0.0192549, 0.0223042, 0.00877853, -0.0306425, -0.0326458, -0.115037, 0.522693, -4.30137, 0.0421325, 0.516223],
  24: [-0.558668, 0.0193314, -0.126352, 0.00975442, -0.00417239, -0.00311696, 0.000339247, -0.0560905, -0.041434, 0.776625, -0.288709, 0.0246227, 0.309605],
};
// Đakrông lũ: [hằng số, dk, tốc độ 3h, tốc độ 6h, mưa (Đakrông+Tà Rụt) 6h qua, mưa Đakrông 24h qua, mưa Tà Rụt 24h qua, mưa (Đakrông+Tà Rụt) 48h qua,
//   mưa dự báo Đakrông đến mốc, mưa dự báo Tà Rụt đến mốc]
const MODEL_DK = {
  6: [6.8164, 0.728679, 0.458241, -1.77432, 0.0225223, -0.00446086, -0.00154274, 0.000366014, 0.0152142, 0.0136463],
  12: [9.1394, 0.63591, 0.272079, -1.9042, 0.0103373, -0.00363621, -0.00341138, -1.879e-05, 0.0105362, 0.0194503],
  18: [9.68531, 0.613492, 0.223223, -1.66729, 0.000428506, -0.00288901, -0.00431288, -0.000296394, 0.0070487, 0.0181063],
  24: [10.3519, 0.586581, 0.341927, -1.55026, -0.00491111, -0.00274383, -0.00466947, -0.000325699, 0.00484038, 0.016001],
};
const MODEL_DK_NT = {
  6: [6.83914, 0.71594, -0.310599, -1.98652, 0.00978485, 0.000664291, 0.00208092, -0.000475364, 0.00832818, 0.00239453],
  12: [7.18157, 0.701012, -0.307574, -1.52739, 0.00777788, 0.000435963, 0.00336154, -0.00141717, 0.00999065, 0.0064046],
  18: [3.81646, 0.840114, -0.240628, -3.96189, 0.00890292, -0.000183755, 0.00322216, -0.00288953, 0.00872793, 0.00778049],
  24: [3.94228, 0.834864, -0.232685, -0.462873, 0.00750967, -0.000962858, 0.00115183, -0.0024517, 0.00713024, 0.00859773],
};
// Pha gốc của các thành phần triều (giờ VN, 00:00 01/01/2013) và chu kỳ (giờ)
const T0_VN = Date.UTC(2013, 0, 1, 0, 0, 0);
const TIDE_PERIODS = [12.4206, 12.0, 23.9345, 25.8193];

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
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function tideTerms(tMs) {
  const h = (tMs + 7 * 3600 * 1000 - T0_VN) / 3600000;
  const out = [];
  for (const p of TIDE_PERIODS) out.push(Math.sin((2 * Math.PI * h) / p), Math.cos((2 * Math.PI * h) / p));
  return out;
}
const dot = (c, x) => c.reduce((a, b, i) => a + b * x[i], 0);

// cur: { dk:{t,v,r3,r6}, th:{...}, cv:{v} }; mua: đã qua {R:{h6,h24,h48}, Rdk:{...}}; fc: {R:[24], Rdk:[24]}
function duBaoThachHan(cur, mua, fc, heSo) {
  const lu = cur.th.v >= LEVEL_STATIONS.thachhan.nguongMoHinh || cur.dk.v >= 26.0;
  const out = {};
  for (const L of LEADS) {
    let y;
    if (lu) {
      const x = [1, cur.th.v, cur.th.r3, cur.th.r6, cur.dk.v, cur.dk.r3, cur.dk.r6, mua.R.h6, mua.Rm.h24, mua.ta.h24, mua.R.h48, sum(fc.Rm, L) * heSo, sum(fc.ta, L) * heSo];
      y = dot(MODEL_TH[L], x);
    } else {
      const x = [1, ...tideTerms(cur.th.t + L * 3600000), cur.th.v, cur.th.r6, cur.dk.v, cur.cv.v];
      y = dot(MODEL_TH_NT[L], x);
    }
    out[L] = r2(y);
  }
  return { duBaoTheoMoc: out, cheDo: lu ? 'lu' : 'ngay_thuong', nhanDinhDinh: nhanDienDinh(cur.th.v, out) };
}

function duBaoDakrong(cur, mua, fc, heSo) {
  const lu = cur.dk.v >= LEVEL_STATIONS.dakrong.nguongMoHinh;
  const M = lu ? MODEL_DK : MODEL_DK_NT;
  const out = {};
  for (const L of LEADS) {
    const x = [1, cur.dk.v, cur.dk.r3, cur.dk.r6, mua.Rdk.h6, mua.dk.h24, mua.ta.h24, mua.Rdk.h48, sum(fc.dk, L) * heSo, sum(fc.ta, L) * heSo];
    out[L] = r2(dot(M[L], x));
  }
  return { duBaoTheoMoc: out, cheDo: lu ? 'lu' : 'ngay_thuong', nhanDinhDinh: nhanDienDinh(cur.dk.v, out) };
}

// Mưa dự báo ECMWF theo giờ, từ giờ SAU thời điểm số liệu (giờ VN theo nhãn Open-Meteo); thiếu khung giờ -> null.
async function fetchForecastRainAfter(tObs) {
  const results = await Promise.all(RAIN_STATIONS.map(async (s) => {
    try {
      const url = `${OPENMETEO_FORECAST_URL}?latitude=${s.lat}&longitude=${s.lng}`
        + `&hourly=precipitation&forecast_days=3&timezone=Asia%2FBangkok&models=ecmwf_ifs`;
      const res = await fetchWithTimeout(url, 8000);
      if (!res.ok) return null;
      const js = await res.json();
      if (!js?.hourly?.time || !js?.hourly?.precipitation) return null;
      return { key: s.key, hr: js.hourly };
    } catch { return null; }
  }));
  if (results.some((r) => !r)) return null;
  const base = Math.floor(tObs / 3600000) * 3600000 + 7 * 3600 * 1000;
  const per = {};
  for (const { key, hr } of results) {
    const arr = [];
    for (let h = 1; h <= 24; h++) {
      const lb = fmtVN(new Date(base + h * 3600000)).slice(0, 13).replace(' ', 'T');
      const i = hr.time.findIndex((x) => x.startsWith(lb));
      if (i < 0 || hr.precipitation[i] == null) return null;
      arr.push(hr.precipitation[i]);
    }
    per[key] = arr;
  }
  const comb = (keys) => Array.from({ length: 24 }, (_, i) => mean(keys.map((k) => per[k][i])));
  return { R: comb(['dk', 'th', 'ta']), Rm: comb(['dk', 'th']), Rdk: comb(['dk', 'ta']), dk: per.dk, th: per.th, ta: per.ta };
}

function pastRain(seriesByKey, keys, endT, hours) {
  const byHour = rainBasinByHour(keys.map((k) => seriesByKey[k]));
  return sumRainPast(byHour, endT, hours);
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const heSoParam = parseFloat(url.searchParams.get('hesoHieuChinh'));
    const heSoHieuChinh = Number.isFinite(heSoParam) && heSoParam > 0 ? heSoParam : 1.0;

    const [dkSeries, thSeries, cvSeries, ...rainSeries] = await Promise.all([
      fetchKttvSeries(LEVEL_STATIONS.dakrong, '0'),
      fetchKttvSeries(LEVEL_STATIONS.thachhan, '0'),
      fetchKttvSeries(CUAVIET, '0'),
      ...RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1')),
    ]);
    if (dkSeries.length === 0 || thSeries.length === 0) {
      return json({ available: false, reason: 'Không lấy được mực nước Đakrông hoặc Thạch Hãn' });
    }
    const rainBy = Object.fromEntries(RAIN_STATIONS.map((s, i) => [s.key, rainSeries[i]]));

    const cur = {};
    for (const [key, series] of [['dk', dkSeries], ['th', thSeries]]) {
      const last = series[series.length - 1];
      const at = (h, tol) => findValueAt(series, last.t - h * 3600000, tol);
      const v3 = at(3, 45 * 60000); const v6 = at(6);
      cur[key] = { t: last.t, v: last.v, r3: v3 != null ? (last.v - v3) / 3 : 0, r6: v6 != null ? (last.v - v6) / 6 : 0 };
    }
    // Cửa Việt tại cùng thời điểm với Thạch Hãn (dùng cho ngày thường); thiếu thì lấy 0 (ảnh hưởng nhỏ)
    const cvAt = findValueAt(cvSeries, cur.th.t);
    cur.cv = { v: cvAt != null ? cvAt : 0 };

    const rainFc = await fetchForecastRainAfter(Math.min(cur.dk.t, cur.th.t));
    if (!rainFc) return json({ available: false, reason: 'Không lấy được mưa dự báo ECMWF' });
    const r1d = (x) => Math.round(x * 10) / 10;
    const pr = (keys, T, h) => pastRain(rainBy, keys, T, h);
    const mua = {
      R: { h6: pr(['dk', 'th', 'ta'], cur.th.t, 6), h24: pr(['dk', 'th', 'ta'], cur.th.t, 24), h48: pr(['dk', 'th', 'ta'], cur.th.t, 48) },
      Rm: { h24: pr(['dk', 'th'], cur.th.t, 24) },
      Rdk: { h6: pr(['dk', 'ta'], cur.dk.t, 6), h24: pr(['dk', 'ta'], cur.dk.t, 24), h48: pr(['dk', 'ta'], cur.dk.t, 48) },
      dk: { h24: pr(['dk'], cur.dk.t, 24) },
      ta: { h24: pr(['ta'], cur.th.t, 24) },
    };
    const out = {
      available: true, heSoHieuChinh,
      mucMuaDuBao: Object.fromEntries(LEADS.map((L) => [L, Object.fromEntries([
        ['luuVuc', rainFc.R], ['dakrongTram', rainFc.dk], ['thachhanTram', rainFc.th], ['taRut', rainFc.ta], ['dakrong', rainFc.Rdk],
      ].map(([k, arr]) => [k, { goc: r1d(sum(arr, L)), sauHieuChinh: r1d(sum(arr, L) * heSoHieuChinh) }]))])),
      tram: {},
    };
    out.tram.thachhan = {
      thoiDiemHienTai: cur.th.t, hienTai: r2(cur.th.v), tocDo6h: Math.round(cur.th.r6 * 1000) / 1000,
      rainDaQua24h: r1d(mua.R.h24), rainTaRutDaQua24h: r1d(mua.ta.h24), nguong: LEVEL_STATIONS.thachhan.nguong, nguongMoHinh: LEVEL_STATIONS.thachhan.nguongMoHinh,
      ...duBaoThachHan(cur, mua, rainFc, heSoHieuChinh),
    };
    out.tram.dakrong = {
      thoiDiemHienTai: cur.dk.t, hienTai: r2(cur.dk.v), tocDo6h: Math.round(cur.dk.r6 * 1000) / 1000,
      rainDaQua24h: r1d(mua.Rdk.h24), rainTaRutDaQua24h: r1d(mua.ta.h24), nguong: LEVEL_STATIONS.dakrong.nguong, nguongMoHinh: LEVEL_STATIONS.dakrong.nguongMoHinh,
      ...duBaoDakrong(cur, mua, rainFc, heSoHieuChinh),
    };
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
