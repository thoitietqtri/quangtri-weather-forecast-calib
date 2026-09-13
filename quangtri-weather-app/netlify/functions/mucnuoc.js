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
  { matram: '559200', name: 'Trường Sơn', lat: 17.2169, lng: 106.454 },
  { matram: '557600', name: 'Đồng Hới', lat: 17.472, lng: 106.626 },
  { matram: '556100', name: 'Lệ Thủy', lat: 17.217, lng: 106.783 },
  { matram: '555900', name: 'Tân Lâm', lat: 17.9128, lng: 106.234 },
  { matram: '555800', name: 'Tân Mỹ', lat: 17.7075, lng: 106.482 },
  { matram: '555700', name: 'Phong Nha', lat: 17.615, lng: 106.316 },
  { matram: '555500', name: 'Kiến Giang', lat: 17.117, lng: 106.75 },
  { matram: '555400', name: 'Mai Hóa', lat: 17.823, lng: 106.186 },
  { matram: '555300', name: 'Đông Tâm', lat: 17.917, lng: 106.0 },
  { matram: '555200', name: 'Đầu Mầu', lat: 16.7833, lng: 106.917 },
  { matram: '555100', name: 'Mỹ Chánh', lat: 16.6, lng: 107.267 },
  { matram: '555000', name: 'Hiền Lương', lat: 17.006, lng: 107.055 },
  { matram: '554900', name: 'Gia Vòng', lat: 16.9564, lng: 106.951 },
  { matram: '554800', name: 'Cửa Việt', lat: 16.8883, lng: 107.163 },
  { matram: '554700', name: 'Đông Hà', lat: 16.8233, lng: 107.079 },
  { matram: '554600', name: 'Thạch Hãn', lat: 16.7336, lng: 107.153 },
  { matram: '554500', name: 'Dakrong', lat: 16.6575, lng: 106.815 },
];

// ============ 16 trạm VRain mực nước — toạ độ CHÍNH THỨC do anh Hudson
// cung cấp trực tiếp (file Tọa_độ_trạm_mục_nước_Vrain.xlsx) — không qua
// tính chuyển đổi hệ toạ độ nữa, đáng tin cậy hơn bản tự convert trước đó.
// ============ 16 trạm VRain mực nước — CHÌA KHOÁ (key) phải giữ NGUYÊN VĂN
// đúng tên VRain thực sự trả về (dùng để đối chiếu dữ liệu) — KHÔNG được rút
// gọn ở đây, dù chỉ khác 1 chữ cũng làm mất trạm đó âm thầm không báo lỗi.
// Muốn hiển thị tên ngắn gọn cho người xem, dùng trường "displayName" riêng
// (an toàn để đổi tuỳ ý, không ảnh hưởng đến việc đối chiếu dữ liệu).
const VRAIN_MUCNUOC_COORDS = {
  'Cam Tuyền': { lat: 16.813958, lng: 106.990685, displayName: 'Cam Tuyền' },
  'Cây Da': { lat: 16.69245, lng: 107.29286, displayName: 'Cây Da' },
  'Cầu Bến Quan': { lat: 17.017347, lng: 106.909303, displayName: 'Bến Quan' },
  'Hàm Ninh': { lat: 17.353189, lng: 106.673588, displayName: 'Hàm Ninh' },
  'Hải Tân': { lat: 16.652225, lng: 107.317347, displayName: 'Hải Tân' },
  'NQL vận hành hồ Nam Thạch Hãn': { lat: 16.694444, lng: 107.145278, displayName: 'Hồ Nam Thạch Hãn' },
  'Quảng Thanh': { lat: 17.754514, lng: 106.392017, displayName: 'Quảng Thanh' },
  'Triệu Đại': { lat: 16.83263, lng: 107.176, displayName: 'Triệu Đại' },
  'Triệu Độ': { lat: 16.8392, lng: 107.12947, displayName: 'Triệu Độ' },
  'Trạm Thủy văn Lý Hòa': { lat: 17.632823, lng: 106.516056, displayName: 'Lý Hòa' },
  'Trạm Thủy văn Roòn': { lat: 17.893153, lng: 106.424542, displayName: 'Roòn' },
  'Trạm Thủy văn Rào Nan': { lat: 17.769464, lng: 106.188409, displayName: 'Rào Nan' },
  'Trạm thủy văn Liên Trạch': { lat: 17.6792, lng: 106.394843, displayName: 'Liên Trạch' },
  'Vĩnh Phước': { lat: 16.777778, lng: 107.120278, displayName: 'Vĩnh Phước' },
  'Đầu mối HCN Trúc Kinh': { lat: 16.879722, lng: 107.063611, displayName: 'Hồ Trúc Kinh' },
  'Đầu mối HCN Ái Tử': { lat: 16.76475, lng: 107.129889, displayName: 'Hồ Ái Tử' },
};

// ============ Cấp báo động / ngưỡng nguy hiểm — key dùng ĐÚNG mã trạm
// (matram cho KTTV) hoặc đúng tên đối chiếu VRain (giữ nguyên như trong
// VRAIN_MUCNUOC_COORDS, KHÔNG dùng displayName). Trạm không có entry ở đây
// = trạm hồ chứa, không phân cấp (theo đúng yêu cầu anh Hudson).
//   type 'official' — có quyết định cấp báo động chính thức (BĐI/II/III).
//   type 'custom'   — chưa có quyết định, dùng ngưỡng tự quy định thực tế.
const ALERT_THRESHOLDS = {
  // --- KTTV (key = matram) — CÓ cấp báo động chính thức ---
  '555300': { type: 'official', bd1: 7, bd2: 13, bd3: 16, luLichSu: 18.45 },        // Đông Tâm
  '555400': { type: 'official', bd1: 3, bd2: 5, bd3: 6.5, luLichSu: 9.47 },         // Mai Hóa
  '555800': { type: 'official', bd1: 1.1, bd2: 1.3, bd3: 1.5, luLichSu: 2.79 },     // Tân Mỹ
  '557600': { type: 'official', bd1: 1, bd2: 1.5, bd3: 2, luLichSu: 2.17 },         // Đồng Hới
  '555500': { type: 'official', bd1: 8, bd2: 11, bd3: 13, luLichSu: 17.71 },        // Kiến Giang
  '556100': { type: 'official', bd1: 1.2, bd2: 2.2, bd3: 2.7, luLichSu: 4.88 },     // Lệ Thủy
  '555700': { type: 'official', bd1: 3.5, bd2: 5, bd3: 6.5, luLichSu: 8.98 },       // Phong Nha
  '554900': { type: 'official', bd1: 5, bd2: 8, bd3: 11, luLichSu: 17.41 },         // Gia Vòng
  '555000': { type: 'official', bd1: 1, bd2: 2, bd3: 2.5, luLichSu: 2.96 },         // Hiền Lương
  '555200': { type: 'official', bd1: 21, bd2: 22.5, bd3: 23.5, luLichSu: 25.62 },   // Đầu Mầu
  '554700': { type: 'official', bd1: 2, bd2: 3, bd3: 4, luLichSu: 5.36 },           // Đông Hà
  '554500': { type: 'official', bd1: 29.5, bd2: 31.5, bd3: 33.5, luLichSu: 41.42 }, // Dakrong
  '554600': { type: 'official', bd1: 3, bd2: 4.5, bd3: 6, luLichSu: 7.4 },          // Thạch Hãn
  '554800': { type: 'official', bd1: 1, bd2: 1.5, bd3: 2, luLichSu: 2.72 },         // Cửa Việt
  '555100': { type: 'official', bd1: 2.5, bd2: 4, bd3: 5.3, luLichSu: 6.81 },       // Mỹ Chánh

  // --- KTTV (key = matram) — ngưỡng tự quy định ---
  '555900': { type: 'custom', binhThuongMax: 15.0, nguyHiemMin: 18.0, luLichSu: 31.27 }, // Tân Lâm
  '559200': { type: 'custom', binhThuongMax: 21.0, nguyHiemMin: 23.0, luLichSu: 30.46 }, // Trường Sơn

  // --- VRain (key = tên đối chiếu gốc) — CÓ cấp báo động chính thức ---
  'Trạm Thủy văn Roòn': { type: 'official', bd1: 1.3, bd2: 2.1, bd3: 2.7 },
  'Trạm Thủy văn Rào Nan': { type: 'official', bd1: 28.5, bd2: 31, bd3: 33 },
  'Quảng Thanh': { type: 'official', bd1: 1.2, bd2: 2.1, bd3: 2.7, luLichSu: 3.83 },
  'Trạm Thủy văn Lý Hòa': { type: 'official', bd1: 1.2, bd2: 2, bd3: 2.6 },
  'Hàm Ninh': { type: 'official', bd1: 1.2, bd2: 2, bd3: 2.6, luLichSu: 4.48 },
  'Cầu Bến Quan': { type: 'official', bd1: 4, bd2: 5.5, bd3: 6.5, luLichSu: 11.02 },
  'Hải Tân': { type: 'official', bd1: 1.8, bd2: 2.8, bd3: 3.4, luLichSu: 3.93 },

  // --- VRain (key = tên đối chiếu gốc) — ngưỡng tự quy định ---
  'Trạm thủy văn Liên Trạch': { type: 'custom', binhThuongMax: 1.5, nguyHiemMin: 2.5, luLichSu: 6.31 },
  'Cam Tuyền': { type: 'custom', binhThuongMax: 5.0, nguyHiemMin: 6.0 },
  'Vĩnh Phước': { type: 'custom', binhThuongMax: 3.0, nguyHiemMin: 4.0 },
  'Triệu Độ': { type: 'custom', binhThuongMax: 1.0, nguyHiemMin: 1.6 },
  'Triệu Đại': { type: 'custom', binhThuongMax: 1.1, nguyHiemMin: 1.7 },
  'Cây Da': { type: 'custom', binhThuongMax: 1.2, nguyHiemMin: 1.8 },
};

// Thứ tự ưu tiên hiển thị: có cấp báo động chính thức -> có ngưỡng tự quy
// định -> không phân cấp (hồ chứa), theo đúng yêu cầu anh Hudson.
function alertPriority(alertInfo) {
  if (!alertInfo) return 2;
  return alertInfo.type === 'official' ? 0 : 1;
}

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
// nhiều định dạng khác nhau. Đã xác nhận qua log thật: hệ mực nước VRain trả
// về dạng "HH:mm DD/MM" (KHÔNG có năm, giờ:phút trước, ngày/tháng sau — khác
// hẳn định dạng chuẩn) — cần tự suy ra năm (dùng năm hiện tại, đủ an toàn vì
// khoảng lấy dữ liệu chỉ trải dài vài ngày gần đây, không lệch năm).
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
  const mHM = /^(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (mHM) {
    const [, hh, mm, dd, mo] = mHM;
    const year = new Date().getFullYear();
    // Dựng mốc UTC từ giờ VN local (VN = UTC+7) — trừ 7 giờ để ra đúng UTC.
    return Date.UTC(year, Number(mo) - 1, Number(dd), Number(hh), Number(mm)) - 7 * 3600 * 1000;
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
    return buildStationResult(station.name, station.lat, station.lng, `kttv_${station.matram}`, series, ALERT_THRESHOLDS[station.matram] || null);
  } catch (e) {
    return null;
  }
}

// ============ VRain mực nước (đăng nhập + lấy 1 lượt cho toàn bộ nhóm trạm) ============
async function vrainMnLogin() {
  // Gửi ĐẦY ĐỦ header giống hệt bản Python gốc đã chạy được — server VRain
  // có vẻ kiểm tra các header này (thiếu là bị từ chối 400).
  const res = await fetchWithTimeout(VRAIN_MN_LOGIN_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json, text/plain, */*',
      'content-type': 'application/json;charset=UTF-8',
      'origin': VRAIN_MN_BASE_URL,
      'referer': `${VRAIN_MN_BASE_URL}/home/${VRAIN_MN_GROUP_ID}/details`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'x-vrain-user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
    body: JSON.stringify({ username: VRAIN_MN_USERNAME, password: VRAIN_MN_PASSWORD }),
  }, 8000);
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`VRain mực nước đăng nhập lỗi HTTP ${res.status} - ${bodyText.slice(0, 200)}`);
  }
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

  const res = await fetchWithTimeout(url, {
    headers: {
      Cookie: `sid=${sid}`,
      'accept': 'application/json, text/plain, */*',
      'referer': `${VRAIN_MN_BASE_URL}/home/${VRAIN_MN_GROUP_ID}/details`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'x-vrain-user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
  }, 8000);
  if (!res.ok) throw new Error(`VRain mực nước lấy dữ liệu lỗi HTTP ${res.status}`);
  const data = await res.json();

  // Log chẩn đoán — xem cấu trúc dữ liệu thật trả về (chỉ log 1 lần rút gọn,
  // không log toàn bộ vì có thể rất dài).
  console.log('[mucnuoc][debug] Kiểu dữ liệu trả về:', Array.isArray(data) ? 'array' : typeof data);
  console.log('[mucnuoc][debug] Các khoá cấp 1 (nếu là object):', typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : 'N/A');
  console.log('[mucnuoc][debug] 1000 ký tự đầu của response:', JSON.stringify(data).slice(0, 1000));

  // seriesByName: tên trạm -> mảng {t, v}
  const seriesByName = {};
  const entries = Array.isArray(data) ? data : (data?.data || data?.stats || []);
  console.log('[mucnuoc][debug] Số entries (theo thời điểm) tìm được:', entries.length);
  if (entries.length > 0) {
    const first = entries[0];
    const { stations, ...firstWithoutStations } = first || {};
    console.log('[mucnuoc][debug] Các khoá của 1 entry:', Object.keys(first || {}));
    console.log('[mucnuoc][debug] Nội dung entry (đã bỏ mảng stations cho ngắn):', JSON.stringify(firstWithoutStations));
  }
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
  console.log('[mucnuoc][debug] Tên trạm tìm được trong dữ liệu (tối đa 20):', Object.keys(seriesByName).slice(0, 20));
  console.log('[mucnuoc][debug] Tên trạm mong đợi (trong VRAIN_MUCNUOC_COORDS):', Object.keys(VRAIN_MUCNUOC_COORDS));

  const results = [];
  for (const [matchName, coords] of Object.entries(VRAIN_MUCNUOC_COORDS)) {
    const series = (seriesByName[matchName] || []).sort((a, b) => a.t - b.t);
    if (series.length === 0) continue;
    // Đối chiếu dùng matchName (tên gốc VRain) — hiển thị dùng displayName
    // (tên ngắn gọn) nếu có, không có thì fallback về tên gốc.
    results.push(buildStationResult(coords.displayName || matchName, coords.lat, coords.lng, `vrain_mn_${matchName}`, series, ALERT_THRESHOLDS[matchName] || null));
  }
  return results;
}

// ============ Dựng kết quả 1 trạm: trả về NGUYÊN chuỗi thời gian (không rút
// gọn thành mức thay đổi) — để hiển thị dạng bảng hàng=giờ, cột=trạm giống
// đúng kiểu bảng Python cũ (mucnuoc_wide.xlsx). Mức thay đổi cho icon bản đồ
// sẽ tự tính ở phía frontend từ chính chuỗi này.
function buildStationResult(name, lat, lng, id, series, alertInfo = null) {
  if (series.length === 0) return null;
  return {
    id, name, coords: { lat, lng }, alertInfo,
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

    const stations = [...kttvResults.filter(Boolean), ...vrainResults.filter(Boolean)]
      .sort((a, b) => alertPriority(a.alertInfo) - alertPriority(b.alertInfo));
    return new Response(JSON.stringify(stations), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    console.error('[mucnuoc] Lỗi:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
