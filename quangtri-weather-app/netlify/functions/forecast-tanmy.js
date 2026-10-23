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
// Kiểm chứng chéo bỏ-một-năm (mưa dự báo hoàn hảo): ngày thường sai số TB 0,070/0,074/0,075/0,073m, lũ 0,116/0,137/0,131/0,122m cho +6/+12/+18/+24h.
// Tính lại hệ số mỗi năm một lần: tinh-he-so-tanmy.py (gói tanmy-dieu-hoa, không nằm trong repo).
// BA PHƯƠNG ÁN, tự chọn theo số liệu đang có:
//   (1) có số liệu quan trắc Tân Mỹ (như trên);
//   (2) Tân Mỹ hỏng/mất số liệu: ƯỚC Tân Mỹ từ mực nước thực đo Đồng Hới (+ Mai Hóa) bằng hồi quy các năm 2019-2025, rồi coi số ước là
//       thực đo để chạy như phương án 1. Sai số dự báo ~0,14m ngày thường, ~0,3m lũ (kiểm chứng bỏ-một-năm);
//   (3) cả Tân Mỹ lẫn Đồng Hới đều mất: triều điều hòa + mùa vụ + Mai Hóa + mưa, sai số ~0,25m ngày thường, ~0,3-0,4m lũ.
//   ?khongTanMy=1 ép bỏ Tân Mỹ; ?khongDongHoi=1 ép bỏ Đồng Hới (chỉ để thử).
// Nhãn giờ: số liệu huấn luyện Tân Mỹ lấy từ Neon có nhãn UTC đã đổi về giờ VN (+7h) cho khớp KTTV/Mai Hóa/mưa.
// Số liệu lỗi (ngoài -1,6 đến 3,0m, hoặc từ 8 giờ liên tiếp không đổi) bị loại như khi huấn luyện.

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 60;
const LEADS = [6, 12, 18, 24];
const NGUONG_LU_MAI_HOA = 5.0; // BĐ II Mai Hóa
const NGUONG = { bd1: 1.1, bd2: 1.3, bd3: 1.5 }; // BĐ Tân Mỹ

const TANMY = { matram: '555800', ten_table: 'mucnuoc_oday' };
const DONGHOI = { matram: '557600', ten_table: 'mucnuoc_oday' };
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
  { ten: 'Q1', w: 13.3986609, a: 0.06202835441721894, b: 0.008893740910182659 },
  { ten: 'O1', w: 13.9430356, a: 0.01413373195329617, b: -0.2791998319698424 },
  { ten: 'P1', w: 14.9589314, a: -0.024085049489941748, b: 0.06095270706714199 },
  { ten: 'K1', w: 15.0410686, a: -0.02235497309653335, b: 0.19768593352781255 },
  { ten: 'N2', w: 28.4397295, a: 0.025671028058174204, b: -0.02425391587593367 },
  { ten: 'M2', w: 28.9841042, a: -0.14404222438508896, b: -0.12293236359631579 },
  { ten: 'S2', w: 30.0, a: 0.0313270353308695, b: 0.04227910731191443 },
  { ten: 'K2', w: 30.0821373, a: -0.016938341511835067, b: -0.029819980367169405 },
  { ten: 'M4', w: 57.9682084, a: -0.003870285863633123, b: 0.001247501585785733 },
  { ten: 'MS4', w: 58.9841042, a: 0.001938621368909911, b: 0.0003981704206526609 },
  { ten: 'MN4', w: 57.4238337, a: -0.00021779663851317059, b: -0.0014331081049441148 },
  { ten: 'M6', w: 86.9523127, a: 0.0020708704009484865, b: 0.0040041275201520305 },
];
// thuong_*: hồi quy theo DAC_TRUNG; lu_*: hiệu chỉnh cộng thêm theo [MH, dMH6] khi Mai Hóa >= BĐ II
const HE_SO = {
  thuong_day_du: {
    6: { intercept: 0.002535599456808374, Hf: 1.0033177033850895, zt: 2.863228038906733, r0: 0.3478242493104387, r3: -0.42425607064593795, r6: -0.44470378577250885, r12: -0.7925332022786999, r24: -0.5787196810033811, qm: -0.0002850631140200165, sm: 0.002365728200626713 },
    12: { intercept: 0.004150704906902643, Hf: 1.0033998486341302, zt: 0.549942633313802, r0: 0.30820434647581996, r3: -0.009404088137515986, r6: -0.20830119599042404, r12: 0.6269888023914078, r24: -0.3098487510288267, qm: -0.0006904780936551969, sm: 0.002175332015337401 },
    18: { intercept: 0.00451792627387927, Hf: 1.0029963288135015, zt: 0.23084117820569744, r0: 0.19755596499784367, r3: -0.2501249306283376, r6: 0.8525430837920883, r12: 0.0292891308113808, r24: -0.11016533584561704, qm: -0.0009959777732847703, sm: 0.002031730184794968 },
    24: { intercept: 0.005169205713311383, Hf: 1.001721245590694, zt: 0.054153818128231085, r0: 0.6450105547486561, r3: 0.3147779476166831, r6: -0.06945184842412785, r12: 0.032463011629284236, r24: -0.028404065376305868, qm: -0.0011793853653021742, sm: 0.0016443957334748 },
  },
  thuong_rut_gon: {
    6: { intercept: 0.0007061359066776248, Hf: 1.0049384150345702, zt: 0.885925791036484, r0: 0.08310658368591031, qm: -0.00023851529296034827, sm: 0.003024659674353174 },
    12: { intercept: 0.0015862376480702423, Hf: 1.0060172843514614, zt: 0.9673410069298448, r0: -0.009883188359164538, qm: -0.0004675014250916673, sm: 0.00240011540476085 },
    18: { intercept: 0.0021905838695362085, Hf: 1.0070474247845052, zt: 1.0215849536016195, r0: -0.07504853284547666, qm: -0.0007823929036037909, sm: 0.0022948891264084805 },
    24: { intercept: 0.0046981277763179004, Hf: 1.001058555214054, zt: 0.16304087583328414, r0: 0.7855991581027109, qm: -0.0011172705713667335, sm: 0.0016495261892691968 },
  },
  lu_day_du: {
    6: { intercept: -0.041688904063387114, MH: 0.002563070032236354, dMH6: 0.07173611790977429 },
    12: { intercept: -0.04670394223145832, MH: -0.0021561942880736875, dMH6: 0.11641262835876277 },
    18: { intercept: 0.1128535776624993, MH: -0.03141051725654214, dMH6: 0.10098508360796353 },
    24: { intercept: 0.3149039012627523, MH: -0.06298337468462903, dMH6: 0.0549656773663019 },
  },
  lu_rut_gon: {
    6: { intercept: 0.03566650212658911, MH: -0.0134914096747246, dMH6: 0.07595246764708485 },
    12: { intercept: 0.03775048833070891, MH: -0.020555588788167864, dMH6: 0.0890883593072373 },
    18: { intercept: 0.13613904739938665, MH: -0.04068759318262563, dMH6: 0.09760806100269662 },
    24: { intercept: 0.28175109750942695, MH: -0.058766234617100295, dMH6: 0.03451141816915806 },
  },
};
const DAC_TRUNG = {
  thuong_day_du: ['Hf', 'zt', 'r0', 'r3', 'r6', 'r12', 'r24', 'qm', 'sm'],
  thuong_rut_gon: ['Hf', 'zt', 'r0', 'qm', 'sm'],
  lu: ['MH', 'dMH6'],
};
// PHƯƠNG ÁN 2 (không có số liệu Tân Mỹ): triều điều hòa + mùa vụ + Mai Hóa + mưa
const HE_SO_KHONG_TM = {
  6: { intercept: 0.024863798687717747, Hf: 1.0741773536779156, sin1: -0.04383110469447914, cos1: 0.02409213073412075, sin2: -0.06206173350153824, cos2: -0.01645006621137781, MH: 0.278840550006828, dMH6: -0.08397789629413906, MH2: -0.023964489098200235, lnMH: -0.038710167012398634, qm: -0.00011339726883177153, sm: 0.004030961653565717 },
  12: { intercept: 0.04246880088880735, Hf: 1.0438345078041986, sin1: -0.046695439342455625, cos1: 0.02737755262053711, sin2: -0.06354175615414197, cos2: -0.01856306587612974, MH: 0.23582418281294437, dMH6: -0.07163863529147502, MH2: -0.020261801717695416, lnMH: -0.03107946910897036, qm: -5.1233012579459185e-05, sm: 0.0028690466804442132 },
  18: { intercept: 0.04598547492558126, Hf: 0.8468001413319463, sin1: -0.03993583208935904, cos1: 0.0227899773356639, sin2: -0.06017410274102697, cos2: -0.015877246031595443, MH: 0.25912982763305276, dMH6: -0.1326595968194283, MH2: -0.025548873614462467, lnMH: -0.02629260234543573, qm: -0.00029452143681599766, sm: 0.00258098356149111 },
  24: { intercept: 0.10015746771673219, Hf: 0.7824051211394241, sin1: -0.034021516381181616, cos1: 0.016159222059319793, sin2: -0.057281139505786824, cos2: -0.014190080714658887, MH: 0.23537099579712586, dMH6: -0.04255937704262535, MH2: -0.023199229833524973, lnMH: 0.0013471906530877285, qm: -0.0009285946789633183, sm: 0.0022679190970718065 },
};
// ƯỚC Tân Mỹ từ Đồng Hới (hồi quy 2019-2025): TM = a + b1*DH(t) + b2*DH(t-1) + b3*MH(t) + b4*min(MH,8)^2
const ANH_XA_DONGHOI = { intercept: -0.06258828794460769, DH: 0.9965772462758623, DH1: -0.12790490847063127, MH: 0.07106993805182439, MH2: -0.018216620485291247 };
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
function loaiLoi(series, cao = 3.0) {
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
    const epKhongDongHoi = url.searchParams.get('khongDongHoi') === '1'; // ép bỏ phương án 2 (thử)
    const epKhongMaiHoa = url.searchParams.get('khongMaiHoa') === '1'; // chỉ để thử/so sánh

    const [tmRaw, mhRaw, dhRaw, ...rainArr] = await Promise.all([
      fetchKttvSeries(TANMY, '0'),
      fetchKttvSeries(MAIHOA, '0'),
      fetchKttvSeries(DONGHOI, '0'),
      ...RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1')),
    ]);
    const tmSeries = loaiLoi(tmRaw); const mhSeries = mhRaw.filter((p) => p.v > -1 && p.v < 15);
    const dhSeries = loaiLoi(dhRaw, 4);
    const mh = theoGioMap(mhSeries);
    const dh = theoGioMap(dhSeries);
    const mhTai = (k) => (epKhongMaiHoa ? null : (mh.get(k) ?? mh.get(k - 1) ?? mh.get(k + 1) ?? null));

    // Từ chuỗi "thực đo" (hoặc ước) của Tân Mỹ tính phần dư so với triều điều hòa
    const tinhPhanDu = (tmMap, Tc) => {
      const phanDu = (lag) => { const v = tmMap.get(Tc - lag); return v == null ? null : v - trieuDieuHoa((Tc - lag) * 3600000); };
      const r0 = phanDu(0);
      if (r0 == null) return { loi: `chưa có số liệu đúng giờ ${gioVN(Tc * 3600000)}` };
      const cuaSo = [];
      for (let k = 0; k < 24; k++) { const r = phanDu(k); if (r != null) cuaSo.push(r); }
      if (cuaSo.length < 12) return { loi: `chỉ có ${cuaSo.length}/24 số liệu giờ trong 24 giờ qua (cần ít nhất 12)` };
      const zt = cuaSo.reduce((x, y) => x + y, 0) / cuaSo.length;
      const r3 = phanDu(3); const r6 = phanDu(6); const r12 = phanDu(12); const r24 = phanDu(24);
      return { r0, zt, r3, r6, r12, r24, dayDu: [r3, r6, r12, r24].every((v) => v != null) };
    };
    const hienHanh = (series, loiRong) => {
      if (series.length === 0) return { loi: series.lyDo || loiRong };
      const cur = series[series.length - 1]; const T1 = Math.round(cur.t / 3600000);
      if (Math.abs(cur.t - T1 * 3600000) > 30 * 60000 || Date.now() - cur.t > 6 * 3600000) {
        return { loi: `số liệu hợp lệ mới nhất là lúc ${gioVN(cur.t)}, đã cũ hoặc lệch giờ` };
      }
      return { cur, Tc: T1 };
    };

    // Phương án 1: có số liệu quan trắc Tân Mỹ
    let phuongAn = 'co_tanmy'; let lyDoKhongTM = epKhongTanMy ? 'chế độ thử: bỏ qua số liệu Tân Mỹ' : null;
    let Tc = null; let current = null; let pd = null;
    if (!lyDoKhongTM) {
      const h1 = hienHanh(tmSeries, 'không có số liệu Tân Mỹ');
      if (h1.loi) lyDoKhongTM = h1.loi;
      else {
        const p1 = tinhPhanDu(theoGioMap(tmSeries), h1.Tc);
        if (p1.loi) lyDoKhongTM = `Tân Mỹ ${p1.loi}`;
        else { Tc = h1.Tc; current = h1.cur; pd = p1; }
      }
    }
    // Phương án 2: ước Tân Mỹ từ Đồng Hới (+ Mai Hóa), coi là thực đo
    let lyDoKhongDH = null; let tmUoc = null;
    if (!pd) {
      phuongAn = 'uoc_tu_donghoi';
      const h2 = epKhongDongHoi ? { loi: 'chế độ thử: bỏ qua số liệu Đồng Hới' } : hienHanh(dhSeries, 'không có số liệu Đồng Hới');
      if (h2.loi) lyDoKhongDH = `Đồng Hới: ${h2.loi}`;
      else {
        tmUoc = new Map();
        for (let k = 0; k <= 30; k++) {
          const t = h2.Tc - k; const d0 = dh.get(t); const d1 = dh.get(t - 1); const m0 = mhTai(t);
          if (d0 == null || d1 == null || m0 == null) continue;
          const A = ANH_XA_DONGHOI;
          tmUoc.set(t, A.intercept + A.DH * d0 + A.DH1 * d1 + A.MH * m0 + A.MH2 * Math.min(m0, 8) ** 2);
        }
        const p2 = tinhPhanDu(tmUoc, h2.Tc);
        if (p2.loi) lyDoKhongDH = `ước Tân Mỹ từ Đồng Hới ${p2.loi}`;
        else { Tc = h2.Tc; pd = p2; current = { v: tmUoc.get(Tc) }; }
      }
    }
    // Phương án 3 (dự phòng cuối): không có Tân Mỹ lẫn Đồng Hới — chỉ triều + mùa vụ + Mai Hóa + mưa
    if (!pd) {
      phuongAn = 'khong_tanmy';
      if (mhSeries.length === 0) {
        return json({ available: false, reason: `Không có số liệu Tân Mỹ (${lyDoKhongTM}), Đồng Hới (${lyDoKhongDH}) và cũng không lấy được mực nước Mai Hóa nên không dự báo được` });
      }
      const cm = mhSeries[mhSeries.length - 1];
      Tc = Math.round(cm.t / 3600000);
      if (Math.abs(cm.t - Tc * 3600000) > 30 * 60000 || Date.now() - cm.t > 6 * 3600000) {
        return json({ available: false, reason: `Không có số liệu Tân Mỹ (${lyDoKhongTM}) và Đồng Hới (${lyDoKhongDH}); số liệu Mai Hóa mới nhất là lúc ${gioVN(cm.t)}, đã cũ hoặc lệch giờ — không dự báo.` });
      }
    }
    const coTM = phuongAn !== 'khong_tanmy'; // có "chuỗi Tân Mỹ" (thực đo hoặc ước) để lấy phần dư
    const { r0 = null, zt = 0, r3 = null, r6 = null, r12 = null, r24 = null, dayDu = false } = pd || {};
    const tang = dayDu ? 'day_du' : 'rut_gon';
    const mhNow = mhTai(Tc);
    const mh6 = epKhongMaiHoa ? null : (mh.get(Tc - 6) ?? mh.get(Tc - 7) ?? null);
    if (!coTM && (mhNow == null || mh6 == null)) {
      return json({ available: false, reason: `Không có số liệu Tân Mỹ (${lyDoKhongTM}) và Đồng Hới (${lyDoKhongDH}); Mai Hóa thiếu số liệu hiện tại hoặc 6 giờ trước nên không dự báo được` });
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
      phuongAn,
      lyDoKhongTanMy: lyDoKhongTM,
      lyDoKhongDongHoi: lyDoKhongDH,
      donghoiHienTai: phuongAn === 'uoc_tu_donghoi' ? (dh.get(Tc) != null ? r2(dh.get(Tc)) : null) : null,
      cheDo: !coTM ? 'khong_tanmy' : (cheLu ? 'lu_mai_hoa' : 'dieu_hoa'),
      luMaiHoa,
      tang: coTM ? tang : null,
      thoiDiemHienTai: Tc * 3600000,
      tanmyHienTai: phuongAn === 'co_tanmy' ? r2(current.v) : null,
      tanmyUocHienTai: phuongAn === 'uoc_tu_donghoi' ? r2(current.v) : null,
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
      nhanDinhDinh: nhanDienDinh(r2(coTM ? current.v : duongTrieu[0].v), duBaoTheoMoc),
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
