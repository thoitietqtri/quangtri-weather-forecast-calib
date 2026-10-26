// netlify/functions/forecast-thachhan.js
//
// Dự báo mực nước 6/12/18/24h cho Đakrông (trạm thượng nguồn) và Thạch Hãn (trạm dưới) — lưu vực sông Thạch Hãn.
// Hồi quy tuyến tính riêng cho từng mốc, huấn luyện từ số liệu giờ: mực nước 2013-2026, mưa 2011-2026.
//   Thạch Hãn (lũ: Thạch Hãn >= 1.0 m hoặc Đakrông >= 26 m): y = a + mực nước + tốc độ 3h/6h + mực nước Đakrông (trễ truyền ~8-9h) + tốc độ + mưa đã qua 6/24/48h + mưa dự báo đến mốc
//   Thạch Hãn (ngày thường, chịu triều): hàm điều hòa 12 phân triều của chính Thạch Hãn + phần dư thực đo gần nhất + mưa lưu vực (xem khối "NGÀY THƯỜNG" bên dưới);
//     thiếu số liệu thì dùng hồi quy cũ: điều hòa 4 phân triều + mực nước hiện tại + Đakrông + Cửa Việt (554800)
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


// ===== NGÀY THƯỜNG (chịu triều): HÀM ĐIỀU HÒA CỦA CHÍNH THẠCH HÃN =====
// Hằng số và hệ số sinh từ tinh-he-so-thachhan.py (he-so-thachhan.json). Gốc thời gian: 00h 01/01/2000 giờ VN.
// Mực nước dự báo = triều điều hòa tại thời điểm dự báo + hồi quy theo phần dư thực đo gần nhất (giờ 0/3/6/12/24, TB 24 giờ) + mưa lưu vực.
// Thiếu số liệu thì tự hạ xuống tầng rút gọn, thiếu nữa thì dùng mô hình hồi quy cũ (MODEL_TH_NT).
const PHAN_TRIEU_TH = [
  { ten: 'Q1', w: 13.3986609, a: 0.03459300056697099, b: 0.008730012980538509 },
  { ten: 'O1', w: 13.9430356, a: 0.03559670628021588, b: -0.13099946247691463 },
  { ten: 'P1', w: 14.9589314, a: -0.014387147244322008, b: 0.014636629068309091 },
  { ten: 'K1', w: 15.0410686, a: -0.02774769581854946, b: 0.03977074716116272 },
  { ten: 'N2', w: 28.4397295, a: 0.04482392038914214, b: -0.019738058373662198 },
  { ten: 'M2', w: 28.9841042, a: -0.12009292964206937, b: -0.20440858720408303 },
  { ten: 'S2', w: 30.0, a: 0.018569926989399604, b: 0.05497870667290866 },
  { ten: 'K2', w: 30.0821373, a: -0.005617449258208138, b: -0.025742287023738188 },
  { ten: 'M4', w: 57.9682084, a: 0.010340276462115883, b: 0.008026789794723117 },
  { ten: 'MS4', w: 58.9841042, a: -0.004685128059929238, b: -0.004353556972010893 },
  { ten: 'MN4', w: 57.4238337, a: -0.003235434499155953, b: 0.0032536239748607552 },
  { ten: 'M6', w: 86.9523127, a: -0.0004903416010678107, b: 0.005378293170807926 },
];
const HE_SO_TH_DH = {
  day_du: {
    6: { intercept: -0.0018887300073153332, Hf: 1.031177516307113, zt: 1.7411145064539968, r0: 0.3253897039121363, r3: -0.17714881205747826, r6: -0.022528774638507238, r12: -0.5202172776325786, r24: -0.43048614894292236, qthap: 0.0005711303348427059, sthap: 0.0020006436696577766, qnui: 0.000587768252420284, snui: 0.0016207053721531035 },
    12: { intercept: -0.010415285793283912, Hf: 1.0181553066501103, zt: 0.16964848907382704, r0: 0.5331092979263693, r3: 0.09124013435969104, r6: -0.08920175657800379, r12: 0.4641700375298153, r24: -0.26192000481577465, qthap: 0.0005655607641054341, sthap: 0.0022659075506102234, qnui: 0.0011941920119794233, snui: 0.0032451516264422973 },
    18: { intercept: -0.02040285884099862, Hf: 1.0276319753377972, zt: 0.4180726619148793, r0: 0.38245352375386493, r3: -0.25625169703868095, r6: 0.6850636976299371, r12: -0.11012815932768699, r24: -0.24112888675950414, qthap: 0.00041636758138793514, sthap: 0.002689989671014875, qnui: 0.0012246960355882786, snui: 0.005039100942066395 },
    24: { intercept: -0.030543840720495496, Hf: 1.0030463198519382, zt: -0.007238181211363024, r0: 0.8282699286676813, r3: 0.24469029390236116, r6: -0.0283550677982982, r12: 0.00527545125055637, r24: -0.14027604260423798, qthap: 1.9747996912267197e-05, sthap: 0.0024993439340315515, qnui: 0.0005748634923869968, snui: 0.006509759175089261 },
  },
  rut_gon: {
    6: { intercept: -0.0024490029895151387, Hf: 1.0407333934435168, zt: 0.7172336861595052, r0: 0.12809036396549872, qthap: 0.001169617923305715, sthap: 0.0024341862967554, qnui: 0.0008071777665697822, snui: 0.001820000741425456 },
    12: { intercept: -0.010737156200356824, Hf: 1.0307730983585766, zt: 0.2661026905811927, r0: 0.6126667414205207, qthap: 0.0008230037304095412, sthap: 0.0023101057273106486, qnui: 0.0012504413250944793, snui: 0.0031693013930991884 },
    18: { intercept: -0.020901730421039936, Hf: 1.0436662786078394, zt: 0.6365231168134288, r0: 0.15363781622495348, qthap: 0.0011306232293173451, sthap: 0.002950923986335084, qnui: 0.0014679728419698336, snui: 0.005050583170049387 },
    24: { intercept: -0.030917699695966586, Hf: 1.014605683314428, zt: -0.028933038420474975, r0: 0.8993695429869992, qthap: 0.0003077950392486194, sthap: 0.0025819691230725608, qnui: 0.0006648259130429332, snui: 0.006492840286959559 },
  },
};
const DAC_TRUNG_TH = {
  day_du: ['Hf', 'zt', 'r0', 'r3', 'r6', 'r12', 'r24', 'qthap', 'sthap', 'qnui', 'snui'],
  rut_gon: ['Hf', 'zt', 'r0', 'qthap', 'sthap', 'qnui', 'snui'],
};
const T0_DIEU_HOA_MS = Date.UTC(2000, 0, 1) - 7 * 3600000; // 00h 01/01/2000 giờ VN, ms UTC thật
const RAD = Math.PI / 180;

// (f, u[rad]) hiệu chỉnh nút (Schureman rút gọn)
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
    default: return [1, 0];
  }
}
// Thủy triều điều hòa tại Thạch Hãn (m, quanh mực nền) tại thời điểm tMs (ms UTC thật)
function trieuDieuHoaTH(tMs) {
  const h = (tMs - T0_DIEU_HOA_MS) / 3600000;
  let tong = 0;
  for (const c of PHAN_TRIEU_TH) {
    const [f, u] = heSoNut(h, c.ten);
    const x = c.w * RAD * h + u;
    tong += f * (c.a * Math.cos(x) + c.b * Math.sin(x));
  }
  return tong;
}
// Bỏ số liệu lỗi: ngoài khoảng hợp lý và đoạn >= 8 giờ liên tiếp không đổi (máy treo) — giống lúc huấn luyện
function loaiLoiTH(series, cao = 9) {
  const ok = series.map((p) => p.v >= -1.6 && p.v <= cao);
  let i = 0;
  while (i < series.length) {
    let j = i;
    while (j + 1 < series.length && series[j + 1].v === series[i].v) j++;
    if (j - i + 1 >= 8) for (let k = i; k <= j; k++) ok[k] = false;
    i = j + 1;
  }
  return series.filter((_, k) => ok[k]);
}
function theoGioMap(series) {
  const m = new Map(); const lech = new Map();
  for (const p of series) {
    const k = Math.round(p.t / 3600000);
    const d = Math.abs(p.t - k * 3600000);
    if (!lech.has(k) || d < lech.get(k)) { m.set(k, p.v); lech.set(k, d); }
  }
  return m;
}
// Phần dư thực đo so với triều điều hòa tại giờ phát tin Tc (chỉ số giờ UTC thật). null nếu chưa đủ số liệu.
function phanDuThachHan(thSeries) {
  const sach = loaiLoiTH(thSeries);
  if (sach.length === 0) return null;
  const last = sach[sach.length - 1];
  const Tc = Math.round(last.t / 3600000);
  if (Math.abs(last.t - Tc * 3600000) > 30 * 60000) return null;
  const m = theoGioMap(sach);
  const pd = (lag) => { const v = m.get(Tc - lag); return v == null ? null : v - trieuDieuHoaTH((Tc - lag) * 3600000); };
  const r0 = pd(0);
  if (r0 == null) return null;
  const cuaSo = [];
  for (let k = 0; k < 24; k++) { const r = pd(k); if (r != null) cuaSo.push(r); }
  if (cuaSo.length < 12) return null;
  return { Tc, r0, r3: pd(3), r6: pd(6), r12: pd(12), r24: pd(24), zt: cuaSo.reduce((a, b) => a + b, 0) / cuaSo.length };
}

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
  let moHinh = null;
  for (const L of LEADS) {
    let y;
    if (lu) {
      const x = [1, cur.th.v, cur.th.r3, cur.th.r6, cur.dk.v, cur.dk.r3, cur.dk.r6, mua.R.h6, mua.Rm.h24, mua.ta.h24, mua.R.h48, sum(fc.Rm, L) * heSo, sum(fc.ta, L) * heSo];
      y = dot(MODEL_TH[L], x);
    } else if (cur.dh) {
      // ngày thường: hàm điều hòa của Thạch Hãn + phần dư + mưa (tầng đầy đủ, thiếu giờ giữa chừng thì rút gọn)
      const d = cur.dh;
      const tang = [d.r3, d.r6, d.r12, d.r24].every((v) => v != null) ? 'day_du' : 'rut_gon';
      const c = HE_SO_TH_DH[tang][L];
      const x = {
        Hf: trieuDieuHoaTH((d.Tc + L) * 3600000), zt: d.zt, r0: d.r0, r3: d.r3, r6: d.r6, r12: d.r12, r24: d.r24,
        qthap: d.qthap, qnui: d.qnui, sthap: sum(fc.th, L) * heSo, snui: sum(fc.Rdk, L) * heSo,
      };
      y = c.intercept;
      for (const ten of DAC_TRUNG_TH[tang]) y += c[ten] * x[ten];
      moHinh = `dieu_hoa_${tang}`;
    } else {
      // thiếu số liệu để tính phần dư: dùng mô hình hồi quy cũ
      const x = [1, ...tideTerms(cur.th.t + L * 3600000), cur.th.v, cur.th.r6, cur.dk.v, cur.cv.v];
      y = dot(MODEL_TH_NT[L], x);
      moHinh = 'hoi_quy_cu';
    }
    out[L] = r2(y);
  }
  return { duBaoTheoMoc: out, cheDo: lu ? 'lu' : 'ngay_thuong', ...(lu ? {} : { moHinh }), nhanDinhDinh: nhanDienDinh(cur.th.v, out) };
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
    // ngày thường: phần dư so với triều điều hòa của Thạch Hãn (null nếu chưa đủ số liệu -> dùng mô hình cũ)
    const dh = phanDuThachHan(thSeries);
    if (dh) {
      dh.qthap = pr(['th'], dh.Tc * 3600000, 24);
      dh.qnui = pr(['dk', 'ta'], dh.Tc * 3600000, 24);
      cur.dh = dh;
    }
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
