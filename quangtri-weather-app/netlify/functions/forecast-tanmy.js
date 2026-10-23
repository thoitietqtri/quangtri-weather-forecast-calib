// netlify/functions/forecast-tanmy.js
//
// Dự báo mực nước 6/12/18/24h cho trạm TV Tân Mỹ (gần cửa biển, lưu vực sông Gianh).
// Tân Mỹ chịu triều mạnh nên dùng HÀM ĐIỀU HÒA (12 phân triều, dựng từ chính số liệu giờ Tân Mỹ các năm đo tốt 2011-2014, 2017-2025):
//   mực nước tương lai = triều điều hòa tại giờ đích + phần dư thực đo gần nhất (0/3/6/12/24h trước, TB 24h) + mưa lưu vực Mai Hóa.
// Hai chế độ:
//   - NGÀY THƯỜNG: Mai Hóa dưới BĐ II (5,0m), hoặc thiếu số liệu Mai Hóa.
//   - LŨ: Mai Hóa từ BĐ II (5,0m) trở lên: cộng hiệu chỉnh tuyến tính theo mực nước Mai Hóa và cường suất lên/xuống 6 giờ của Mai Hóa
//     (mẫu lũ nhỏ, chỉ khoảng 240 giờ, nên chỉ hiệu chỉnh 3 tham số mỗi hạn để tránh quá khớp).
// Mưa: TB 4 trạm lưu vực Mai Hóa; mưa dự báo = ECMWF IFS (Open-Meteo) CÓ NHÃN GIỜ, tính từ giờ phát tin (T+1..T+L) nhân hệ số hiệu chỉnh.
// Kiểm chứng chéo bỏ-một-năm (mưa dự báo hoàn hảo): ngày thường sai số TB 0,070/0,074/0,075/0,074m, lũ 0,106/0,132/0,130/0,145m cho +6/+12/+18/+24h.
// Tính lại hệ số mỗi năm một lần: tinh-he-so-tanmy.py (gói tanmy-dieu-hoa, không nằm trong repo).
// HAI PHƯƠNG ÁN: (1) có số liệu quan trắc Tân Mỹ (như trên); (2) KHÔNG có số liệu Tân Mỹ (hỏng máy, hoặc ?khongTanMy=1):
//   chỉ dùng triều điều hòa + mùa vụ + mực nước Mai Hóa + mưa lưu vực. Vì không biết mực nền hiện tại của Tân Mỹ (đổi theo năm/mùa)
//   nên sai số lớn hơn nhiều: ngày thường ~0,25m, lũ ~0,32-0,42m (kiểm chứng bỏ-một-năm). Chỉ mang tính tham khảo.
// Số liệu lỗi (ngoài -1,6 đến 3,0m, hoặc từ 8 giờ liên tiếp không đổi) bị loại như khi huấn luyện.

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 60;
const LEADS = [6, 12, 18, 24];
const NGUONG_LU_MAI_HOA = 5.0; // BĐ II Mai Hóa
const NGUONG = { bd1: 1.1, bd2: 1.3, bd3: 1.5 }; // BĐ Tân Mỹ

const TANMY = { matram: '555800', ten_table: 'mucnuoc_oday' };
const MAIHOA = { matram: '555400', ten_table: 'mucnuoc_oday' };
const RAIN_STATIONS = [
  { matram: '559100', ten_table: 'mua_oday_domua', lat: 17.8086, lng: 105.969 },
  { matram: '557500', ten_table: 'mua_oday_khituong', lat: 17.8833, lng: 106.017 },
  { matram: '091402', ten_table: 'hanquoc_mua', lat: 17.7133, lng: 105.967 },
  { matram: '091401', ten_table: 'hanquoc_mua', lat: 17.8914, lng: 105.8 },
];

// ===== HÀM ĐIỀU HÒA: hằng số và hệ số sinh từ tinh-he-so-tanmy.py (he-so-tanmy.json) =====
// Gốc thời gian: 00h 01/01/2000 giờ VN.
const PHAN_TRIEU = [
  { ten: 'Q1', w: 13.3986609, a: 0.004647482307868787, b: -0.06243577548479699 },
  { ten: 'O1', w: 13.9430356, a: -0.2785558539103192, b: 0.02286464119295086 },
  { ten: 'P1', w: 14.9589314, a: 0.06513139775852332, b: 0.00776854942780461 },
  { ten: 'K1', w: 15.0410686, a: 0.19656894312869982, b: -0.0304998382916018 },
  { ten: 'N2', w: 28.4397295, a: -0.01628396242518389, b: 0.031327396304807756 },
  { ten: 'M2', w: 28.9841042, a: 0.1804828256700295, b: 0.05718817539593583 },
  { ten: 'S2', w: 30.0, a: -0.04818007874951229, b: -0.02089973439135741 },
  { ten: 'K2', w: 30.0821373, a: 0.02972990500939814, b: 0.01708344661819644 },
  { ten: 'M4', w: 57.9682084, a: -0.001772644122731337, b: 0.003675334702729671 },
  { ten: 'MS4', w: 58.9841042, a: 0.0014530760785774503, b: -0.0012959235258616863 },
  { ten: 'MN4', w: 57.4238337, a: -0.0011522799657494652, b: -0.0009421022423423538 },
  { ten: 'M6', w: 86.9523127, a: -0.004490750941234361, b: 0.0004684692467348026 },
];
// thuong_*: hồi quy theo DAC_TRUNG; lu_*: hiệu chỉnh cộng thêm theo [MH, dMH6] khi Mai Hóa >= BĐ II
const HE_SO = {
  thuong_day_du: {
    6: { intercept: 0.0038037856390157653, Hf: 1.0038025899072593, zt: 2.878189240535878, r0: 0.35084997958737146, r3: -0.4278451709812099, r6: -0.4478845054430762, r12: -0.7972092151668582, r24: -0.5814445297772586, qm: -0.0004321441357695843, sm: 0.0019859472423912495 },
    12: { intercept: 0.0059925690182482385, Hf: 1.0044458401222203, zt: 0.5710831340372292, r0: 0.30618750864706284, r3: -0.01209831839309574, r6: -0.21613581158102288, r12: 0.6225842251147184, r24: -0.30981601832555844, qm: -0.0008351820339183877, sm: 0.0018061645672665817 },
    18: { intercept: 0.006888936313471639, Hf: 1.003625656306172, zt: 0.24611848176659204, r0: 0.19135422936626342, r3: -0.253128649288336, r6: 0.8473267063539053, r12: 0.02717410446292344, r24: -0.10521511235784296, qm: -0.00109477027672746, sm: 0.001639635488878846 },
    24: { intercept: 0.00781747255676954, Hf: 1.0014972539034943, zt: 0.060967274680463666, r0: 0.6392383040812921, r3: 0.3138944384178268, r6: -0.07212346009182459, r12: 0.03069367149072222, r24: -0.021567146180251767, qm: -0.0011600531345860468, sm: 0.001212890792572529 },
  },
  thuong_rut_gon: {
    6: { intercept: 0.00252045478407466, Hf: 1.0059645433226978, zt: 0.8865515726773928, r0: 0.08686422802669444, qm: -0.0003634525149169757, sm: 0.0022369884630866694 },
    12: { intercept: 0.003983593573543838, Hf: 1.0074879470503009, zt: 0.9738719279584767, r0: -0.011558709073728997, qm: -0.0007792405989342499, sm: 0.002176751963566045 },
    18: { intercept: 0.005040778965258568, Hf: 1.0079603975353542, zt: 1.0337876280201292, r0: -0.0817812993769097, qm: -0.0011654706465705775, sm: 0.0021316445438592244 },
    24: { intercept: 0.007515615390319535, Hf: 1.0008143952813426, zt: 0.16785275852003428, r0: 0.783317552926506, qm: -0.0011401068455739768, sm: 0.0012319888038852939 },
  },
  lu_day_du: {
    6: { intercept: 0.013343073644214136, MH: -0.011918557386257087, dMH6: 0.07188725070309936 },
    12: { intercept: 0.19404879367941838, MH: -0.04299287262060066, dMH6: 0.0548940228603262 },
    18: { intercept: 0.36681957308857427, MH: -0.07121005889565062, dMH6: 0.030564527813642616 },
    24: { intercept: 0.5088022743652407, MH: -0.08944700094378709, dMH6: 0.00408712039709254 },
  },
  lu_rut_gon: {
    6: { intercept: -0.027226351035526543, MH: -0.009631558900128836, dMH6: 0.054661528851591264 },
    12: { intercept: 0.2056995184357312, MH: -0.048679916507907636, dMH6: 0.07013844188603167 },
    18: { intercept: 0.3241305180104356, MH: -0.06818749864047215, dMH6: 0.05876581249067237 },
    24: { intercept: 0.5093821378124512, MH: -0.09001434643586757, dMH6: 0.003610863606566715 },
  },
};
const DAC_TRUNG = {
  thuong_day_du: ['Hf', 'zt', 'r0', 'r3', 'r6', 'r12', 'r24', 'qm', 'sm'],
  thuong_rut_gon: ['Hf', 'zt', 'r0', 'qm', 'sm'],
  lu: ['MH', 'dMH6'],
};
// PHƯƠNG ÁN 2 (không có số liệu Tân Mỹ): triều điều hòa + mùa vụ + Mai Hóa + mưa
const HE_SO_KHONG_TM = {
  6: { intercept: 0.04159916750684755, Hf: 1.0256053778171723, sin1: -0.050463997872336984, cos1: 0.02896185851233565, sin2: -0.06478724079953353, cos2: -0.020688621246345573, MH: 0.2279400586097246, dMH6: -0.06256359507931054, MH2: -0.01967427318134511, lnMH: -0.03313857387920814, qm: 0.00015376388832263524, sm: 0.004326007774247563 },
  12: { intercept: 0.037241279112528405, Hf: 0.8566996739922689, sin1: -0.04036421221017015, cos1: 0.021321463849735493, sin2: -0.059602294795079974, cos2: -0.016490639251543777, MH: 0.2805704702111197, dMH6: -0.12039723459699005, MH2: -0.028571168427352845, lnMH: -0.03084589195607486, qm: -0.0003805276953255427, sm: 0.0033364496311920296 },
  18: { intercept: 0.10222884332970109, Hf: 0.8678993301978224, sin1: -0.04463518788159602, cos1: 0.02370501977018179, sin2: -0.061994136470605095, cos2: -0.019211067728050667, MH: 0.1835054796153335, dMH6: -0.04282371442903453, MH2: -0.015974427831960836, lnMH: -0.00200441444412781, qm: -0.0005915988632792999, sm: 0.0027440903007674767 },
  24: { intercept: 0.022655610935226018, Hf: 1.0517308032634538, sin1: -0.04918165302104968, cos1: 0.029179819466593634, sin2: -0.06351715416799009, cos2: -0.02095925915892183, MH: 0.24344055280923804, dMH6: -0.06597305558755394, MH2: -0.024559435543531183, lnMH: -0.0408995089387248, qm: -0.0005408818245555511, sm: 0.002404128199549404 },
};
const DAC_TRUNG_KHONG_TM = ["Hf", "sin1", "cos1", "sin2", "cos2", "MH", "dMH6", "MH2", "lnMH", "qm", "sm"];
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
function loaiLoi(series) {
  const ok = series.map((p) => p.v >= -1.6 && p.v <= 3.0);
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

// Mưa dự báo ECMWF có nhãn giờ (Open-Meteo: chuỗi giờ bắt đầu từ 00h hôm nay, nhãn T = mưa của giờ trước T), TB 4 trạm lưu vực Mai Hóa.
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
  const dongBo = valid.filter((v) => v.time[0] === goc);
  const n = Math.min(...dongBo.map((v) => v.pr.length));
  const mua = Array.from({ length: n }, (_, i) => dongBo.reduce((a, v) => a + (v.pr[i] || 0), 0) / dongBo.length);
  const gio0 = Math.round((Date.parse(`${goc}:00Z`) - 7 * 3600000) / 3600000);
  return { gio0, mua };
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
// Thủy triều điều hòa tại Tân Mỹ (m, quanh mực nền) tại thời điểm tMs (ms UTC thật)
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
    const epKhongTanMy = url.searchParams.get('khongTanMy') === '1'; // ép dùng phương án 2 (thử)
    const epKhongMaiHoa = url.searchParams.get('khongMaiHoa') === '1'; // chỉ để thử/so sánh

    const [tmRaw, mhRaw, ...rainArr] = await Promise.all([
      fetchKttvSeries(TANMY, '0'),
      fetchKttvSeries(MAIHOA, '0'),
      ...RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1')),
    ]);
    const tmSeries = loaiLoi(tmRaw); const mhSeries = mhRaw.filter((p) => p.v > -1 && p.v < 15);

    // Chọn phương án: 1 = có số liệu Tân Mỹ đủ dùng; 2 = không có (hỏng máy / cũ / thiếu)
    let lyDoKhongTM = epKhongTanMy ? 'chế độ thử: bỏ qua số liệu Tân Mỹ' : null;
    let current = null; let Tc = null; let tm = null;
    let r0 = null; let zt = 0; let r3 = null; let r6 = null; let r12 = null; let r24 = null; let dayDu = false;
    if (!lyDoKhongTM) {
      if (tmSeries.length === 0) lyDoKhongTM = tmSeries.lyDo || tmRaw.lyDo || 'không có số liệu Tân Mỹ';
      else {
        current = tmSeries[tmSeries.length - 1];
        const T1 = Math.round(current.t / 3600000);
        if (Math.abs(current.t - T1 * 3600000) > 30 * 60000 || Date.now() - current.t > 6 * 3600000) {
          const nghiLoi = tmRaw.length > 0 && tmRaw[tmRaw.length - 1].t > current.t;
          lyDoKhongTM = `số liệu Tân Mỹ hợp lệ mới nhất là lúc ${gioVN(current.t)}, đã cũ hoặc lệch giờ${nghiLoi ? ' (các số liệu sau đó nghi là lỗi cảm biến nên bị loại)' : ''}`;
        } else {
          Tc = T1; tm = theoGioMap(tmSeries);
          const phanDu = (lag) => { const v = tm.get(Tc - lag); return v == null ? null : v - trieuDieuHoa((Tc - lag) * 3600000); };
          r0 = phanDu(0);
          const cuaSo = [];
          for (let k = 0; k < 24; k++) { const r = phanDu(k); if (r != null) cuaSo.push(r); }
          if (r0 == null) lyDoKhongTM = `Tân Mỹ chưa có số liệu đúng giờ ${gioVN(Tc * 3600000)}`;
          else if (cuaSo.length < 12) lyDoKhongTM = `Tân Mỹ chỉ có ${cuaSo.length}/24 số liệu giờ trong 24 giờ qua (cần ít nhất 12)`;
          else {
            zt = cuaSo.reduce((a, b) => a + b, 0) / cuaSo.length;
            r3 = phanDu(3); r6 = phanDu(6); r12 = phanDu(12); r24 = phanDu(24);
            dayDu = [r3, r6, r12, r24].every((v) => v != null);
          }
        }
      }
    }
    const coTM = !lyDoKhongTM;
    const tang = dayDu ? 'day_du' : 'rut_gon';
    const mh = theoGioMap(mhSeries);
    if (!coTM) {
      // Phương án 2: giờ phát tin theo số liệu Mai Hóa mới nhất
      if (mhSeries.length === 0) {
        return json({ available: false, reason: `Không có số liệu Tân Mỹ (${lyDoKhongTM}) và cũng không lấy được mực nước Mai Hóa nên không dự báo được` });
      }
      const cm = mhSeries[mhSeries.length - 1];
      Tc = Math.round(cm.t / 3600000);
      if (Math.abs(cm.t - Tc * 3600000) > 30 * 60000 || Date.now() - cm.t > 6 * 3600000) {
        return json({ available: false, reason: `Không có số liệu Tân Mỹ (${lyDoKhongTM}); số liệu Mai Hóa mới nhất là lúc ${gioVN(cm.t)}, đã cũ hoặc lệch giờ — không dự báo.` });
      }
    }
    const mhNow = epKhongMaiHoa ? null : (mh.get(Tc) ?? mh.get(Tc - 1) ?? null);
    const mh6 = epKhongMaiHoa ? null : (mh.get(Tc - 6) ?? mh.get(Tc - 7) ?? null);
    if (!coTM && (mhNow == null || mh6 == null)) {
      return json({ available: false, reason: `Không có số liệu Tân Mỹ (${lyDoKhongTM}) và Mai Hóa thiếu số liệu hiện tại hoặc 6 giờ trước nên không dự báo được` });
    }
    const cheLu = coTM && mhNow != null && mh6 != null && mhNow >= NGUONG_LU_MAI_HOA;
    const luMaiHoa = mhNow != null && mhNow >= NGUONG_LU_MAI_HOA;

    // mưa lưu vực Mai Hóa: đã qua 24h và 6/12/18/24h
    const rainMH = gomTheoGio(rainArr);
    const qm = sumRainInWindow(rainMH, Tc * 3600000, 24);
    const mucMuaDaQua = Object.fromEntries(LEADS.map((L) => [L, r1(sumRainInWindow(rainMH, Tc * 3600000, L))]));

    // mưa dự báo T+1..T+L
    const fc = await fetchForecastRainTimed();
    const mucMuaDuBao = {}; const sm = {}; let thieuMuaDuBao = false;
    for (const L of LEADS) {
      const g = fc ? tongSau(fc.mua, fc.gio0, Tc, L) : null;
      if (g == null) { thieuMuaDuBao = true; sm[L] = 0; mucMuaDuBao[L] = { goc: null, sauHieuChinh: null }; }
      else { sm[L] = g * heSoHieuChinh; mucMuaDuBao[L] = { goc: r1(g), sauHieuChinh: r1(g * heSoHieuChinh) }; }
    }

    const duBaoRaw = {}; const phanDuMoc = [coTM ? r0 : null];
    const doy = (() => { const d = new Date(Tc * 3600000 + 7 * 3600000); return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000); })();
    const w1 = (doy / 365.25) * 2 * Math.PI;
    for (const L of LEADS) {
      const Hf = trieuDieuHoa((Tc + L) * 3600000);
      let y;
      if (coTM) {
        const c = HE_SO[`thuong_${tang}`][L];
        const x = { Hf, zt, r0, r3, r6, r12, r24, qm, sm: sm[L] };
        y = c.intercept;
        for (const ten of DAC_TRUNG[`thuong_${tang}`]) y += c[ten] * x[ten];
        if (cheLu) {
          const h = HE_SO[`lu_${tang}`][L]; const xl = { MH: mhNow, dMH6: mhNow - mh6 };
          y += h.intercept;
          for (const ten of DAC_TRUNG.lu) y += h[ten] * xl[ten];
        }
      } else {
        const c = HE_SO_KHONG_TM[L];
        const x = { Hf, sin1: Math.sin(w1), cos1: Math.cos(w1), sin2: Math.sin(2 * w1), cos2: Math.cos(2 * w1), MH: mhNow, dMH6: mhNow - mh6,
          MH2: Math.min(mhNow, 8) ** 2, lnMH: Math.log(Math.max(mhNow, 0.05)), qm, sm: sm[L] };
        y = c.intercept;
        for (const ten of DAC_TRUNG_KHONG_TM) y += c[ten] * x[ten];
      }
      duBaoRaw[L] = y;
      phanDuMoc.push(y - Hf);
    }
    if (phanDuMoc[0] == null) phanDuMoc[0] = phanDuMoc[1]; // phương án 2: không có phần dư thực đo, giữ phần dư của mốc +6h

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
      phuongAn: coTM ? 'co_tanmy' : 'khong_tanmy',
      lyDoKhongTanMy: lyDoKhongTM,
      cheDo: !coTM ? 'khong_tanmy' : (cheLu ? 'lu_mai_hoa' : 'dieu_hoa'),
      luMaiHoa,
      tang: coTM ? tang : null,
      thoiDiemHienTai: Tc * 3600000,
      tanmyHienTai: coTM ? r2(current.v) : null,
      maihoaHienTai: mhNow != null ? r2(mhNow) : null,
      thieuMaiHoa: mhNow == null,
      nguongLuMaiHoa: NGUONG_LU_MAI_HOA,
      nguong: NGUONG,
      rainDaQua24h: r1(qm),
      mucMuaDaQua,
      heSoHieuChinh,
      mucMuaDuBao,
      thieuMuaDuBao,
      duBaoTheoMoc,
      duongTrieu: duongTrieu.map((p) => ({ h: p.h, v: r2(p.v) })),
      trieuCao: diem(cao),
      trieuThap: diem(thap),
      nhanDinhDinh: nhanDienDinh(coTM ? r2(current.v) : r2(duongTrieu[0].v), duBaoTheoMoc),
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
