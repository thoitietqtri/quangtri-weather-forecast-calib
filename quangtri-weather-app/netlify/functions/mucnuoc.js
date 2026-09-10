// netlify/functions/mucnuoc.js
//
// Lấy mực nước thực đo từ 2 hệ thống — KTTV (API solieu.php, giống mưa nhưng
// ten_table="mucnuoc_oday", tinhtong=0) và VRain (mucnuoc.vrain.vn, HOÀN
// TOÀN KHÁC với VRain đo mưa — tên miền, tài khoản, API riêng).
//
// KHÁC VỚI MƯA: mực nước là giá trị TỨC THỜI, không cộng dồn được. Nên ở
// đây tính "mức thay đổi" (hiện tại - giá trị Nh trước) cho từng thời đoạn,
// thay vì tổng cộng dồn.

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const WINDOWS_H = [1, 3, 6, 12, 24, 48, 72];
const MAX_WINDOW_H = 72;

// ============ 17 trạm KTTV — đã có sẵn matram + toạ độ thật (WGS84) ============
const KTTV_STATIONS = [
  { matram: '559200', name: 'Thủy Văn TĐ Trường Sơn', lat: 17.2169, lng: 106.454 },
  { matram: '557600', name: 'Thủy Văn TĐ Đồng Hới', lat: 17.472, lng: 106.626 },
  { matram: '556100', name: 'Thủy Văn TĐ Lệ Thủy', lat: 17.217, lng: 106.783 },
  { matram: '555900', name: 'Thủy Văn TĐ Tân Lâm', lat: 17.9128, lng: 106.234 },
  { matram: '555800', name: 'Thủy Văn TĐ Tân Mỹ', lat: 17.7075, lng: 106.482 },
  { matram: '555700', name: 'Thủy Văn TĐ Phong Nha', lat: 17.615, lng: 106.316 },
  { matram: '555500', name: 'Thủy Văn TĐ Kiến Giang', lat: 17.117, lng: 106.75 },
  { matram: '555400', name: 'Thủy Văn TĐ Mai Hóa', lat: 17.823, lng: 106.186 },
  { matram: '555300', name: 'Thủy Văn TĐ Đông Tâm', lat: 17.917, lng: 106.0 },
  { matram: '555200', name: 'Thủy Văn TĐ Đầu Mầu', lat: 16.7833, lng: 106.917 },
  { matram: '555100', name: 'Thủy Văn TĐ Mỹ Chánh', lat: 16.6, lng: 107.267 },
  { matram: '555000', name: 'Thủy Văn TĐ Hiền Lương', lat: 17.006, lng: 107.055 },
  { matram: '554900', name: 'Thủy Văn TĐ Gia Vòng', lat: 16.9564, lng: 106.951 },
  { matram: '554800', name: 'Thủy Văn TĐ Cửa Việt', lat: 16.8883, lng: 107.163 },
  { matram: '554700', name: 'Thủy Văn TĐ Đông Hà', lat: 16.8233, lng: 107.079 },
  { matram: '554600', name: 'Thủy Văn TĐ Thạch Hãn', lat: 16.7336, lng: 107.153 },
  { matram: '554500', name: 'Thủy Văn TĐ Dakrong', lat: 16.6575, lng: 106.815 },
];

// ============ 16 trạm VRain mực nước — toạ độ đã convert từ VN2000 (EPSG:5897) ============
const VRAIN_MUCNUOC_COORDS = {
  'Cam Tuyền': { lat: 16.77779, lng: 105.87028 },
  'Cây Da': { lat: 16.65223, lng: 106.06739 },
  'Cầu Bến Quan': { lat: 17.0173, lng: 106.909 },
  'Hàm Ninh': { lat: 17.35307, lng: 105.67362 },
  'Hải Tân': { lat: 16.83268, lng: 105.92606 },
  'NQL vận hành hồ Nam Thạch Hãn': { lat: 16.69446, lng: 105.89528 },
  'Quảng Thanh': { lat: 17.75446, lng: 105.39195 },
  'Triệu Đại': { lat: 16.83932, lng: 105.87942 },
  'Triệu Độ': { lat: 16.70098, lng: 106.04628 },
  'Trạm Thủy văn Lý Hòa': { lat: 17.63276, lng: 105.51606 },
  'Trạm Thủy văn Roòn': { lat: 17.89314, lng: 105.42434 },
  'Trạm Thủy văn Rào Nan': { lat: 17.76984, lng: 105.18848 },
  'Trạm thủy văn Liên Trạch': { lat: 17.67867, lng: 105.39481 },
  'Vĩnh Phước': { lat: 17.01584, lng: 105.6367 },
  'Đầu mối HCN Trúc Kinh': { lat: 16.87973, lng: 105.81361 },
  'Đầu mối HCN Ái Tử': { lat: 16.76476, lng: 105.87989 },
};

const VRAIN_MN_BASE_URL = 'https://mucnuoc.vrain.vn';
const VRAIN_MN_LOGIN_URL = `${VRAIN_MN_BASE_URL}/api/vwater/public/v1/login`;
const VRAIN_MN_DETAILS_URL = `${VRAIN_MN_BASE_URL}/api/vwater/private/v1/stats/details`;
const VRAIN_MN_USERNAME = 'mnquangtri';
const VRAIN_MN_PASSWORD = '123456';
const VRAIN_MN_GROUP_ID = '182';

function vnNow() {
  return new Date(Date.now() + 7 * 3600 * 1000);
}
function fmtVN(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Phân tích thời gian VRain — dữ liệu thô có thể là epoch (ms/s) hoặc chuỗi
// nhiều định dạng khác nhau (đã thấy code Python gốc phải thử nhiều kiểu),
// nên xử lý cẩn trọng hơn là tin thẳng vào new Date(tRaw).
function parseVrainTimestamp(tRaw) {
  if (tRaw == null) return NaN;
  if (typeof tRaw === 'number') {
    return tRaw > 10 ** 11 ? tRaw : tRaw * 1000; // ms nếu số lớn, ngược lại coi là giây
  }
  const s = String(tRaw).trim();
  if (/^\d{9,16}$/.test(s)) {
    const n = Number(s);
    return n > 10 ** 11 ? n : n * 1000;
  }
  const t = new Date(s.replace(' ', 'T')).getTime();
  return Number.isFinite(t) ? t : NaN;
}

// ============ KTTV ============
async function fetchKttvStation(station) {
  const end = vnNow();
  const start = new Date(end.getTime() - (MAX_WINDOW_H + 1) * 3600 * 1000);
  const url = `${KTTV_BASE_URL}?matram=${station.matram}&ten_table=mucnuoc_oday&sophut=60&tinhtong=0`
    + `&thoigianbd='${fmtVN(start)}'&thoigiankt='${fmtVN(end)}'`;
  try {
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) return null;
    const js = await res.json();
    if (!Array.isArray(js) || js.length === 0) return null;
    // time -> value (Solieu), sắp theo thời gian tăng dần
    const series = js
      .map((r) => ({ t: new Date(`${r.Thoigian_SL}Z`.replace(' ', 'T')).getTime() - 7 * 3600 * 1000, v: parseFloat(r.Solieu) }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => a.t - b.t);
    return buildStationResult(station.name, station.lat, station.lng, `kttv_${station.matram}`, series);
  } catch (e) {
    return null;
  }
}

// ============ VRain mực nước (đăng nhập + lấy 1 lượt cho toàn bộ nhóm trạm) ============
async function vrainMnLogin() {
  const res = await fetchWithTimeout(VRAIN_MN_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: VRAIN_MN_USERNAME, password: VRAIN_MN_PASSWORD }),
  }, 8000);
  if (!res.ok) throw new Error(`VRain mực nước đăng nhập lỗi HTTP ${res.status}`);
  // Đọc cookie sid — thử cả 2 cách vì môi trường Node/Netlify có thể khác
  // nhau cách trả về header set-cookie (1 chuỗi hay nhiều dòng).
  let setCookieRaw = '';
  if (typeof res.headers.getSetCookie === 'function') {
    setCookieRaw = res.headers.getSetCookie().join('; ');
  } else {
    setCookieRaw = res.headers.get('set-cookie') || '';
  }
  const m = /sid=([^;]+)/.exec(setCookieRaw);
  if (m) return m[1];
  const body = await res.json().catch(() => ({}));
  const sid = body.sid || body.token || body?.data?.sid;
  if (!sid) throw new Error('VRain mực nước đăng nhập không trả về sid');
  return sid;
}

function vrainValueFromStation(st) {
  for (const key of ['depth', 'value', 'level', 'muc', 'water']) {
    if (st[key] != null) return parseFloat(st[key]);
  }
  for (const k of Object.keys(st)) {
    const lk = k.toLowerCase();
    if (['depth', 'value', 'level', 'muc', 'water'].some((x) => lk.includes(x))) {
      const v = parseFloat(st[k]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

async function fetchVrainMnAll() {
  const sid = await vrainMnLogin();
  const end = vnNow();
  const start = new Date(end.getTime() - (MAX_WINDOW_H + 1) * 3600 * 1000);
  const dateFrom = fmtVN(start).slice(0, 10);
  const dateTo = fmtVN(end).slice(0, 10);
  const url = `${VRAIN_MN_DETAILS_URL}?groupID=${VRAIN_MN_GROUP_ID}&from=${dateFrom}&to=${dateTo}&i=_1h&sid=${sid}`;

  const res = await fetchWithTimeout(url, { headers: { Cookie: `sid=${sid}` } }, 8000);
  if (!res.ok) throw new Error(`VRain mực nước lấy dữ liệu lỗi HTTP ${res.status}`);
  const data = await res.json();

  // seriesByName: tên trạm -> mảng {t, v}
  const seriesByName = {};
  const entries = Array.isArray(data) ? data : (data?.data || data?.stats || []);
  for (const ent of entries) {
    if (!ent || typeof ent !== 'object') continue;
    const tRaw = ent.timePoint || ent.timestamp || ent.time || ent.date;
    const t = parseVrainTimestamp(tRaw);
    if (!Number.isFinite(t)) continue;
    const stations = ent.stations || ent.stationsList || [];
    for (const st of stations) {
      if (!st || typeof st !== 'object') continue;
      const name = (st.stationName || st.name || st.station || '').trim();
      if (!name) continue;
      const v = vrainValueFromStation(st);
      if (v == null || !Number.isFinite(v) || v <= -900) continue; // -999 là mã lỗi/thiếu dữ liệu
      if (!seriesByName[name]) seriesByName[name] = [];
      seriesByName[name].push({ t, v });
    }
  }

  const results = [];
  for (const [name, coords] of Object.entries(VRAIN_MUCNUOC_COORDS)) {
    const series = (seriesByName[name] || []).sort((a, b) => a.t - b.t);
    if (series.length === 0) continue;
    results.push(buildStationResult(name, coords.lat, coords.lng, `vrain_mn_${name}`, series));
  }
  return results;
}

// ============ Dựng kết quả 1 trạm: trả về NGUYÊN chuỗi thời gian (không rút
// gọn thành mức thay đổi) — để hiển thị dạng bảng hàng=giờ, cột=trạm giống
// đúng kiểu bảng Python cũ (mucnuoc_wide.xlsx). Mức thay đổi cho icon bản đồ
// sẽ tự tính ở phía frontend từ chính chuỗi này.
function buildStationResult(name, lat, lng, id, series) {
  if (series.length === 0) return null;
  return {
    id, name, coords: { lat, lng },
    series: series.map((p) => ({ t: p.t, v: Math.round(p.v * 100) / 100 })),
  };
}

export default async () => {
  try {
    const kttvResults = await Promise.all(KTTV_STATIONS.map((s) => fetchKttvStation(s)));
    let vrainResults = [];
    try {
      vrainResults = await fetchVrainMnAll();
    } catch (e) {
      console.error('[mucnuoc] Lỗi VRain mực nước:', e.message);
    }

    const stations = [...kttvResults.filter(Boolean), ...vrainResults.filter(Boolean)];
    return new Response(JSON.stringify(stations), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    console.error('[mucnuoc] Lỗi:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
