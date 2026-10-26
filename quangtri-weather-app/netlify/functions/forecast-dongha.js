// netlify/functions/forecast-dongha.js
//
// Dự báo mực nước 6/12/18/24h cho trạm Đông Hà (554700) — sông Hiếu/Thạch Hãn hạ lưu Đông Hà, chịu ảnh hưởng triều.
// Hồi quy tuyến tính riêng cho từng mốc, huấn luyện từ số liệu giờ 2006-2026 (Đầu Mầu từ 2013-09, mưa từ 2011).
//   Lũ (Đông Hà >= 1.2 m): mực nước Đông Hà + cường suất 3h/6h + mực nước Đầu Mầu (thượng nguồn) + cường suất + mưa đã qua 6/24/48h + mưa dự báo đến mốc
//   Ngày thường (chịu triều): hàm điều hòa 12 phân triều của chính Đông Hà + phần dư thực đo gần nhất (xem khối "NGÀY THƯỜNG" bên dưới);
//     thiếu số liệu thì dùng hồi quy cũ: điều hòa 4 phân triều + mực nước hiện tại + cường suất + Cửa Việt (554800) + mưa dự báo
// Mưa: trung bình trạm Đông Hà (TV tự động) và Đầu Mầu — KTTV. Mưa dự báo = ECMWF IFS (Open-Meteo) x hệ số hiệu chỉnh.
// Kiểm nghiệm bỏ-từng-năm (mưa dự báo hoàn hảo): lũ đạt sai số cho phép 88.8/92.7/93.8/94.0% (6/12/18/24h: 43/71/87/96 cm); ngày thường ~99.7%;
// đỉnh (sai số cho phép 52 cm) ~62%, thường dự báo thấp hơn thực tế ~0.35 m. Chưa kiểm nghiệm với mưa dự báo ECMWF thực.
// Mực nước Cam Tuyền (VRain) chưa đưa vào: chỉ có ~3 mùa lũ, cải thiện không đáng kể.

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 60;
const LEADS = [6, 12, 18, 24];

const DONGHA = { matram: '554700', ten_table: 'mucnuoc_oday', nguong: { bd1: 2, bd2: 3, bd3: 4 }, nguongMoHinh: 1.2 };
const DAUMAU = { matram: '555200', ten_table: 'mucnuoc_oday' };
const CUAVIET = { matram: '554800', ten_table: 'mucnuoc_oday' };
const RAIN_STATIONS = [
  { matram: '554700', ten_table: 'mua_oday_thuyvan', lat: 16.8233, lng: 107.079, key: 'dh' },   // Đông Hà
  { matram: '555200', ten_table: 'mua_oday_thuyvan', lat: 16.7833, lng: 106.917, key: 'dm' },   // Đầu Mầu
];

// Lũ (có Đầu Mầu): [hằng số, dh, tốc độ 3h, tốc độ 6h, dm, dm tốc độ 3h(chênh 3h), mưa 6h qua, 24h qua, 48h qua, mưa dự báo đến mốc]
const MODEL_FL = {
  6: [-1.49499, 0.889485, 0.256925, -0.85611, 0.0699498, 0.212657, 0.00634743, -0.000628774, -0.000473757, 0.0066022],
  12: [0.719969, 0.837059, 0.0565591, -0.475158, -0.0385851, 0.217544, 0.00540599, -0.00144949, -0.000532864, 0.0102866],
  18: [0.537028, 0.756919, 0.183564, -0.87645, -0.0323105, 0.204292, 0.00334072, -0.00147603, -0.000714782, 0.0105566],
  24: [2.07268, 0.67522, 0.0884053, -0.101205, -0.102536, 0.199756, 0.0011726, -0.0016323, -0.000560654, 0.00964773],
};
// Lũ (thiếu Đầu Mầu): [hằng số, dh, tốc độ 3h, tốc độ 6h, mưa 6h, 24h, 48h qua, mưa dự báo đến mốc]
const MODEL_FL2 = {
  6: [-0.0492305, 0.944717, 1.00848, -0.774828, 0.00712489, -0.00109442, -0.000558578, 0.00645016],
  12: [0.0278109, 0.823693, 0.70179, -0.270207, 0.00548125, -0.00192902, -0.000669925, 0.00967116],
  18: [0.00755706, 0.741738, 0.808165, -0.380099, 0.00292617, -0.00201752, -0.000843085, 0.0100059],
  24: [0.177735, 0.58474, 0.67713, 0.3666, 0.000259031, -0.00204167, -0.000615261, 0.00905075],
};
// Ngày thường: [hằng số, dh, tốc độ 6h, cửa việt, mưa dự báo đến mốc, sin/cos M2, S2, K1, O1 (8 số)]
const MODEL_NT = {
  6: [0.035077, 0.607757, -3.15952, 0.352303, 0.00488441, 0.197277, -0.00928578, 0.0382857, 0.0328014, 0.0843448, -0.0167398, 0.175975, -0.132889],
  12: [0.0153766, 0.759963, -0.988668, 0.140415, 0.00551885, 0.103512, -0.038094, 0.0235785, 0.0118093, 0.082996, -0.0517673, 0.138799, -0.215808],
  18: [0.0224982, 0.62863, -4.38459, 0.291762, 0.00581772, 0.101079, -0.0490462, 0.0172743, 0.018209, 0.0118813, -0.0168073, -0.025594, -0.0914374],
  24: [0.00711034, 0.764076, -0.406146, 0.14889, 0.00534739, 0.0677409, -0.0831944, 0.0134569, 0.00522487, 0.00938603, -0.0022549, -0.024227, -0.0506286],
};
const T0_VN = Date.UTC(2013, 0, 1, 0, 0, 0);
const TIDE_PERIODS = [12.4206, 12.0, 23.9345, 25.8193];


// ===== NGÀY THƯỜNG (chịu triều): HÀM ĐIỀU HÒA CỦA CHÍNH ĐÔNG HÀ =====
// Hằng số và hệ số sinh từ tinh-he-so-dongha-hienluong.py (he-so-dongha-hienluong.json). Gốc thời gian: 00h 01/01/2000 giờ VN.
// Mực nước dự báo = triều điều hòa tại thời điểm dự báo + hồi quy theo phần dư thực đo gần nhất (giờ 0/3/6/12/24, TB 24 giờ) + mưa lưu vực
// (qm: mưa 24 giờ đã qua; sm: mưa dự báo đến mốc, đã nhân hệ số hiệu chỉnh).
// Ngày thường = Đông Hà dưới 1,2 m. Mưa lưu vực = trung bình Đông Hà và Đầu Mầu. Không dùng Cửa Việt (kiểm nghiệm cho thấy thêm Cửa Việt không cải thiện).
// Thiếu số liệu mực nước thì tự hạ xuống tầng rút gọn; thiếu phần dư, thiếu mưa đã qua (dưới 19/24 giờ) hoặc mưa dự báo thì dùng mô hình hồi quy cũ.
const PHAN_TRIEU_NT = [
  { ten: 'Q1', w: 13.3986609, a: 0.03732700851885941, b: 0.005130271890066368 },
  { ten: 'O1', w: 13.9430356, a: 0.02095460294116468, b: -0.14022189771957705 },
  { ten: 'P1', w: 14.9589314, a: -0.014910912499322254, b: 0.01837448612553136 },
  { ten: 'K1', w: 15.0410686, a: -0.026040135007004413, b: 0.04899311965124434 },
  { ten: 'N2', w: 28.4397295, a: 0.038542651025392075, b: -0.029035248195748407 },
  { ten: 'M2', w: 28.9841042, a: -0.1592177673821344, b: -0.16616295771026132 },
  { ten: 'S2', w: 30.0, a: 0.03128285354146633, b: 0.04900838805826855 },
  { ten: 'K2', w: 30.0821373, a: -0.011774830760582776, b: -0.024004124545963144 },
  { ten: 'M4', w: 57.9682084, a: 0.006728072224286004, b: 0.0014113093494580982 },
  { ten: 'MS4', w: 58.9841042, a: -0.004114099047160347, b: -0.0008620616044186747 },
  { ten: 'MN4', w: 57.4238337, a: -0.0006544525416578603, b: 0.002476851992924697 },
  { ten: 'M6', w: 86.9523127, a: 0.004597988440466762, b: 0.002609125479882101 },
];
const HE_SO_NT = {
  day_du: {
    6: { intercept: 0.0007056199367102871, Hf: 1.015809856885874, zt: 1.7479690753981927, r0: 0.38231965605397733, r3: -0.11941770341551537, r6: -0.1098823530220624, r12: -0.5789436363780235, r24: -0.4094321566876662, qm: 0.0007067679609333685, sm: 0.004130291487971445 },
    12: { intercept: -0.0015815957082813408, Hf: 1.0093443173887469, zt: 0.1354384450126805, r0: 0.5387613882219888, r3: 0.10727250818501972, r6: -0.07118402956527803, r12: 0.4040888289643939, r24: -0.22125884871479254, qm: -1.104105718637968e-05, sm: 0.005603347800148249 },
    18: { intercept: -0.003845001355627591, Hf: 1.0118039084695918, zt: 0.3375343574271647, r0: 0.42761678272733206, r3: -0.2552583017408677, r6: 0.6817521667235016, r12: -0.1273619437814243, r24: -0.19629256504178716, qm: -0.0006447910283998172, sm: 0.005981795808975941 },
    24: { intercept: -0.006719205844367759, Hf: 1.0042933418775903, zt: 0.09836844893042164, r0: 0.7364133696141991, r3: 0.2592168468430124, r6: -0.0605065642606209, r12: -0.023096399341957372, r24: -0.13511919838328573, qm: -0.001300606977018501, sm: 0.005769488804889659 },
  },
  rut_gon: {
    6: { intercept: 0.0003138568392064279, Hf: 1.0233831660091182, zt: 0.5647321099022046, r0: 0.31264688979630545, qm: 0.0011958615855031198, sm: 0.004451320907103215 },
    12: { intercept: -0.0028293134570197063, Hf: 1.0165228324911122, zt: 0.3134995210276203, r0: 0.5624832677864141, qm: 0.00044301934629700605, sm: 0.00555633392361683 },
    18: { intercept: -0.004499208500228975, Hf: 1.024605144378076, zt: 0.5304268927871898, r0: 0.2887582177863829, qm: 7.023138765666889e-05, sm: 0.006117108363582525 },
    24: { intercept: -0.007263153719709018, Hf: 1.004802484414313, zt: 0.021838317397709184, r0: 0.8352557018272054, qm: -0.0009828719529388664, sm: 0.005798643382172862 },
  },
};
const DAC_TRUNG_NT = {
  day_du: ['Hf', 'zt', 'r0', 'r3', 'r6', 'r12', 'r24', 'qm', 'sm'],
  rut_gon: ['Hf', 'zt', 'r0', 'qm', 'sm'],
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
// Thủy triều điều hòa tại Đông Hà (m, quanh mực nền) tại thời điểm tMs (ms UTC thật)
function trieuDieuHoa(tMs) {
  const h = (tMs - T0_DIEU_HOA_MS) / 3600000;
  let tong = 0;
  for (const c of PHAN_TRIEU_NT) {
    const [f, u] = heSoNut(h, c.ten);
    const x = c.w * RAD * h + u;
    tong += f * (c.a * Math.cos(x) + c.b * Math.sin(x));
  }
  return tong;
}
// Bỏ số liệu lỗi: ngoài khoảng hợp lý và đoạn >= 8 giờ liên tiếp không đổi (máy treo) — giống lúc huấn luyện
function loaiLoiNT(series, cao = 8) {
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
function phanDuTram(series) {
  const sach = loaiLoiNT(series);
  if (sach.length === 0) return null;
  const last = sach[sach.length - 1];
  const Tc = Math.round(last.t / 3600000);
  if (Math.abs(last.t - Tc * 3600000) > 30 * 60000) return null;
  const m = theoGioMap(sach);
  const pd = (lag) => { const v = m.get(Tc - lag); return v == null ? null : v - trieuDieuHoa((Tc - lag) * 3600000); };
  const r0 = pd(0);
  if (r0 == null) return null;
  const cuaSo = [];
  for (let k = 0; k < 24; k++) { const r = pd(k); if (r != null) cuaSo.push(r); }
  if (cuaSo.length < 12) return null;
  return { Tc, r0, r3: pd(3), r6: pd(6), r12: pd(12), r24: pd(24), zt: cuaSo.reduce((a, b) => a + b, 0) / cuaSo.length };
}
// Mưa lưu vực 24 giờ đã qua đến giờ Tc: qm = tổng (mm); du = false nếu thiếu quá 20% số giờ có số liệu (mô hình được huấn luyện trên mẫu đủ mưa)
function mua24NT(byHour, Tc) {
  let n = 0;
  for (let h = 0; h < 24; h++) { const v = byHour.get((Tc - h) * 3600000); if (v && v.length) n++; }
  return { qm: sumRainPast(byHour, Tc * 3600000, 24), du: n >= 19 };
}
// Dự báo ngày thường theo hàm điều hòa; sm = mưa dự báo đến mốc L (mm, đã nhân hệ số). Trả { y, moHinh } hoặc null nếu thiếu mưa
function duBaoNgayThuongDieuHoa(d, L, sm) {
  if (!d.du || sm == null) return null;
  const tang = [d.r3, d.r6, d.r12, d.r24].every((v) => v != null) ? 'day_du' : 'rut_gon';
  const c = HE_SO_NT[tang][L];
  const x = { Hf: trieuDieuHoa((d.Tc + L) * 3600000), zt: d.zt, r0: d.r0, r3: d.r3, r6: d.r6, r12: d.r12, r24: d.r24, qm: d.qm, sm };
  let y = c.intercept;
  for (const ten of DAC_TRUNG_NT[tang]) y += c[ten] * x[ten];
  return { y, moHinh: `dieu_hoa_${tang}` };
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

function duBaoDongHa(cur, mua, fc, heSo) {
  const lu = cur.dh.v >= DONGHA.nguongMoHinh;
  let moHinhNT = null;
  const coDM = cur.dm && Number.isFinite(cur.dm.v) && cur.dm.v > 15 && cur.dm.v < 30;
  const out = {};
  for (const L of LEADS) {
    const f = sum(fc.R, L) * heSo;
    let y;
    if (lu && coDM) y = dot(MODEL_FL[L], [1, cur.dh.v, cur.dh.r3, cur.dh.r6, cur.dm.v, cur.dm.d3, mua.h6, mua.h24, mua.h48, f]);
    else if (lu) y = dot(MODEL_FL2[L], [1, cur.dh.v, cur.dh.r3, cur.dh.r6, mua.h6, mua.h24, mua.h48, f]);
    else {
      const r = cur.dhc ? duBaoNgayThuongDieuHoa(cur.dhc, L, f) : null; // ngày thường: hàm điều hòa của Đông Hà + phần dư + mưa
      if (r) { y = r.y; moHinhNT = r.moHinh; }
      else { y = dot(MODEL_NT[L], [1, cur.dh.v, cur.dh.r6, cur.cv.v, f, ...tideTerms(cur.dh.t + L * 3600000)]); moHinhNT = 'hoi_quy_cu'; } // thiếu số liệu: mô hình cũ
    }
    out[L] = r2(y);
  }
  return { duBaoTheoMoc: out, cheDo: lu ? 'lu' : 'ngay_thuong', ...(lu ? {} : { moHinh: moHinhNT }), nhanDinhDinh: nhanDienDinh(cur.dh.v, out) };
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
  return { R: Array.from({ length: 24 }, (_, i) => mean([per.dh[i], per.dm[i]])), dh: per.dh, dm: per.dm };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const heSoParam = parseFloat(url.searchParams.get('hesoHieuChinh'));
    const heSoHieuChinh = Number.isFinite(heSoParam) && heSoParam > 0 ? heSoParam : 1.0;

    const [dhSeries, dmSeries, cvSeries, ...rainSeries] = await Promise.all([
      fetchKttvSeries(DONGHA, '0'),
      fetchKttvSeries(DAUMAU, '0'),
      fetchKttvSeries(CUAVIET, '0'),
      ...RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1')),
    ]);
    if (dhSeries.length === 0) return json({ available: false, reason: 'Không lấy được mực nước Đông Hà' });

    const last = dhSeries[dhSeries.length - 1];
    const at = (series, t, h, tol) => findValueAt(series, t - h * 3600000, tol);
    const v3 = at(dhSeries, last.t, 3, 45 * 60000); const v6 = at(dhSeries, last.t, 6);
    const cur = { dh: { t: last.t, v: last.v, r3: v3 != null ? (last.v - v3) / 3 : 0, r6: v6 != null ? (last.v - v6) / 6 : 0 } };
    const dmNow = findValueAt(dmSeries, last.t);
    const dm3 = findValueAt(dmSeries, last.t - 3 * 3600000, 45 * 60000);
    cur.dm = dmNow != null ? { v: dmNow, d3: dm3 != null ? dmNow - dm3 : 0 } : null;
    const cvAt = findValueAt(cvSeries, last.t);
    cur.cv = { v: cvAt != null ? cvAt : 0 };

    const rainFc = await fetchForecastRainAfter(last.t);
    if (!rainFc) return json({ available: false, reason: 'Không lấy được mưa dự báo ECMWF' });
    const r1d = (x) => Math.round(x * 10) / 10;
    const byHour = rainBasinByHour(rainSeries);
    const mua = { h6: sumRainPast(byHour, last.t, 6), h24: sumRainPast(byHour, last.t, 24), h48: sumRainPast(byHour, last.t, 48) };
    cur.dhc = phanDuTram(dhSeries); // phần dư so với triều điều hòa + mưa 24 giờ qua (null -> dùng mô hình cũ)
    if (cur.dhc) Object.assign(cur.dhc, mua24NT(byHour, cur.dhc.Tc));
    const out = {
      available: true, heSoHieuChinh,
      mucMuaDuBao: Object.fromEntries(LEADS.map((L) => [L, Object.fromEntries([
        ['luuVuc', rainFc.R], ['dongHaTram', rainFc.dh], ['dauMauTram', rainFc.dm],
      ].map(([k, arr]) => [k, { goc: r1d(sum(arr, L)), sauHieuChinh: r1d(sum(arr, L) * heSoHieuChinh) }]))])),
      tram: {},
    };
    out.tram.dongha = {
      thoiDiemHienTai: cur.dh.t, hienTai: r2(cur.dh.v), tocDo6h: Math.round(cur.dh.r6 * 1000) / 1000,
      rainDaQua24h: r1d(mua.h24), nguong: DONGHA.nguong, nguongMoHinh: DONGHA.nguongMoHinh,
      dauMauHienTai: cur.dm ? r2(cur.dm.v) : null,
      ...duBaoDongHa(cur, mua, rainFc, heSoHieuChinh),
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
