// netlify/functions/radar.js
//
// Lấy ảnh radar tổ hợp ("Tổ hợp" — CMAX) từ hymetnet.gov.vn, CĂN CHỈNH ĐỊA LÝ
// rồi chuyển tiếp cho app.
//
// Vì sao phải xử lý ảnh mà không đặt thẳng lên bản đồ:
//  1) hymetnet chỉ chạy http:// còn app chạy https:// (trình duyệt chặn ảnh http
//     trong trang https — "mixed content") -> cần function trung gian.
//  2) Ảnh gốc KHÔNG khớp địa lý ở khung danh nghĩa. Tool dubaodongset.py của anh
//     Hudson đã hiệu chỉnh bằng thực nghiệm: khung gốc 98–110°E, 8–23°N, nhân
//     khung 1,27 lần, dịch +1,85° kinh / +1,09° vĩ, xoay 4,5° và phóng 1,032.
//     Leaflet không xoay được ảnh phủ nên phép biến đổi này làm ngay ở đây, ra
//     ảnh PNG trong suốt đã nằm đúng khung — app chỉ việc đặt vào bản đồ.
//
// Cách gọi:
//   /.netlify/functions/radar                -> JSON mốc mới nhất đang có:
//                                               { available, t, timeVN, url, bounds }
//   /.netlify/functions/radar?t=202610060740 -> ảnh PNG đã căn chỉnh của mốc đó
//
// Quy luật tên ảnh (theo Request URL anh Hudson cung cấp, trùng với tool Python):
//   http://hymetnet.gov.vn/dataout_web/COM/{yyyyMMdd}/COM_{yyyyMMddHHmm}_CMAX00.png
// Mốc thời gian theo UTC, cách nhau 10 phút (…0740 = 14:40 giờ VN).

import pngjs from 'pngjs';

const { PNG } = pngjs;

const BASE_URL = 'http://hymetnet.gov.vn/dataout_web/COM';
const SLOT_MINUTES = 10;
const SO_MOC_DO_NGUOC = 12; // dò 12 mốc gần nhất (~2 giờ) cùng lúc, như tool Python
const TIMEOUT_MS = 8000;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; QTRI-Radar/1.0)' };

// ===== Hiệu chỉnh không gian — LẤY NGUYÊN từ dubaodongset.py =====
const OFFSET_LON = 1.85;
const OFFSET_LAT = 1.09;
const SCALE_FACTOR = 1.27;
const ROTATE_ANGLE = 4.5;
const ROTATE_SCALE = 1.032;
const RADAR_CENTER_LON = 107.10; // gần Đông Hà
const RADAR_CENTER_LAT = 16.82;
const LON_MIN_IMG = 98.0;
const LON_MAX_IMG = 110.0;
const LAT_MIN_IMG = 8.0;
const LAT_MAX_IMG = 23.0;
const CORE_RADIUS_PX = 11; // xoá đốm đỏ tâm radar Đông Hà (như remove_radar_core_red)

const OUT_MAX_WIDTH = 1400; // giới hạn bề ngang ảnh xuất ra để ảnh nhẹ, xử lý nhanh

// ---------------------------------------------------------------------------
// Phần toán — xuất ra để kiểm tra đối chiếu với tool Python
// ---------------------------------------------------------------------------

// round() của Python làm tròn "về số chẵn" khi đúng .5 — scipy dùng để tính
// kích thước ảnh sau khi phóng. Giữ y hệt để khớp từng điểm ảnh.
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

// Khung toạ độ sau hiệu chỉnh (không phụ thuộc kích thước ảnh).
export function khungToaDo() {
  const lonRange = (LON_MAX_IMG - LON_MIN_IMG) * SCALE_FACTOR;
  const latRange = (LAT_MAX_IMG - LAT_MIN_IMG) * SCALE_FACTOR;
  return {
    lonMin: LON_MIN_IMG - (lonRange - (LON_MAX_IMG - LON_MIN_IMG)) / 2 + OFFSET_LON,
    lonMax: LON_MAX_IMG + (lonRange - (LON_MAX_IMG - LON_MIN_IMG)) / 2 + OFFSET_LON,
    latMin: LAT_MIN_IMG - (latRange - (LAT_MAX_IMG - LAT_MIN_IMG)) / 2 + OFFSET_LAT,
    latMax: LAT_MAX_IMG + (latRange - (LAT_MAX_IMG - LAT_MIN_IMG)) / 2 + OFFSET_LAT,
  };
}

// Các tham số của rotate_around_center() cho ảnh gốc w x h.
export function tinhPhepBienDoi(w, h) {
  const k = khungToaDo();
  const lonPerPx = (k.lonMax - k.lonMin) / w;
  const latPerPx = (k.latMax - k.latMin) / h;
  const cx = Math.trunc((RADAR_CENTER_LON - k.lonMin) / lonPerPx);
  const cy = Math.trunc((k.latMax - RADAR_CENTER_LAT) / latPerPx);
  const padX = Math.abs(Math.floor(w / 2) - cx);
  const padY = Math.abs(Math.floor(h / 2) - cy);
  const Wp = w + 2 * padX;
  const Hp = h + 2 * padY;
  const th = (ROTATE_ANGLE * Math.PI) / 180;
  return {
    ...k, w, h, lonPerPx, latPerPx, padX, padY, Wp, Hp,
    Wout: pyRound(Wp * ROTATE_SCALE),
    Hout: pyRound(Hp * ROTATE_SCALE),
    cos: Math.cos(th),
    sin: Math.sin(th),
  };
}

// Ô (qx, qy) của lưới đã hiệu chỉnh (cùng kích thước ảnh gốc, phủ đúng khung
// toạ độ) -> toạ độ điểm ảnh tương ứng trong ẢNH GỐC. Đảo ngược đúng chuỗi:
// np.pad(reflect) -> scipy.rotate(4.5°, reshape=False) -> scipy.zoom(1.032) -> cắt.
export function luoiSangAnhGoc(T, qx, qy) {
  // bước cắt: cộng lại phần đệm
  const ox = qx + T.padX;
  const oy = qy + T.padY;
  // bước phóng (scipy.zoom, căn theo góc: in-1 / out-1)
  const ix = (ox * (T.Wp - 1)) / (T.Wout - 1);
  const iy = (oy * (T.Hp - 1)) / (T.Hout - 1);
  // bước xoay quanh tâm mảng đã đệm. Đã kiểm tra thực nghiệm với scipy: điểm
  // ảnh gốc (dx,dy) -> (cos·dx + sin·dy, −sin·dx + cos·dy) sau khi xoay +4.5°,
  // nên chiều ngược (từ ảnh đã xoay về ảnh gốc) dùng ma trận chuyển vị.
  const ccx = (T.Wp - 1) / 2;
  const ccy = (T.Hp - 1) / 2;
  const dx = ix - ccx;
  const dy = iy - ccy;
  const jx = T.cos * dx - T.sin * dy + ccx;
  const jy = T.sin * dx + T.cos * dy + ccy;
  // bước đệm: trừ phần đệm để về toạ độ ảnh gốc
  return [jx - T.padX, jy - T.padY];
}

function mercY(latDeg) {
  const phi = (latDeg * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
}
function invMercY(y) {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}

// Nội suy song tuyến (RGBA, nhân alpha trước để không bị viền màu). Trả về
// null nếu nằm ngoài ảnh gốc.
function laySongTuyen(data, w, h, ux, uy, out) {
  if (!(ux >= 0 && uy >= 0 && ux <= w - 1 && uy <= h - 1)) return false;
  const x0 = Math.floor(ux);
  const y0 = Math.floor(uy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = ux - x0;
  const fy = uy - y0;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const a = w00 * data[i00 + 3] + w10 * data[i10 + 3] + w01 * data[i01 + 3] + w11 * data[i11 + 3];
  if (a <= 0) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return true; }
  for (let c = 0; c < 3; c += 1) {
    const premul =
      w00 * data[i00 + c] * data[i00 + 3] +
      w10 * data[i10 + c] * data[i10 + 3] +
      w01 * data[i01 + c] * data[i01 + 3] +
      w11 * data[i11 + c] * data[i11 + 3];
    out[c] = premul / a;
  }
  out[3] = a;
  return true;
}

// Căn chỉnh ảnh radar gốc (RGBA) -> ảnh RGBA nằm đúng khung toạ độ.
// opts: { outW, outH, mercator (mặc định true), blackToAlpha (mặc định true) }
export function canhChinhRadar(rgba, w, h, opts = {}) {
  const T = tinhPhepBienDoi(w, h);
  const mercator = opts.mercator !== false;
  const outW = opts.outW || Math.min(w, OUT_MAX_WIDTH);
  const lonSpan = T.lonMax - T.lonMin;
  const ymMin = mercY(T.latMin);
  const ymMax = mercY(T.latMax);
  const outH = opts.outH || Math.max(1, Math.round((outW * (ymMax - ymMin)) / ((lonSpan * Math.PI) / 180)));

  // Ảnh có kênh alpha thật (nền trong suốt) hay nền đen đặc?
  let coAlpha = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) { coAlpha = true; break; }
  }
  const blackToAlpha = opts.blackToAlpha !== false && !coAlpha;

  const out = Buffer.alloc(outW * outH * 4);
  const px = [0, 0, 0, 0];
  const qxCot = new Float64Array(outW);
  for (let j = 0; j < outW; j += 1) {
    const lon = T.lonMin + ((j + 0.5) / outW) * lonSpan;
    qxCot[j] = (lon - T.lonMin) / T.lonPerPx - 0.5;
  }

  // vùng xoá đốm đỏ tâm radar Đông Hà (hình vuông ±11 ô của lưới gốc)
  const coreDLon = CORE_RADIUS_PX * T.lonPerPx;
  const coreDLat = CORE_RADIUS_PX * T.latPerPx;

  for (let i = 0; i < outH; i += 1) {
    const t = (i + 0.5) / outH;
    const lat = mercator
      ? invMercY(ymMax - t * (ymMax - ymMin))
      : T.latMax - t * (T.latMax - T.latMin);
    const qy = (T.latMax - lat) / T.latPerPx - 0.5;
    const trongHangLoiTam = Math.abs(lat - RADAR_CENTER_LAT) <= coreDLat;
    for (let j = 0; j < outW; j += 1) {
      const [ux, uy] = luoiSangAnhGoc(T, qxCot[j], qy);
      const o = (i * outW + j) * 4;
      if (!laySongTuyen(rgba, w, h, ux, uy, px)) continue; // ngoài ảnh gốc -> trong suốt
      let r = px[0];
      let g = px[1];
      let b = px[2];
      let a = px[3];
      if (blackToAlpha) {
        // ảnh nền đen đặc: coi gần-đen là "không có echo" (làm mờ dần cho mép mượt)
        const s = r + g + b;
        a = Math.max(0, Math.min(255, ((s - 20) * 255) / 40));
      }
      if (trongHangLoiTam) {
        const lon = T.lonMin + ((j + 0.5) / outW) * lonSpan;
        if (Math.abs(lon - RADAR_CENTER_LON) <= coreDLon && r > 150 && r > g + 50 && r > b + 50) a = 0;
      }
      out[o] = Math.round(r);
      out[o + 1] = Math.round(g);
      out[o + 2] = Math.round(b);
      out[o + 3] = Math.round(a);
    }
  }
  return { data: out, width: outW, height: outH, khung: { lonMin: T.lonMin, lonMax: T.lonMax, latMin: T.latMin, latMax: T.latMax } };
}

// ---------------------------------------------------------------------------
// Phần mạng + HTTP
// ---------------------------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, '0');
}

// Date (UTC) -> 'yyyyMMddHHmm'
function slotString(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function slotUrl(t) {
  return `${BASE_URL}/${t.slice(0, 8)}/COM_${t}_CMAX00.png`;
}

// 'yyyyMMddHHmm' (UTC) -> '14:40 06/10/2026' (giờ VN = UTC+7)
function slotToVN(t) {
  const utc = Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12));
  const d = new Date(utc + 7 * 3600 * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { headers: UA, ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Ảnh của mốc t đã có trên máy chủ chưa? (HEAD trước cho nhẹ; nếu máy chủ
// không hỗ trợ HEAD thì thử GET rồi bỏ phần thân)
async function motDaCo(t) {
  const url = slotUrl(t);
  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD' });
    if (head.ok) return true;
    if (head.status === 404) return false;
    const get = await fetchWithTimeout(url);
    const ok = get.ok;
    try { await get.body?.cancel(); } catch { /* bỏ qua */ }
    return ok;
  } catch {
    return false;
  }
}

function json(obj, cacheSeconds = 0) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
    },
  });
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const t = url.searchParams.get('t');
    const k = khungToaDo();
    // [[vĩ độ Nam, kinh độ Tây], [vĩ độ Bắc, kinh độ Đông]] — đúng dạng Leaflet
    const bounds = [[k.latMin, k.lonMin], [k.latMax, k.lonMax]];

    // ---- Trả về ảnh PNG ĐÃ CĂN CHỈNH của 1 mốc cụ thể ----
    if (t) {
      if (!/^\d{12}$/.test(t)) return json({ available: false, reason: 'Mốc thời gian không hợp lệ' });
      const res = await fetchWithTimeout(slotUrl(t));
      if (!res.ok) return json({ available: false, reason: `hymetnet trả về HTTP ${res.status}` });
      const raw = Buffer.from(await res.arrayBuffer());
      const src = PNG.sync.read(raw); // luôn ra RGBA 8-bit, kể cả ảnh bảng màu/16-bit
      const kq = canhChinhRadar(src.data, src.width, src.height);
      const png = new PNG({ width: kq.width, height: kq.height });
      png.data = kq.data;
      const buf = PNG.sync.write(png);
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Access-Control-Allow-Origin': '*',
          // Nội dung của 1 mốc không bao giờ đổi -> cache được; mốc mới = URL mới.
          'Cache-Control': 'public, max-age=1800',
          'Netlify-CDN-Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // ---- Dò mốc mới nhất đã có ----
    const now = new Date();
    const floorMs = Math.floor(now.getTime() / (SLOT_MINUTES * 60000)) * SLOT_MINUTES * 60000;
    const slots = [];
    for (let i = 0; i < SO_MOC_DO_NGUOC; i += 1) {
      slots.push(slotString(new Date(floorMs - i * SLOT_MINUTES * 60000)));
    }
    const ketQua = await Promise.all(slots.map((s) => motDaCo(s)));
    const idx = ketQua.findIndex(Boolean); // slots đã sắp từ mới -> cũ
    if (idx === -1) {
      return json({ available: false, reason: 'Không thấy ảnh radar nào trong ~2 giờ gần nhất (hoặc hymetnet không phản hồi)' });
    }
    const tMoi = slots[idx];
    return json({
      available: true,
      t: tMoi,
      timeVN: slotToVN(tMoi),
      url: `/.netlify/functions/radar?t=${tMoi}`,
      bounds,
    }, 120);
  } catch (e) {
    return json({ available: false, reason: `Lỗi: ${e.message}` });
  }
};
