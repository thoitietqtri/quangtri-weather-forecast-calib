// netlify/functions/forecast-cuaviet.js
//
// Dự báo mực nước 6/12/18/24h cho trạm TV Cửa Việt (gần cửa biển, lưu vực sông Thạch Hãn).
// Cửa Việt chịu triều mạnh nên dùng HÀM ĐIỀU HÒA (12 phân triều, dựng từ chính số liệu giờ Cửa Việt 2006-2026):
//   mực nước tương lai = triều điều hòa tại giờ đích + phần dư thực đo gần nhất (0/3/6/12/24h trước, TB 24h) + mưa lưu vực.
// Hai chế độ:
//   - NGÀY THƯỜNG: Thạch Hãn dưới BĐ II (4,5m), hoặc thiếu số liệu Thạch Hãn.
//   - LŨ: Thạch Hãn từ BĐ II (4,5m) trở lên: cộng hiệu chỉnh tuyến tính theo mực nước Thạch Hãn và cường suất lên/xuống 6 giờ của Thạch Hãn
//     (hệ số lũ lưu dạng gộp: mô hình ngày thường + hiệu chỉnh, chỉ 3 tham số mỗi hạn để tránh quá khớp).
// Mưa: vùng thấp = Thạch Hãn, vùng núi = TB Đakrông và Tà Rụt; mưa dự báo = ECMWF IFS (Open-Meteo)
// CÓ NHÃN GIỜ, tính từ giờ phát tin (T+1..T+L) nhân hệ số hiệu chỉnh.
// Kiểm chứng chéo bỏ-một-năm 2013-2025 (mưa dự báo hoàn hảo): ngày thường sai số TB 0,050/0,057/0,060/0,060m,
// lũ 0,106/0,144/0,162/0,155m cho +6/+12/+18/+24h. Tính lại hệ số mỗi năm một lần: tinh-he-so-cuaviet.py (gói cuaviet-dieu-hoa, không nằm trong repo).
// Số liệu lỗi (Cửa Việt ngoài -1,6 đến 4m; Thạch Hãn ngoài -1,6 đến 9m; hoặc từ 8 giờ liên tiếp không đổi — máy treo) bị loại như khi huấn luyện.

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 60;
const LEADS = [6, 12, 18, 24];
const NGUONG_LU_THACH_HAN = 4.5; // BĐ II Thạch Hãn
const NGUONG = { bd1: 1, bd2: 1.5, bd3: 2 }; // BĐ Cửa Việt

const CUAVIET = { matram: '554800', ten_table: 'mucnuoc_oday' };
const THACHHAN = { matram: '554600', ten_table: 'mucnuoc_oday' };
const RAIN_STATIONS = [
  { matram: '554600', ten_table: 'mua_oday_thuyvan', lat: 16.7336, lng: 107.153, vung: 'thap' },  // Thạch Hãn
  { matram: '554500', ten_table: 'mua_oday_thuyvan', lat: 16.6575, lng: 106.815, vung: 'nui' },   // Đakrông
  { matram: '559000', ten_table: 'mua_oday_domua', lat: 16.391, lng: 106.995, vung: 'nui' },      // Tà Rụt
];

// ===== HÀM ĐIỀU HÒA: hằng số và hệ số sinh từ tinh-he-so-donghoi.py (he-so-donghoi.json) =====
// Gốc thời gian: 00h 01/01/2000 giờ VN.
const PHAN_TRIEU = [
  { ten: 'Q1', w: 13.3986609, a: 0.03772472763921237, b: -1.0462464496555229e-05 },
  { ten: 'O1', w: 13.9430356, a: 0.0029197099750288575, b: -0.14366250988883797 },
  { ten: 'P1', w: 14.9589314, a: -0.0081446555471859, b: 0.020101791914028368 },
  { ten: 'K1', w: 15.0410686, a: -0.017383038513061687, b: 0.054147417313171395 },
  { ten: 'N2', w: 28.4397295, a: 0.025546976274389194, b: -0.035757327419836775 },
  { ten: 'M2', w: 28.9841042, a: -0.18129887828928926, b: -0.1036025406925785 },
  { ten: 'S2', w: 30.0, a: 0.0422732022143192, b: 0.031316689614621834 },
  { ten: 'K2', w: 30.0821373, a: -0.017063322843546985, b: -0.01991514402722298 },
  { ten: 'M4', w: 57.9682084, a: -9.571448724903238e-06, b: 0.0005823326822449939 },
  { ten: 'MS4', w: 58.9841042, a: -1.0068710122647006e-05, b: 0.0007683007884915374 },
  { ten: 'MN4', w: 57.4238337, a: -3.206203785210561e-05, b: -2.4631980121922925e-05 },
  { ten: 'M6', w: 86.9523127, a: 0.003107592673301929, b: -0.0035490340271426717 },
];
const HE_SO = {
  thuong_day_du: {
    6: { intercept: -0.004342539791515491, Hf: 1.0025574139158784, zt: 2.095454160779122, r0: 0.392712987759701, r3: -0.15028847600148276, r6: -0.27855551848132465, r12: -0.6155092940951591, r24: -0.5116987035054602, qthap: 0.0001569621725278271, sthap: 0.0011130038902107753, qnui: 9.019353005659994e-05, snui: 0.001220341526360042 },
    12: { intercept: -0.0064084259264043045, Hf: 1.0015605370410534, zt: 0.3255190158331637, r0: 0.517663118328601, r3: 0.02939602374001162, r6: -0.12040565726438869, r12: 0.4533214389031229, r24: -0.30723641171532934, qthap: 5.86931685626601e-05, sthap: 0.0012883212651422025, qnui: -0.00014542260857166686, snui: 0.0013698939751730207 },
    18: { intercept: -0.008459357059025332, Hf: 1.001876847757183, zt: 0.4198636169937723, r0: 0.43636345678932215, r3: -0.3437021120848255, r6: 0.678902653246287, r12: -0.07506848453910576, r24: -0.2477393457280496, qthap: -4.951500690300206e-05, sthap: 0.0013562731289895828, qnui: -0.000476973938839291, snui: 0.0014974797683851761 },
    24: { intercept: -0.008095250580948973, Hf: 1.0008645273922319, zt: 0.21387506612415175, r0: 0.7149119100054306, r3: 0.24280045713233328, r6: -0.09705991036216124, r12: -0.03389292562285103, r24: -0.17569337146079686, qthap: -0.0002631116830776099, sthap: 0.0012623055581131653, qnui: -0.0008148258182623664, snui: 0.001396028646550502 },
  },
  thuong_rut_gon: {
    6: { intercept: -0.007190997893072454, Hf: 1.0087250538323793, zt: 0.5866446287327169, r0: 0.32911184333769694, qthap: 0.0003251684109948743, sthap: 0.0012253805195607953, qnui: 0.0002650153328711601, snui: 0.001446797005810684 },
    12: { intercept: -0.00894371567917566, Hf: 1.007046283775609, zt: 0.4415600680588666, r0: 0.4466595045598153, qthap: 0.00021685977172635412, sthap: 0.001297612075939343, qnui: 4.068918912880399e-05, snui: 0.0013928622882877194 },
    18: { intercept: -0.012462296395926222, Hf: 1.0065838019606927, zt: 0.5848981984940285, r0: 0.2606410817212904, qthap: 0.00020172617826356464, sthap: 0.00138469816366736, qnui: -0.0002045806099631735, snui: 0.0015728030055221494 },
    24: { intercept: -0.009938275568664742, Hf: 0.9943211893351429, zt: 0.053764891916178885, r0: 0.8015026026600844, qthap: -0.0001518893235970255, sthap: 0.001274413931197886, qnui: -0.0006843980268445007, snui: 0.001416423586055764 },
  },
  lu_day_du: {
    6: { intercept: -0.20156982173849874, Hf: 1.0025574139158784, zt: 2.095454160779122, r0: 0.392712987759701, r3: -0.15028847600148276, r6: -0.27855551848132465, r12: -0.6155092940951591, r24: -0.5116987035054602, qthap: 0.0001569621725278271, sthap: 0.0011130038902107753, qnui: 9.019353005659994e-05, snui: 0.001220341526360042, TH: 0.02104030199396301, dTH6: 0.10166437630659536 },
    12: { intercept: -0.40998542586215864, Hf: 1.0015605370410534, zt: 0.3255190158331637, r0: 0.517663118328601, r3: 0.02939602374001162, r6: -0.12040565726438869, r12: 0.4533214389031229, r24: -0.30723641171532934, qthap: 5.86931685626601e-05, sthap: 0.0012883212651422025, qnui: -0.00014542260857166686, snui: 0.0013698939751730207, TH: 0.048426336940611464, dTH6: 0.13134554260133247 },
    18: { intercept: -0.4421772108891625, Hf: 1.001876847757183, zt: 0.4198636169937723, r0: 0.43636345678932215, r3: -0.3437021120848255, r6: 0.678902653246287, r12: -0.07506848453910576, r24: -0.2477393457280496, qthap: -4.951500690300206e-05, sthap: 0.0013562731289895828, qnui: -0.000476973938839291, snui: 0.0014974797683851761, TH: 0.05063331074540358, dTH6: 0.16928095218163758 },
    24: { intercept: -0.42278224685446775, Hf: 1.0008645273922319, zt: 0.21387506612415175, r0: 0.7149119100054306, r3: 0.24280045713233328, r6: -0.09705991036216124, r12: -0.03389292562285103, r24: -0.17569337146079686, qthap: -0.0002631116830776099, sthap: 0.0012623055581131653, qnui: -0.0008148258182623664, snui: 0.001396028646550502, TH: 0.04804189062716901, dTH6: 0.12795992252822863 },
  },
  lu_rut_gon: {
    6: { intercept: -0.18565832049881245, Hf: 1.0087250538323793, zt: 0.5866446287327169, r0: 0.32911184333769694, qthap: 0.0003251684109948743, sthap: 0.0012253805195607953, qnui: 0.0002650153328711601, snui: 0.001446797005810684, TH: 0.018022377375562414, dTH6: 0.1048298317099178 },
    12: { intercept: -0.36765795777322463, Hf: 1.007046283775609, zt: 0.4415600680588666, r0: 0.4466595045598153, qthap: 0.00021685977172635412, sthap: 0.001297612075939343, qnui: 4.068918912880399e-05, snui: 0.0013928622882877194, TH: 0.04241184794649727, dTH6: 0.12605817652562673 },
    18: { intercept: -0.4392561257384996, Hf: 1.0065838019606927, zt: 0.5848981984940285, r0: 0.2606410817212904, qthap: 0.00020172617826356464, sthap: 0.00138469816366736, qnui: -0.0002045806099631735, snui: 0.0015728030055221494, TH: 0.0495494227350335, dTH6: 0.17273932552415022 },
    24: { intercept: -0.4215251796839806, Hf: 0.9943211893351429, zt: 0.053764891916178885, r0: 0.8015026026600844, qthap: -0.0001518893235970255, sthap: 0.001274413931197886, qnui: -0.0006843980268445007, snui: 0.001416423586055764, TH: 0.0474758103768448, dTH6: 0.12885976324582765 },
  },
};
const DAC_TRUNG = {
  thuong_day_du: ['Hf', 'zt', 'r0', 'r3', 'r6', 'r12', 'r24', 'qthap', 'sthap', 'qnui', 'snui'],
  thuong_rut_gon: ['Hf', 'zt', 'r0', 'qthap', 'sthap', 'qnui', 'snui'],
  lu_day_du: ['Hf', 'zt', 'r0', 'r3', 'r6', 'r12', 'r24', 'qthap', 'sthap', 'qnui', 'snui', 'TH', 'dTH6'],
  lu_rut_gon: ['Hf', 'zt', 'r0', 'qthap', 'sthap', 'qnui', 'snui', 'TH', 'dTH6'],
};
const T0_DIEU_HOA_MS = Date.UTC(2000, 0, 1) - 7 * 3600000; // 00h 01/01/2000 giờ VN, ms UTC thật
const RAD = Math.PI / 180;

const vnNow = () => new Date(Date.now() + 7 * 3600 * 1000);
const fmtVN = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;

function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}
function coTrangThai(arr, lyDo) { arr.lyDo = lyDo; return arr; }
function gioVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

// t = ms UTC thật (nhãn giờ VN trừ 7h)
async function fetchKttvSeries(station, tinhtong) {
  const end = vnNow();
  const start = new Date(end.getTime() - (HOURS_BACK + 1) * 3600 * 1000);
  const url = `${KTTV_BASE_URL}?matram=${station.matram}&ten_table=${station.ten_table}&sophut=60&tinhtong=${tinhtong}`
    + `&thoigianbd='${fmtVN(start)}'&thoigiankt='${fmtVN(end)}'`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return coTrangThai([], `máy chủ KTTV trả lỗi ${res.status}`);
    const js = await res.json();
    if (!Array.isArray(js) || js.length === 0) return coTrangThai([], 'KTTV không có số liệu trong 60 giờ qua');
    const sampleKeys = Object.keys(js[0]).reduce((acc, k) => ({ ...acc, [k.toLowerCase()]: k }), {});
    const valKey = sampleKeys['solieu'] || 'Solieu';
    const timeKey = sampleKeys['thoigian_sl'] || 'Thoigian_SL';
    const kq = js
      .map((r) => ({ t: new Date(`${r[timeKey]}Z`.replace(' ', 'T')).getTime() - 7 * 3600 * 1000, v: parseFloat(r[valKey]) }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => a.t - b.t);
    return kq.length === 0 ? coTrangThai(kq, 'KTTV trả về số liệu rỗng') : kq;
  } catch (e) {
    return coTrangThai([], e && e.name === 'AbortError' ? 'máy chủ KTTV không trả lời kịp (quá 8 giây)' : 'không kết nối được máy chủ KTTV');
  }
}

// Loại số liệu mực nước lỗi như lúc huấn luyện: ngoài khoảng hợp lý, hoặc >= 8 giờ liên tiếp không đổi (máy treo).
function loaiLoi(series, cao = 4) {
  const ok = series.map((p) => p.v >= -1.6 && p.v <= cao);
  let i = 0;
  while (i < series.length) {
    let j = i;
    while (j + 1 < series.length && series[j + 1].v === series[i].v) j++;
    if (j - i + 1 >= 8) for (let k = i; k <= j; k++) ok[k] = false;
    i = j + 1;
  }
  const kq = series.filter((_, k) => ok[k]);
  kq.lyDo = series.lyDo;
  if (kq.length === 0 && series.length > 0) kq.lyDo = 'số liệu mực nước bị loại vì lỗi (ngoài khoảng hợp lý hoặc máy treo)';
  return kq;
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
function gomTheoGio(seriesArr) {
  const m = new Map();
  for (const series of seriesArr) {
    for (const p of series) {
      const b = Math.floor(p.t / 3600000) * 3600000;
      if (!m.has(b)) m.set(b, []);
      m.get(b).push(p.v);
    }
  }
  return m;
}

// Mưa dự báo ECMWF có nhãn giờ (Open-Meteo: chuỗi giờ bắt đầu từ 00h hôm nay, nhãn T = mưa của giờ trước T), TB theo vùng.
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
      return { vung: s.vung, time, pr };
    } catch {
      return null;
    }
  }));
  const valid = results.filter(Boolean);
  if (valid.length === 0) return null;
  const goc = valid[0].time[0];
  const dongBo = valid.filter((v) => v.time[0] === goc);
  const tb = (vung) => {
    const g = dongBo.filter((v) => v.vung === vung);
    if (g.length === 0) return null;
    const n = Math.min(...g.map((v) => v.pr.length));
    return Array.from({ length: n }, (_, i) => g.reduce((a, v) => a + (v.pr[i] || 0), 0) / g.length);
  };
  const thap = tb('thap'); const nui = tb('nui');
  if (!thap) return null;
  const gio0 = Math.round((Date.parse(`${goc}:00Z`) - 7 * 3600000) / 3600000);
  return { gio0, thap, nui: nui || thap.map(() => 0), thieuNui: !nui };
}
function tongSau(arr, gio0, Tc, L) {
  let tong = 0;
  for (let j = 1; j <= L; j++) {
    const v = arr[Tc + j - gio0];
    if (v == null || !Number.isFinite(v)) return null;
    tong += v;
  }
  return tong;
}

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
// Thủy triều điều hòa tại Cửa Việt (m, quanh mực nền) tại thời điểm tMs (ms UTC thật)
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

function theoGioMap(series) {
  const m = new Map(); const lech = new Map();
  for (const p of series) {
    const k = Math.round(p.t / 3600000);
    const d = Math.abs(p.t - k * 3600000);
    if (!lech.has(k) || d < lech.get(k)) { m.set(k, p.v); lech.set(k, d); }
  }
  return m;
}

function nhanDienDinh(hienTaiV, duBaoTheoMoc) {
  const diem = [{ h: 0, v: hienTaiV }, ...LEADS.map((h) => ({ h, v: duBaoTheoMoc[h] }))];
  for (let i = 1; i < diem.length - 1; i++) {
    if (diem[i].v >= diem[i - 1].v && diem[i].v >= diem[i + 1].v && diem[i].v > diem[i - 1].v) {
      return { coDinh: true, gioTruoc: diem[i - 1].h, gioDinh: diem[i].h, giaTriDinh: diem[i].v };
    }
  }
  return { coDinh: false };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const heSoParam = parseFloat(url.searchParams.get('hesoHieuChinh'));
    const heSoHieuChinh = Number.isFinite(heSoParam) && heSoParam > 0 ? heSoParam : 1.0;
    const epKhongThachHan = url.searchParams.get('khongThachHan') === '1'; // chỉ để thử/so sánh

    const [cvRaw, thRaw, ...rainArr] = await Promise.all([
      fetchKttvSeries(CUAVIET, '0'),
      fetchKttvSeries(THACHHAN, '0'),
      ...RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1')),
    ]);
    const dhSeries = loaiLoi(cvRaw); const ltSeries = loaiLoi(thRaw, 9);
    if (dhSeries.length === 0) {
      return json({ available: false, reason: `Không lấy được mực nước Cửa Việt (${dhSeries.lyDo || cvRaw.lyDo || 'không có số liệu'})` });
    }
    const current = dhSeries[dhSeries.length - 1];
    const Tc = Math.round(current.t / 3600000); // chỉ số giờ phát tin (UTC thật)
    if (Math.abs(current.t - Tc * 3600000) > 30 * 60000 || Date.now() - current.t > 6 * 3600000) {
      const nghiLoi = cvRaw.length > 0 && cvRaw[cvRaw.length - 1].t > current.t;
      return json({ available: false, reason: `Số liệu Cửa Việt hợp lệ mới nhất là lúc ${gioVN(current.t)}, đã cũ hoặc lệch giờ — không dự báo.${nghiLoi ? ' Các số liệu sau đó nghi bị lỗi (ngoài khoảng hợp lý hoặc máy treo).' : ''}` });
    }
    const dh = theoGioMap(dhSeries);
    const phanDu = (lag) => {
      const v = dh.get(Tc - lag);
      return v == null ? null : v - trieuDieuHoa((Tc - lag) * 3600000);
    };
    const r0 = phanDu(0);
    if (r0 == null) return json({ available: false, reason: `Cửa Việt chưa có số liệu đúng giờ ${gioVN(Tc * 3600000)}` });
    const cuaSo = [];
    for (let k = 0; k < 24; k++) { const r = phanDu(k); if (r != null) cuaSo.push(r); }
    if (cuaSo.length < 12) return json({ available: false, reason: `Cửa Việt chỉ có ${cuaSo.length}/24 số liệu giờ trong 24 giờ qua (cần ít nhất 12)` });
    const zt = cuaSo.reduce((a, b) => a + b, 0) / cuaSo.length;
    const r3 = phanDu(3); const r6 = phanDu(6); const r12 = phanDu(12); const r24 = phanDu(24);
    const dayDu = [r3, r6, r12, r24].every((v) => v != null);

    // Thạch Hãn: chế độ lũ khi từ BĐ II và có đủ số liệu hiện tại + 6 giờ trước
    const lt = theoGioMap(ltSeries);
    const thNow = epKhongThachHan ? null : (lt.get(Tc) ?? lt.get(Tc - 1) ?? null);
    const th6 = epKhongThachHan ? null : (lt.get(Tc - 6) ?? lt.get(Tc - 7) ?? null);
    const cheLu = thNow != null && th6 != null && thNow >= NGUONG_LU_THACH_HAN;
    const che = cheLu ? 'lu' : 'thuong';
    const tang = dayDu ? 'day_du' : 'rut_gon';
    const khoaHeSo = `${che}_${tang}`;

    // mưa đã qua 24h (vùng thấp, vùng núi) và 6/12/18/24h
    const rainThap = gomTheoGio(rainArr.slice(0, 1)); const rainNui = gomTheoGio(rainArr.slice(1));
    const qthap = sumRainInWindow(rainThap, Tc * 3600000, 24);
    const qnui = sumRainInWindow(rainNui, Tc * 3600000, 24);
    const mucMuaDaQua = Object.fromEntries(LEADS.map((L) => [L, r1(sumRainInWindow(rainThap, Tc * 3600000, L))]));

    // mưa dự báo T+1..T+L
    const fc = await fetchForecastRainTimed();
    const mucMuaDuBao = {}; const sthap = {}; const snui = {}; let thieuMuaDuBao = false;
    for (const L of LEADS) {
      const gt = fc ? tongSau(fc.thap, fc.gio0, Tc, L) : null;
      const gn = fc ? tongSau(fc.nui, fc.gio0, Tc, L) : null;
      if (gt == null || gn == null) {
        thieuMuaDuBao = true; sthap[L] = 0; snui[L] = 0; mucMuaDuBao[L] = { goc: null, sauHieuChinh: null };
      } else {
        sthap[L] = gt * heSoHieuChinh; snui[L] = gn * heSoHieuChinh;
        mucMuaDuBao[L] = { goc: r1(gt), sauHieuChinh: r1(gt * heSoHieuChinh) };
      }
    }

    const duBaoRaw = {}; const phanDuMoc = [r0];
    for (const L of LEADS) {
      const c = HE_SO[khoaHeSo][L];
      const Hf = trieuDieuHoa((Tc + L) * 3600000);
      const x = { Hf, zt, r0, r3, r6, r12, r24, qthap, qnui, sthap: sthap[L], snui: snui[L], TH: thNow, dTH6: cheLu ? thNow - th6 : 0 };
      let y = c.intercept;
      for (const ten of DAC_TRUNG[khoaHeSo]) y += c[ten] * x[ten];
      duBaoRaw[L] = y;
      phanDuMoc.push(y - Hf);
    }
    // đường mực nước từng giờ: triều điều hòa + phần hiệu chỉnh nội suy tuyến tính giữa các mốc 0/6/12/18/24h
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
    const diem = (k) => ({ gio: k, t: (Tc + k) * 3600000, v: r2(duongTrieu[k].v) });
    const duBaoTheoMoc = Object.fromEntries(LEADS.map((h) => [h, r2(duBaoRaw[h])]));

    return json({
      available: true,
      cheDo: cheLu ? 'lu_thach_han' : 'dieu_hoa',
      tang,
      thoiDiemHienTai: Tc * 3600000,
      cuavietHienTai: r2(current.v),
      thachhanHienTai: thNow != null ? r2(thNow) : null,
      thieuThachHan: thNow == null,
      nguongLuThachHan: NGUONG_LU_THACH_HAN,
      nguong: NGUONG,
      rainDaQua24h: r1(qthap),
      mucMuaDaQua,
      heSoHieuChinh,
      mucMuaDuBao,
      thieuMuaDuBao,
      duBaoTheoMoc,
      duongTrieu: duongTrieu.map((p) => ({ h: p.h, v: r2(p.v) })),
      trieuCao: diem(cao),
      trieuThap: diem(thap),
      nhanDinhDinh: nhanDienDinh(r2(current.v), duBaoTheoMoc),
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
