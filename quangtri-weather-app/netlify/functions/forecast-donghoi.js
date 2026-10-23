// netlify/functions/forecast-donghoi.js
//
// Dự báo mực nước 6/12/18/24h cho trạm TV Đồng Hới (gần cửa biển, lưu vực sông Nhật Lệ).
// Đồng Hới chịu triều mạnh nên dùng HÀM ĐIỀU HÒA (12 phân triều, dựng từ chính số liệu giờ Đồng Hới 2006-2025):
//   mực nước tương lai = triều điều hòa tại giờ đích + phần dư thực đo gần nhất (0/3/6/12/24h trước, TB 24h) + mưa lưu vực.
// Hai chế độ (hồi quy riêng):
//   - NGÀY THƯỜNG: Lệ Thủy dưới BĐ II (2,2m), hoặc thiếu số liệu Lệ Thủy.
//   - LŨ: Lệ Thủy từ BĐ II (2,2m) trở lên: thêm mực nước Lệ Thủy và cường suất lên/xuống 6 giờ của Lệ Thủy (quan hệ Lệ Thủy - Đồng Hới).
// Mưa: vùng thấp = TB 3 trạm (Đồng Hới, Lệ Thủy, Kiến Giang), vùng núi = Trường Sơn; mưa dự báo = ECMWF IFS (Open-Meteo)
// CÓ NHÃN GIỜ, tính từ giờ phát tin (T+1..T+L) nhân hệ số hiệu chỉnh.
// Kiểm chứng chéo bỏ-một-năm 2013-2025 (mưa dự báo hoàn hảo): ngày thường sai số TB 0,058/0,064/0,068/0,068m,
// lũ 0,082/0,112/0,127/0,116m cho +6/+12/+18/+24h. Tính lại hệ số mỗi năm một lần: tinh-he-so-donghoi.py (gói donghoi-dieu-hoa, không nằm trong repo).
// Số liệu lỗi (ngoài -1,6 đến 4m, hoặc từ 8 giờ liên tiếp không đổi — máy treo) bị loại như khi huấn luyện.

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 60;
const LEADS = [6, 12, 18, 24];
const NGUONG_LU_LE_THUY = 2.2; // BĐ II Lệ Thủy
const NGUONG = { bd1: 1, bd2: 1.5, bd3: 2 }; // BĐ Đồng Hới

const DONGHOI = { matram: '557600', ten_table: 'mucnuoc_oday' };
const LETHUY = { matram: '556100', ten_table: 'mucnuoc_oday' };
const RAIN_STATIONS = [
  { matram: '557600', ten_table: 'mua_oday_thuyvan', lat: 17.472, lng: 106.626, vung: 'thap' },  // Đồng Hới
  { matram: '556100', ten_table: 'mua_oday_khituong', lat: 17.217, lng: 106.783, vung: 'thap' }, // Lệ Thủy
  { matram: '555500', ten_table: 'mua_oday_thuyvan', lat: 17.117, lng: 106.75, vung: 'thap' },   // Kiến Giang
  { matram: '559200', ten_table: 'mua_oday_thuyvan', lat: 17.2169, lng: 106.454, vung: 'nui' },  // Trường Sơn
];

// ===== HÀM ĐIỀU HÒA: hằng số và hệ số sinh từ tinh-he-so-donghoi.py (he-so-donghoi.json) =====
// Gốc thời gian: 00h 01/01/2000 giờ VN.
const PHAN_TRIEU = [
  { ten: 'Q1', w: 13.3986609, a: 0.06108161626734751, b: 0.00633361886453393 },
  { ten: 'O1', w: 13.9430356, a: 0.018479255580369173, b: -0.27011449184742653 },
  { ten: 'P1', w: 14.9589314, a: -0.020895402181779404, b: 0.05705037569228791 },
  { ten: 'K1', w: 15.0410686, a: -0.024745651876269453, b: 0.18234349487731102 },
  { ten: 'N2', w: 28.4397295, a: 0.027923605429160794, b: -0.025599585596092444 },
  { ten: 'M2', w: 28.9841042, a: -0.14508778481274873, b: -0.14100812636366475 },
  { ten: 'S2', w: 30.0, a: 0.02424411159308659, b: 0.04562675742796031 },
  { ten: 'K2', w: 30.0821373, a: -0.015493685315490464, b: -0.029407781412428037 },
  { ten: 'M4', w: 57.9682084, a: -0.002884532517887808, b: -0.0024020478742876766 },
  { ten: 'MS4', w: 58.9841042, a: 0.001068556201079077, b: 0.002198739411197655 },
  { ten: 'MN4', w: 57.4238337, a: 0.0011613732614379883, b: -0.0006317324923639432 },
  { ten: 'M6', w: 86.9523127, a: 0.0037223698628540388, b: 0.002036360377152038 },
];
const HE_SO = {
  thuong_day_du: {
    6: { intercept: 0.002903697292252516, Hf: 1.0020566197869982, zt: 2.6034851446462497, r0: 0.4739626530014406, r3: -0.361260239180132, r6: -0.37733584819919874, r12: -0.8055165459937211, r24: -0.5965838976702665, qthap: -3.670797532044937e-05, sthap: 0.0013929210886785759, qnui: 7.212564563149621e-05, snui: 0.0012677513712450945 },
    12: { intercept: 0.0040693708818815, Hf: 1.0053490855903704, zt: 0.5811054063940732, r0: 0.4728473040903948, r3: -0.028377064713656135, r6: -0.24818676362680886, r12: 0.47279811016769197, r24: -0.34887895093597227, qthap: -9.698072640240578e-05, sthap: 0.0013954923290904787, qnui: -0.0002663906291313237, snui: 0.0016434184272386394 },
    18: { intercept: 0.004885399031951762, Hf: 1.0018355298607045, zt: 0.3663560096612235, r0: 0.3381363459960694, r3: -0.3830743046086525, r6: 0.7735806998850057, r12: -0.03506563294489012, r24: -0.1896956480113388, qthap: -0.00011553208534219408, sthap: 0.0015116400624756799, qnui: -0.0005973285983675978, snui: 0.0016173452714349295 },
    24: { intercept: 0.005919673364202869, Hf: 1.0013362224941535, zt: 0.1341971302483607, r0: 0.6390752462967898, r3: 0.2804837136405279, r6: -0.10204035393073546, r12: 0.01984225153759746, r24: -0.10781350776690857, qthap: -0.00017290008740523675, sthap: 0.0012871663127099941, qnui: -0.0008933842021893601, snui: 0.0013930746398147377 },
  },
  thuong_rut_gon: {
    6: { intercept: 0.0010812684278393998, Hf: 1.0046993822808248, zt: 0.6600253117515731, r0: 0.26294781725623234, qthap: 0.00012181002735238971, sthap: 0.0017824795426582085, qnui: 0.00022459822727621283, snui: 0.001559560612948841 },
    12: { intercept: 0.0008425753507786707, Hf: 1.007503664122381, zt: 0.5869162502544961, r0: 0.31176890131023927, qthap: 7.118264164303781e-05, sthap: 0.0014769048706226656, qnui: -9.018900183644842e-05, snui: 0.001719133624821949 },
    18: { intercept: 0.0020295784087530173, Hf: 1.0036726718038957, zt: 0.774249701462918, r0: 0.07711234647758405, qthap: 0.00011677239553954364, sthap: 0.0016441298357252527, qnui: -0.00033431164104505716, snui: 0.0017410858850683839 },
    24: { intercept: 0.004729803298614062, Hf: 1.0017461325952064, zt: 0.11512618948610444, r0: 0.7447768598265783, qthap: -9.076218924444829e-05, sthap: 0.0013104870373171654, qnui: -0.0008044712083569376, snui: 0.0014114844341734337 },
  },
  lu_day_du: {
    6: { intercept: -0.016257626152172806, Hf: 0.763984934167376, zt: 0.8556038699482772, r0: 0.6229001395919012, r3: -0.315122354076908, r6: 0.13140115211307593, r12: -0.3163462730591856, r24: -0.18748933642020058, qthap: -3.4783774718405796e-05, sthap: 0.0007872363300583603, qnui: 9.77018885079062e-05, snui: 0.002346819464301071, LT: 0.04562123943133808, dLT6: 0.0941504376017051 },
    12: { intercept: -0.0252222093974617, Hf: 0.7365701395150571, zt: 0.5533761680620298, r0: 0.4822982190332461, r3: -0.027550372664175028, r6: -0.14700752816050097, r12: -0.07174335216331994, r24: -0.12656762061561674, qthap: 3.2148411819987127e-06, sthap: 0.0011552483456568866, qnui: 2.4645563013111595e-06, snui: 0.0021831949210929656, LT: 0.06625733595963651, dLT6: 0.03703508958599007 },
    18: { intercept: -0.007697108439766027, Hf: 0.8116877448440241, zt: 0.5869570367394936, r0: 0.42458977583607893, r3: -0.4082633289489705, r6: 0.2298585068765863, r12: -0.1807570947831806, r24: -0.11429223258423461, qthap: 2.3146990412068024e-05, sthap: 0.001183473794841967, qnui: -6.954841937172939e-05, snui: 0.0022592023770682643, LT: 0.078421711706618, dLT6: -0.011305720187302283 },
    24: { intercept: 0.03299057366922623, Hf: 1.0094314069306238, zt: 0.10802045620780615, r0: 0.503193866441969, r3: 0.17519837343451408, r6: -0.1787855704404071, r12: -0.035745963710254174, r24: 0.006284315546351797, qthap: -2.8535437561722346e-05, sthap: 0.0008571207081996464, qnui: -0.00038226618104969415, snui: 0.002124452095351771, LT: 0.04610674217697084, dLT6: -0.010286230997525628 },
  },
  lu_rut_gon: {
    6: { intercept: -0.012474783501804747, Hf: 0.7201776956494937, zt: 0.2535998878560221, r0: 0.5305392222546998, qthap: 4.20540268813306e-05, sthap: 0.0008259317219360849, qnui: 0.00019271222980364188, snui: 0.002425804675576773, LT: 0.03938333513076668, dLT6: 0.10724109290683051 },
    12: { intercept: -0.03269937391379254, Hf: 0.7316998732957435, zt: 0.20368171394865317, r0: 0.4577993835263302, qthap: 3.8458150306229855e-05, sthap: 0.0011487995084018619, qnui: 4.8774175093036076e-05, snui: 0.0022277312507733155, LT: 0.0660280292717599, dLT6: 0.040928297253235255 },
    18: { intercept: -0.009097106215769942, Hf: 0.7904425061127112, zt: 0.2752066481226645, r0: 0.25739052064513535, qthap: 7.520027501812993e-05, sthap: 0.001204563750299283, qnui: -8.388783351144417e-06, snui: 0.002282625527527466, LT: 0.0759227293509132, dLT6: 0.0047754637953118725 },
    24: { intercept: 0.031300761059938356, Hf: 0.9915786641351062, zt: 0.0038096399348378075, r0: 0.5710891341574975, qthap: -5.6945140056844273e-05, sthap: 0.0008743797769712841, qnui: -0.00040583140030523026, snui: 0.0021241685971554645, LT: 0.049544292263500565, dLT6: -0.01633033424584388 },
  },
};
const DAC_TRUNG = {
  thuong_day_du: ['Hf', 'zt', 'r0', 'r3', 'r6', 'r12', 'r24', 'qthap', 'sthap', 'qnui', 'snui'],
  thuong_rut_gon: ['Hf', 'zt', 'r0', 'qthap', 'sthap', 'qnui', 'snui'],
  lu_day_du: ['Hf', 'zt', 'r0', 'r3', 'r6', 'r12', 'r24', 'qthap', 'sthap', 'qnui', 'snui', 'LT', 'dLT6'],
  lu_rut_gon: ['Hf', 'zt', 'r0', 'qthap', 'sthap', 'qnui', 'snui', 'LT', 'dLT6'],
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
function loaiLoi(series) {
  const ok = series.map((p) => p.v >= -1.6 && p.v <= 4);
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
// Thủy triều điều hòa tại Đồng Hới (m, quanh mực nền) tại thời điểm tMs (ms UTC thật)
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
    const epKhongLeThuy = url.searchParams.get('khongLeThuy') === '1'; // chỉ để thử/so sánh

    const [dhRaw, ltRaw, ...rainArr] = await Promise.all([
      fetchKttvSeries(DONGHOI, '0'),
      fetchKttvSeries(LETHUY, '0'),
      ...RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1')),
    ]);
    const dhSeries = loaiLoi(dhRaw); const ltSeries = loaiLoi(ltRaw);
    if (dhSeries.length === 0) {
      return json({ available: false, reason: `Không lấy được mực nước Đồng Hới (${dhSeries.lyDo || dhRaw.lyDo || 'không có số liệu'})` });
    }
    const current = dhSeries[dhSeries.length - 1];
    const Tc = Math.round(current.t / 3600000); // chỉ số giờ phát tin (UTC thật)
    if (Math.abs(current.t - Tc * 3600000) > 30 * 60000 || Date.now() - current.t > 6 * 3600000) {
      const nghiLoi = dhRaw.length > 0 && dhRaw[dhRaw.length - 1].t > current.t;
      return json({ available: false, reason: `Số liệu Đồng Hới hợp lệ mới nhất là lúc ${gioVN(current.t)}, đã cũ hoặc lệch giờ — không dự báo.${nghiLoi ? ' Các số liệu sau đó nghi bị lỗi (ngoài khoảng hợp lý hoặc máy treo).' : ''}` });
    }
    const dh = theoGioMap(dhSeries);
    const phanDu = (lag) => {
      const v = dh.get(Tc - lag);
      return v == null ? null : v - trieuDieuHoa((Tc - lag) * 3600000);
    };
    const r0 = phanDu(0);
    if (r0 == null) return json({ available: false, reason: `Đồng Hới chưa có số liệu đúng giờ ${gioVN(Tc * 3600000)}` });
    const cuaSo = [];
    for (let k = 0; k < 24; k++) { const r = phanDu(k); if (r != null) cuaSo.push(r); }
    if (cuaSo.length < 12) return json({ available: false, reason: `Đồng Hới chỉ có ${cuaSo.length}/24 số liệu giờ trong 24 giờ qua (cần ít nhất 12)` });
    const zt = cuaSo.reduce((a, b) => a + b, 0) / cuaSo.length;
    const r3 = phanDu(3); const r6 = phanDu(6); const r12 = phanDu(12); const r24 = phanDu(24);
    const dayDu = [r3, r6, r12, r24].every((v) => v != null);

    // Lệ Thủy: chế độ lũ khi từ BĐ II và có đủ số liệu hiện tại + 6 giờ trước
    const lt = theoGioMap(ltSeries);
    const ltNow = epKhongLeThuy ? null : (lt.get(Tc) ?? lt.get(Tc - 1) ?? null);
    const lt6 = epKhongLeThuy ? null : (lt.get(Tc - 6) ?? lt.get(Tc - 7) ?? null);
    const cheLu = ltNow != null && lt6 != null && ltNow >= NGUONG_LU_LE_THUY;
    const che = cheLu ? 'lu' : 'thuong';
    const tang = dayDu ? 'day_du' : 'rut_gon';
    const khoaHeSo = `${che}_${tang}`;

    // mưa đã qua 24h (vùng thấp, vùng núi) và 6/12/18/24h
    const rainThap = gomTheoGio(rainArr.slice(0, 3)); const rainNui = gomTheoGio(rainArr.slice(3));
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
      const x = { Hf, zt, r0, r3, r6, r12, r24, qthap, qnui, sthap: sthap[L], snui: snui[L], LT: ltNow, dLT6: cheLu ? ltNow - lt6 : 0 };
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
      cheDo: cheLu ? 'lu_le_thuy' : 'dieu_hoa',
      tang,
      thoiDiemHienTai: Tc * 3600000,
      donghoiHienTai: r2(current.v),
      lethuyHienTai: ltNow != null ? r2(ltNow) : null,
      thieuLeThuy: ltNow == null,
      nguongLuLeThuy: NGUONG_LU_LE_THUY,
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
