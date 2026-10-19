import { useState, useRef, useEffect } from 'react';
import L from 'leaflet';
import './TroLyAI.css';
import { LOI_CHAO, GOI_Y, TU_KHOA, HUONG_DAN, MO_TA_MUA, TRAM_DU_BAO_MUC_NUOC, NGUONG_SO_LIEU_CU_GIO, CAU_MUC_NUOC } from '../data/troLyThuVien';

// ===== Trợ lý theo kịch bản (Lớp 1 — không dùng AI, không tốn phí) =====
// Mọi con số do CODE lấy từ dữ liệu app đang có, không bịa. Nội dung câu hỏi/hướng
// dẫn nằm ở src/data/troLyThuVien.js. Muốn gắn AI sau này chỉ cần điền goiAI() cuối file.

const chuanHoa = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
const thoatRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const chuanHoaDs = (arr) => arr.map(chuanHoa);
// Khớp theo TỪ/CỤM TỪ nguyên vẹn (tránh "lu" khớp nhầm trong "luc").
const coTu = (q, list) => list.some((k) => new RegExp(`(^|\\s)${thoatRegex(k)}(\\s|$)`).test(q));

// Chuẩn hóa thư viện 1 lần khi nạp
const TK = Object.fromEntries(Object.entries(TU_KHOA).map(([k, v]) => [k, chuanHoaDs(v)]));
const HD = HUONG_DAN.map((h) => ({ ...h, k: chuanHoaDs(h.k) }));

// ---- So khớp tên (trạm/xã) ----
function kc(a, b) { // khoảng cách chỉnh sửa (Levenshtein) — chịu lỗi nghe nhầm khi nói
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function timTenChinhXac(q, ds, getName) {
  const hits = ds.map((x) => ({ x, n: chuanHoa(getName(x)) })).filter((h) => h.n && new RegExp(`(^|\\s)${thoatRegex(h.n)}(\\s|$)`).test(q));
  return hits.filter((h) => !hits.some((o) => o !== h && o.n.length > h.n.length && o.n.includes(h.n))).map((h) => h.x);
}
function timTenGanDung(q, ds, getName) {
  const words = q.split(' ');
  let best = Infinity; let out = [];
  for (const x of ds) {
    const n = chuanHoa(getName(x));
    if (n.length < 6) continue; // tên quá ngắn: không dò gần đúng để tránh nhầm
    const k = n.split(' ').length;
    const nguong = n.length >= 10 ? 2 : 1;
    for (let i = 0; i + k <= words.length; i++) {
      const d = kc(words.slice(i, i + k).join(' '), n);
      if (d <= nguong) { if (d < best) { best = d; out = [x]; } else if (d === best && !out.includes(x)) out.push(x); }
    }
  }
  return out;
}

// ---- Mực nước (cùng logic với MapComponent, trả chuỗi thuần) ----
function tomTatMucNuoc(series) {
  if (!series || !series.length) return { current: null, change24h: null, t: null };
  const s = [...series].sort((a, b) => a.t - b.t);
  const cur = s[s.length - 1];
  const target = cur.t - 24 * 3600 * 1000;
  let best = null; let bd = Infinity;
  for (const p of s) { const d = Math.abs(p.t - target); if (d < bd) { bd = d; best = p; } }
  const change24h = best && bd <= 40 * 60 * 1000 ? Math.round((cur.v - best.v) * 100) / 100 : null;
  return { current: cur.v, change24h, t: cur.t };
}
function capBaoDong(cur, a) {
  if (!a) return 'trạm chưa phân cấp báo động';
  if (cur == null) return '';
  if (a.type === 'official') {
    if (cur >= a.bd3) return `TRÊN báo động III: +${(cur - a.bd3).toFixed(2)}m`;
    if (cur >= a.bd2) return `trên báo động II: +${(cur - a.bd2).toFixed(2)}m`;
    if (cur >= a.bd1) return `trên báo động I: +${(cur - a.bd1).toFixed(2)}m`;
    return `dưới báo động I: -${(a.bd1 - cur).toFixed(2)}m`;
  }
  if (cur >= a.nguyHiemMin) return `trên mức nguy hiểm: +${(cur - a.nguyHiemMin).toFixed(2)}m`;
  if (cur >= a.binhThuongMax) return `mức cảnh báo (+${(cur - a.binhThuongMax).toFixed(2)}m so với bình thường)`;
  return 'dưới mức bình thường';
}
const gio = (t) => { const d = new Date(t + 7 * 3600 * 1000); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ngày ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`; }; // giờ VN, không phụ thuộc định dạng của trình duyệt
const dau = (v) => (v > 0 ? `+${v}` : `${v}`);

function traLoiMucNuoc(st) {
  const { current, change24h, t } = tomTatMucNuoc(st.series);
  if (current == null) return `Trạm mực nước ${st.name}: hiện chưa có số liệu.`;
  const xuHuong = change24h == null ? '' : `\n• 24h qua: ${dau(change24h)}m (${change24h > 0.02 ? 'đang lên' : change24h < -0.02 ? 'đang xuống' : 'gần như không đổi'})`;
  const lu = st.alertInfo?.luLichSu != null ? `\n• So với lũ lịch sử (${st.alertInfo.luLichSu}m): ${dau((current - st.alertInfo.luLichSu).toFixed(2))}m` : '';
  return `🌊 ${st.name} (số liệu ${gio(t)}):\n• Mực nước: ${current}m — ${capBaoDong(current, st.alertInfo)}${xuHuong}${lu}`;
}
function traLoiMua(st) {
  const f = (v) => (v == null ? '—' : v);
  return `💧 Trạm mưa ${st.name}:\n• 1h: ${f(st.rain_1h)}mm · 3h: ${f(st.rain_3h)}mm · 6h: ${f(st.rain_6h)}mm\n• 24h: ${f(st.rain_24h)}mm · 48h: ${f(st.rain_48h)}mm · 72h: ${f(st.rain_72h)}mm`;
}

// ---- Cảnh báo (giống getCanhBao trong MapComponent) ----
function canhBao(tmax, tmin, wind, rain) {
  const w = [];
  if (tmax >= 38) w.push('nắng nóng gay gắt'); else if (tmax >= 35) w.push('nắng nóng');
  if (tmin < 13) w.push('rét hại'); else if (tmin < 15) w.push('rét đậm');
  if (wind > 16) w.push('gió mạnh, sóng lớn trên biển');
  if (rain > 200) w.push('sạt lở đất, ngập lụt vùng trũng thấp và hạ du các sông'); else if (rain > 100) w.push('sạt lở đất');
  return w;
}

// Câu nhận định theo lượng mưa dự báo 24h (ngưỡng và lời văn sửa ở troLyThuVien.js).
const moTaMua = (rain) => (MO_TA_MUA.find((m) => rain < m.duoi) || MO_TA_MUA[MO_TA_MUA.length - 1]).text;

// ---- Ngày tháng ----
const MAX_NGAY = 13; // khớp giới hạn chọn ngày của app (hôm nay + 13)
const ngayHienTai = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
const cong = (d, n) => { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; };
const ymd = (d) => d.toISOString().slice(0, 10);
const dm = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const THU = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const nhan = (d) => `${THU[d.getUTCDay()]} ${dm(d)}`;
const THU_REGEX = [[/(^|\s)thu (2|hai)(\s|$)/, 1], [/(^|\s)thu (3|ba)(\s|$)/, 2], [/(^|\s)thu (4|tu)(\s|$)/, 3], [/(^|\s)thu (5|nam)(\s|$)/, 4], [/(^|\s)thu (6|sau)(\s|$)/, 5], [/(^|\s)thu (7|bay)(\s|$)/, 6], [/(^|\s)chu nhat(\s|$)/, 0]];
const dayRange = (start, n) => Array.from({ length: n }, (_, i) => cong(start, i));

// Phân tích câu hỏi -> danh sách ngày cần dự báo.
// Trả { cuThe, dates (mảng Date UTC), ghiChu, loi }. cuThe=true nếu câu hỏi có nêu ngày/khoảng ngày.
function layYeuCau(q, ngayDangChon, homNay = ngayHienTai()) {
  const han = cong(homNay, MAX_NGAY);
  const ghi = (dates, ghiChu = '') => ({ cuThe: true, dates, ghiChu });
  // 1) ngày cụ thể: "ngày 20/10", "20/10", "ngày 20 tháng 10"
  let m = q.match(/ngay (\d{1,2}) thang (\d{1,2})/) || q.match(/(?:^|\s)(\d{1,2}) ?[/.-] ?(\d{1,2})(?![\d/]|\s?ngay)/);
  if (m) {
    const dd = +m[1]; const mm = +m[2];
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      let y = homNay.getUTCFullYear();
      let d = new Date(Date.UTC(y, mm - 1, dd));
      if (d.getUTCMonth() !== mm - 1) return { cuThe: true, loi: `Ngày ${dd}/${mm} không hợp lệ, anh/chị kiểm tra lại giúp em.` };
      if (d < homNay) { const d2 = new Date(Date.UTC(y + 1, mm - 1, dd)); if (d2 <= han) d = d2; }
      if (d < homNay) return { cuThe: true, loi: `Ngày ${dd}/${mm} đã qua, em chỉ có dự báo từ hôm nay (${dm(homNay)}) đến ${dm(han)}.` };
      if (d > han) return { cuThe: true, loi: `Ngày ${dd}/${mm} nằm ngoài phạm vi. App chỉ có dự báo đến ${dm(han)} (tối đa ${MAX_NGAY} ngày tới).` };
      return ghi([d]);
    }
  }
  // 2) "N ngày tới", "dự báo N ngày"
  m = q.match(/(\d{1,2}) ngay (toi|nua|sap toi|tiep theo)/) || q.match(/du bao (\d{1,2}) ngay/);
  if (m) {
    let n = +m[1]; let ghiChu = '';
    if (n < 1) n = 1;
    if (n > MAX_NGAY) { n = MAX_NGAY; ghiChu = `\n(App chỉ có dự báo tối đa ${MAX_NGAY} ngày tới nên em trả ${MAX_NGAY} ngày.)`; }
    return ghi(dayRange(homNay, n), ghiChu);
  }
  // 3) tuần tới
  if (/(^|\s)tuan (toi|sau)(\s|$)/.test(q) || /(^|\s)(1|mot) tuan(\s|$)/.test(q)) return ghi(dayRange(homNay, 7));
  // 4) cuối tuần
  if (q.includes('cuoi tuan')) {
    const dow = homNay.getUTCDay();
    if (dow === 0) return ghi([homNay]);
    if (dow === 6) return ghi([homNay, cong(homNay, 1)]);
    const toSat = 6 - dow;
    return ghi([cong(homNay, toSat), cong(homNay, toSat + 1)]);
  }
  // 5) thứ trong tuần
  for (const [re, dow] of THU_REGEX) {
    if (re.test(q)) return ghi([cong(homNay, (dow - homNay.getUTCDay() + 7) % 7)]);
  }
  // 6) hôm nay / ngày mai / ngày kia
  if (q.includes('ngay kia') || q.includes('ngay mot')) return ghi([cong(homNay, 2)]);
  if (q.includes('ngay mai') || /(^|\s)mai(\s|$)/.test(q)) return ghi([cong(homNay, 1)]);
  if (q.includes('hom nay')) return ghi([homNay]);
  // 7) mặc định: ngày đang chọn trên app hoặc hôm nay
  if (ngayDangChon) { const d = new Date(`${ngayDangChon}T00:00:00Z`); if (!isNaN(d)) return { cuThe: false, dates: [d] }; }
  return { cuThe: false, dates: [homNay] };
}

async function traLoiDuBao(ten, center, dates) {
  const start = ymd(dates[0]); const end = ymd(dates[dates.length - 1]);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&timezone=auto&models=ecmwf_ifs&start_date=${start}&end_date=${end}`;
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error(r.status);
    const d = (await r.json()).daily;
    if (!d || !d.time) throw new Error('no data');
    const rows = d.time.map((t, i) => {
      const day = new Date(`${t}T00:00:00Z`);
      const tmax = d.temperature_2m_max[i]; const tmin = d.temperature_2m_min[i];
      const rain = d.precipitation_sum[i]; const wind = d.windspeed_10m_max[i] == null ? null : parseFloat((d.windspeed_10m_max[i] / 3.6).toFixed(1));
      return { day, tmax, tmin, rain, wind, ok: tmax != null && tmin != null && rain != null && wind != null };
    });
    if (rows.length === 1) {
      const x = rows[0];
      if (!x.ok) return `Chưa có dự báo cho ${ten} ngày ${nhan(x.day)}.`;
      const w = canhBao(x.tmax, x.tmin, x.wind, x.rain);
      return `Dự báo thời tiết cho ${ten} ngày ${dm(x.day)} là: ${moTaMua(x.rain)} Cụ thể:\n• Nhiệt độ: ${x.tmin}–${x.tmax}°C\n• Mưa: ${x.rain} mm\n• Gió mạnh nhất: ${x.wind} m/s\n${w.length ? '⚠️ Cảnh báo: ' + w.join('; ') : '✅ Không có cảnh báo thiên tai'}`;
    }
    const lines = rows.map((x) => (x.ok
      ? `• ${nhan(x.day)}: ${x.tmin}–${x.tmax}°C · mưa ${x.rain}mm · gió ${x.wind}m/s${canhBao(x.tmax, x.tmin, x.wind, x.rain).length ? ' ⚠️' : ''}`
      : `• ${nhan(x.day)}: chưa có dự báo`));
    const okRows = rows.filter((x) => x.ok);
    const tong = okRows.reduce((s, x) => s + x.rain, 0);
    const max = okRows.reduce((b, x) => (b == null || x.rain > b.rain ? x : b), null);
    const tomTat = max ? `\nTổng mưa ${okRows.length} ngày: ${tong.toFixed(1)}mm. Mưa nhiều nhất: ${nhan(max.day)} (${max.rain}mm).` : '';
    const cb = okRows.map((x) => ({ x, w: canhBao(x.tmax, x.tmin, x.wind, x.rain) })).filter((o) => o.w.length);
    const canh = cb.length ? '\n⚠️ Cảnh báo:\n' + cb.map((o) => `• ${dm(o.x.day)}: ${o.w.join('; ')}`).join('\n') : '\n✅ Không có cảnh báo thiên tai trong khoảng này.';
    // Nhận định theo mưa: gộp các ngày liền nhau có cùng nhận định cho gọn.
    const nhom = [];
    okRows.forEach((x) => {
      const text = moTaMua(x.rain); const cuoi = nhom[nhom.length - 1];
      if (cuoi && cuoi.text === text) cuoi.den = x.day; else nhom.push({ text, tu: x.day, den: x.day });
    });
    const nhanDinh = nhom.length ? `Dự báo thời tiết cho ${ten} từ ${dm(rows[0].day)} đến ${dm(rows[rows.length - 1].day)} là:\n` + nhom.map((g) => `• ${g.tu === g.den ? dm(g.tu) : `${dm(g.tu)} đến ${dm(g.den)}`}: ${g.text}`).join('\n') : '';
    return `${nhanDinh}${nhanDinh ? '\nCụ thể:\n' : ''}${lines.join('\n')}${tomTat}${canh}`;
  } catch (e) {
    return 'Không tải được dự báo (mạng chậm hoặc máy chủ bận), anh/chị thử lại sau.';
  } finally { clearTimeout(timer); }
}

// ---- Dự báo mực nước 6/12/18/24h (Mai Hóa, Đồng Tâm) — dùng đúng hàm Netlify của menu dự báo ----
const gioVN = (t) => { const d = new Date(t + 7 * 3600 * 1000); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCHours())}h ngày ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`; };

async function goiDuBaoMucNuoc(cfg) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 25000);
  try {
    const r = await fetch(`/.netlify/functions/${cfg.fn}?hesoHieuChinh=1.0`, { signal: c.signal });
    if (!r.ok) return null;
    const d = await r.json();
    if (!cfg.tramKey) return d;
    // forecast-nhatle trả cả 2 trạm: lấy phần của trạm đang hỏi, đưa về cùng dạng với Mai Hóa/Đồng Tâm
    if (!d || !d.available) return d;
    const t = d.tram && d.tram[cfg.tramKey];
    if (!t) return { available: false, reason: 'chưa có số liệu trạm này' };
    return { available: true, thoiDiemHienTai: t.thoiDiemHienTai, hienTai: t.hienTai, cheDo: t.cheDo, duBaoTheoMoc: t.duBaoTheoMoc, nhanDinhDinh: t.nhanDinhDinh };
  } catch { return null; } finally { clearTimeout(timer); }
}

function traLoiDuBaoMucNuoc(cfg, data, stThucDo, hoiDinh) {
  const ng = { type: 'official', ...cfg.nguong };
  const hienTai = data[cfg.hienTaiKey]; const tHT = data.thoiDiemHienTai;
  const out = [`Mực nước trạm ${cfg.ten} (số liệu ${gioVN(tHT)}):`, `• Lúc này: ${hienTai}m — ${capBaoDong(hienTai, ng)}`];
  const ch24 = stThucDo ? tomTatMucNuoc(stThucDo.series).change24h : null;
  if (ch24 != null) out.push(`• 24h qua: ${dau(ch24)}m (${ch24 > 0.02 ? 'đang lên' : ch24 < -0.02 ? 'đang xuống' : 'gần như không đổi'})`);
  let max = hienTai;

  if (cfg.tramKey && data.cheDo === 'ngay_thuong') {
    out.push(`Mực nước dưới ${cfg.nguongLu}m, chưa có lũ nên chưa có dự báo 6, 12, 18, 24 giờ tới.`);
  } else if (data.cheDo === 'ngay_thuong') {
    out.push(`• Đồng Tâm: ${data.dongtamHienTai}m (dưới ngưỡng lũ)`);
    out.push(`• Ước tính theo mô hình triều: ${data.maihoaDuBao}m`);
    out.push('Chưa có lũ nên chưa có dự báo 6, 12, 18, 24 giờ tới.');
    if (hoiDinh && hienTai < cfg.nguong.bd1) out.push(CAU_MUC_NUOC.chuaCoLu);
  } else {
    const MOC = [6, 12, 18, 24];
    MOC.forEach((h) => {
      const v = data.duBaoTheoMoc[h]; max = Math.max(max, v);
      out.push(`• ${h}h tới (${gioVN(tHT + h * 3600000)}): ${v}m — ${capBaoDong(v, ng)}`);
    });
    const vuotBD1 = max >= cfg.nguong.bd1;
    const dinh = data.nhanDinhDinh || {};
    if (vuotBD1) { // đỉnh lũ chỉ nêu khi mực nước đang/ dự kiến vượt báo động I
      if (dinh.coDinh) out.push(`🔴 Dự kiến đạt đỉnh ${dinh.giaTriDinh.toFixed(2)}m trong khoảng ${gioVN(tHT + dinh.gioTruoc * 3600000)} đến ${gioVN(tHT + dinh.gioDinh * 3600000)}.`);
      else if (dinh.dangTiepTucLen) out.push('📈 Sau 24h vẫn còn xu hướng tiếp tục lên, chưa xác định được đỉnh trong 24h tới.');
      else out.push('📉 Xu hướng giảm hoặc ổn định trong 24h tới, không có đỉnh mới.');
    } else {
      const dl = data.duBaoTheoMoc[24] - hienTai;
      out.push(`Xu hướng 24h tới: ${dl > 0.1 ? 'có xu hướng lên' : dl < -0.1 ? 'có xu hướng xuống' : 'ít thay đổi'}.`);
      if (hoiDinh) out.push(CAU_MUC_NUOC.chuaCoLu);
    }
  }
  if (Date.now() - tHT > NGUONG_SO_LIEU_CU_GIO * 3600000) out.push(`⚠️ Số liệu mới nhất lúc ${gioVN(tHT)}, đã cũ hơn ${NGUONG_SO_LIEU_CU_GIO} giờ; dự báo có thể chưa phản ánh tình hình hiện tại.`);
  if (cfg.thamKhao && data.cheDo !== 'ngay_thuong') out.push(CAU_MUC_NUOC.thamKhaoKienGiang);
  if (max >= cfg.nguong.bd2) out.push(`⚠️ ${CAU_MUC_NUOC.khuyenCao}`);
  out.push(CAU_MUC_NUOC.luuY);
  return out.join('\n');
}

// ---- Giọng nói ----
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const layGiongViet = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis.getVoices().find((v) => /^vi/i.test(v.lang)) : null);

// Đổi chữ/ký hiệu sang dạng dễ đọc thành tiếng.
function lamSachDeDoc(t) {
  return String(t)
    .replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF\uFE0F]/gu, '')
    .replace(/KTTV/g, 'khí tượng thủy văn')
    .replace(/BĐIII/g, 'báo động ba').replace(/BĐII/g, 'báo động hai').replace(/BĐI/g, 'báo động một')
    .replace(/(\d{1,2}):(\d{2})/g, (_, h, m) => (m === '00' ? `${+h} giờ` : `${+h} giờ ${+m} phút`))
    .replace(/(\d)\s*mm\b/g, '$1 milimét')
    .replace(/°C/g, ' độ C')
    .replace(/m\/s/g, ' mét trên giây')
    .replace(/(\d{1,2})\/(\d{1,2})/g, '$1 tháng $2')
    .replace(/(\d)\s*[–-]\s*(\d)/g, '$1 đến $2')
    .replace(/(\d+)h\b/g, '$1 giờ')
    .replace(/(\d)\.(\d)/g, '$1 phẩy $2')
    .replace(/(\d)m\b/g, '$1 mét')
    .replace(/\+(\d)/g, 'cộng $1').replace(/-(\d)/g, 'trừ $1')
    .replace(/[•·]/g, ',').replace(/—/g, ',').replace(/→/g, ',');
}
function noiThanhTieng(text) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const giong = layGiongViet();
  lamSachDeDoc(text).split('\n').map((s) => s.trim()).filter(Boolean).forEach((dong) => {
    const u = new SpeechSynthesisUtterance(dong);
    u.lang = 'vi-VN'; u.rate = 1;
    if (giong) u.voice = giong;
    window.speechSynthesis.speak(u);
  });
}

// Hình đại diện trợ lý (cô gái đội nón lá) — vẽ bằng SVG, không cần file ảnh, không dùng id nên dùng được nhiều nơi cùng lúc.
function TroLyAvatar({ size = '100%' }) {
  return (
    <svg className="tl-avatar" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect width="100" height="100" fill="#4FA3E0" />
      <ellipse cx="20" cy="26" rx="13" ry="6" fill="#fff" opacity=".35" />
      <ellipse cx="82" cy="20" rx="10" ry="5" fill="#fff" opacity=".3" />
      <path d="M26 36C19 60 20 86 27 97L73 97C80 86 81 60 74 36Z" fill="#1F1A24" />
      <path d="M12 100C15 83 30 77 50 77C70 77 85 83 88 100Z" fill="#fff" />
      <path d="M50 77L38 100M50 77L62 100" stroke="#D6E2EE" strokeWidth="1.2" fill="none" />
      <rect x="43" y="63" width="14" height="17" rx="6" fill="#F2BE98" />
      <path d="M39 77Q50 86 61 77L58 71Q50 78 42 71Z" fill="#E6EFF8" />
      <ellipse cx="50" cy="52" rx="19" ry="20" fill="#F8CFAB" />
      <path d="M50 4L88 38Q50 47 12 38Z" fill="#EBD28D" />
      <path d="M50 4L27 40M50 4L38 43M50 4L50 44M50 4L62 43M50 4L73 40" stroke="#C7A65A" strokeWidth=".9" fill="none" />
      <path d="M12 38Q50 47 88 38" stroke="#B8934A" strokeWidth="1.6" fill="none" />
      <path d="M33 41C30 55 34 66 42 70M67 41C70 55 66 66 58 70" stroke="#D32F2F" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M38 48Q42 45.5 46 48M54 48Q58 45.5 62 48" stroke="#2B2020" strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <ellipse cx="42" cy="54" rx="2.7" ry="3.5" fill="#2B2020" />
      <ellipse cx="58" cy="54" rx="2.7" ry="3.5" fill="#2B2020" />
      <circle cx="43" cy="52.8" r="1" fill="#fff" />
      <circle cx="59" cy="52.8" r="1" fill="#fff" />
      <circle cx="36.5" cy="61" r="3.6" fill="#F59DA0" opacity=".6" />
      <circle cx="63.5" cy="61" r="3.6" fill="#F59DA0" opacity=".6" />
      <path d="M44.5 62Q50 68 55.5 62" stroke="#B3363F" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function TroLyAI({ rainStations = [], mucNuocStations = [], featureList = [], selectedFeature = null, selectedDate = '' }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([{ role: 'bot', text: LOI_CHAO }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [nghe, setNghe] = useState(false);
  const [docTo, setDocTo] = useState(false);
  const [coGiong, setCoGiong] = useState(false);
  const endRef = useRef(null);
  const recRef = useRef(null);
  const guiRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, open]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined;
    const capNhat = () => setCoGiong(!!layGiongViet());
    capNhat();
    window.speechSynthesis.addEventListener?.('voiceschanged', capNhat);
    return () => { window.speechSynthesis.removeEventListener?.('voiceschanged', capNhat); window.speechSynthesis.cancel(); recRef.current?.abort?.(); };
  }, []);

  async function traLoi(raw) {
    const q = chuanHoa(raw);
    const qNgay = q.replace(/mai hoa/g, ' '); // tránh "Mai Hóa" bị hiểu là "ngày mai"
    const yc = layYeuCau(qNgay, selectedDate);

    let tram = timTenChinhXac(q, rainStations, (s) => s.name);
    let nuoc = timTenChinhXac(q, mucNuocStations, (s) => s.name);
    let xa = timTenChinhXac(q, featureList, (f) => f.name);
    if (!tram.length && !nuoc.length && !xa.length) { // không khớp chính xác -> dò gần đúng (chịu lỗi nghe nhầm khi nói)
      tram = timTenGanDung(q, rainStations, (s) => s.name);
      nuoc = timTenGanDung(q, mucNuocStations, (s) => s.name);
      xa = timTenGanDung(q, featureList, (f) => f.name);
    }
    const hoiMua = coTu(q, TK.mua);
    const hoiNuoc = coTu(q, TK.nuoc);
    const hoiDuBao = coTu(q, TK.duBao) || yc.cuThe || /(^|\s)mai(\s|$)/.test(qNgay);
    const huongDan = coTu(q, TK.huongDan);

    // 0) Dự báo mực nước 6/12/18/24h cho Mai Hóa, Đồng Tâm, Kiến Giang, Lệ Thủy; trạm khác chỉ có số liệu thực đo
    const coMoc = /(^|\s)(6|12|18|24) ?(h|gio)(\s|$)/.test(q);
    const hoiDinh = coTu(q, TK.dinhLu);
    const yMucNuoc = (hoiNuoc || hoiDinh || coMoc) && !(hoiMua && !hoiNuoc && !hoiDinh);
    if (yMucNuoc && !huongDan) {
      const cfgs = TRAM_DU_BAO_MUC_NUOC.filter((c) => { const n = chuanHoa(c.ten); return nuoc.some((s) => chuanHoa(s.name) === n) || new RegExp(`(^|\\s)${thoatRegex(n)}(\\s|$)`).test(q); });
      if (cfgs.length) {
        const kqs = await Promise.all(cfgs.map(async (cfg) => {
          const stTD = mucNuocStations.find((s) => chuanHoa(s.name) === chuanHoa(cfg.ten));
          const data = await goiDuBaoMucNuoc(cfg);
          if (data && data.available) return traLoiDuBaoMucNuoc(cfg, data, stTD, hoiDinh);
          const lyDo = data && data.reason ? `: ${data.reason}` : ' (không kết nối được máy chủ dự báo)';
          return `${stTD ? traLoiMucNuoc(stTD) + '\n' : ''}Hiện chưa có dự báo mực nước ${cfg.ten}${lyDo}.`;
        }));
        return kqs.join('\n\n');
      }
      if (nuoc.length) {
        return nuoc.slice(0, 3).map((s) => `${traLoiMucNuoc(s)}\nTrạm ${s.name} chưa có dự báo mực nước (hiện có Đồng Tâm, Mai Hóa, Kiến Giang, Lệ Thủy), anh/chị xem số liệu thực đo ở trên.`).join('\n\n');
      }
      if (!xa.length && !tram.length && (coTu(q, ['du bao']) || coMoc || hoiDinh)) return 'Hiện app có dự báo mực nước 6, 12, 18, 24 giờ tới cho trạm Đồng Tâm, Mai Hóa, Kiến Giang và Lệ Thủy. Anh/chị cho em tên trạm, ví dụ "mực nước Mai Hóa".';
    }

    // 1) Số liệu thực đo theo tên trạm
    if (!hoiDuBao && (tram.length || nuoc.length) && !huongDan) {
      const out = [];
      if (tram.length && (hoiMua || !hoiNuoc)) tram.slice(0, 3).forEach((s) => out.push(traLoiMua(s)));
      if (nuoc.length && (hoiNuoc || !hoiMua)) nuoc.slice(0, 3).forEach((s) => out.push(traLoiMucNuoc(s)));
      if (out.length) return out.join('\n\n');
    }
    // 2) Dự báo xã/phường (nêu tên, hoặc xã đang chọn) — 1 ngày, nhiều ngày hoặc ngày cụ thể
    if (hoiDuBao || xa.length) {
      if (!huongDan || xa.length) {
        if (yc.loi) return yc.loi;
        let ten; let center;
        if (xa.length) { ten = xa[0].name; center = L.geoJSON(xa[0].feature).getBounds().getCenter(); }
        else if ((tram.length || nuoc.length) && !selectedFeature) return 'Dự báo của app tính theo xã/phường. Anh/chị cho em tên xã/phường (ví dụ "dự báo Đông Hà 5 ngày tới"), hoặc chọn xã trên bản đồ trước.';
        else if (selectedFeature) { ten = selectedFeature.name; center = selectedFeature.center; }
        else return 'Anh/chị cho em biết xã/phường cần xem (ví dụ: "dự báo Đông Hà ngày mai"), hoặc chọn xã trên bản đồ trước.';
        const kq = await traLoiDuBao(ten, center, yc.dates);
        return kq + (yc.ghiChu || '');
      }
    }
    // 3) Tổng quan mưa / mực nước
    if (hoiMua && coTu(q, TK.tongQuanMua)) {
      const ds = rainStations.filter((s) => Number(s.rain_24h) > 0).sort((a, b) => b.rain_24h - a.rain_24h).slice(0, 5);
      if (!ds.length) return '💧 Hiện chưa trạm nào ghi nhận mưa trong 24h qua (hoặc chưa có số liệu).';
      return '💧 Mưa 24h lớn nhất:\n' + ds.map((s, i) => `${i + 1}. ${s.name}: ${s.rain_24h}mm (3h: ${s.rain_3h ?? '—'}mm)`).join('\n');
    }
    if (hoiNuoc || coTu(q, ['tram nuoc'])) {
      const ds = mucNuocStations.map((s) => ({ s, ...tomTatMucNuoc(s.series) })).filter((x) => x.current != null);
      if (!ds.length) return '🌊 Hiện chưa có số liệu mực nước.';
      const vuot = ds.filter((x) => x.s.alertInfo && /trên|TRÊN/.test(capBaoDong(x.current, x.s.alertInfo)));
      const dong = vuot.length ? 'Trạm đang vượt ngưỡng:\n' + vuot.map((x) => `• ${x.s.name}: ${x.current}m — ${capBaoDong(x.current, x.s.alertInfo)}`).join('\n') : 'Chưa trạm nào vượt báo động/ngưỡng cảnh báo.';
      const len = ds.filter((x) => x.change24h > 0.3).sort((a, b) => b.change24h - a.change24h).slice(0, 3);
      return `🌊 Mực nước (${ds.length} trạm):\n${dong}${len.length ? '\nĐang lên nhanh (24h): ' + len.map((x) => `${x.s.name} ${dau(x.change24h)}m`).join(', ') : ''}\n(Hỏi tên trạm để xem chi tiết, ví dụ "mực nước Mai Hóa")`;
    }
    if (hoiMua) return 'Anh/chị cho em tên trạm (ví dụ "mưa Đồng Tâm"), hoặc hỏi "mưa nhiều nhất hiện nay".';
    // 4) Hướng dẫn
    const ds = HD.filter((h) => coTu(q, h.k));
    if (huongDan || coTu(q, ['huong dan'])) {
      if (ds.length) return ds.slice(0, 2).map((h) => h.a).join('\n\n');
      return 'Em hướng dẫn được: chọn xã/phường · chọn ngày · trạm mưa · trạm mực nước · radar · định vị · menu chức năng · dự báo mực nước Mai Hóa/Đồng Tâm · cài app · giọng nói. Anh/chị muốn xem mục nào?';
    }
    if (ds.length) return ds[0].a;
    const ai = await goiAI(raw, { rainStations, mucNuocStations, selectedFeature, selectedDate });
    if (ai) return ai;
    return 'Em chưa hiểu câu hỏi. Anh/chị thử: "Hướng dẫn sử dụng", "Mưa Đồng Tâm", "Mực nước Mai Hóa", "Dự báo Đông Hà 5 ngày tới".';
  }

  async function gui(text, opts = {}) {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text: t }]);
    setBusy(true);
    let kq;
    try { kq = await traLoi(t); } catch (e) { console.error('[Trợ lý]', e); kq = 'Có lỗi khi xử lý, anh/chị thử lại.'; }
    setMsgs((m) => [...m, { role: 'bot', text: kq }]);
    setBusy(false);
    if ((opts.noi || docTo) && coGiong) noiThanhTieng(kq);
  }
  guiRef.current = gui;

  function batDauNghe() {
    if (!SR || busy) return;
    if (nghe) { recRef.current?.stop?.(); return; }
    window.speechSynthesis?.cancel();
    try {
      if (!localStorage.getItem('tl_mic_luu_y')) {
        setMsgs((m) => [...m, { role: 'bot', text: '🎤 Lưu ý: khi nói, trình duyệt (Chrome/Edge) gửi đoạn âm thanh lên máy chủ của hãng để chuyển thành chữ. Hãy cho phép micro khi trình duyệt hỏi, rồi nói câu hỏi.' }]);
        localStorage.setItem('tl_mic_luu_y', '1');
      }
    } catch { /* bỏ qua khi không dùng được localStorage */ }
    const rec = new SR();
    rec.lang = 'vi-VN'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let cuoi = ''; let loi = false;
    rec.onresult = (e) => {
      const t = Array.from(e.results).map((r) => r[0].transcript).join('');
      setInput(t);
      if (e.results[e.results.length - 1].isFinal) cuoi = t;
    };
    rec.onerror = (e) => {
      loi = true;
      const thongBao = e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Trình duyệt chưa cho phép dùng micro. Anh/chị bấm biểu tượng ổ khóa cạnh địa chỉ trang, chọn cho phép Micro rồi thử lại.'
        : e.error === 'no-speech' ? 'Em chưa nghe thấy giọng nói, anh/chị bấm micro và nói lại nhé.'
          : e.error === 'network' ? 'Không kết nối được dịch vụ nhận dạng giọng nói (cần mạng). Anh/chị gõ chữ giúp em nhé.'
            : e.error === 'aborted' ? '' : 'Không nhận dạng được giọng nói, anh/chị thử lại hoặc gõ chữ.';
      if (thongBao) setMsgs((m) => [...m, { role: 'bot', text: thongBao }]);
    };
    rec.onend = () => {
      setNghe(false); recRef.current = null;
      if (!loi && cuoi.trim()) guiRef.current(cuoi, { noi: true });
      else if (!loi) setInput('');
    };
    recRef.current = rec;
    try { rec.start(); setNghe(true); } catch { setNghe(false); recRef.current = null; }
  }

  function dong() {
    recRef.current?.abort?.();
    window.speechSynthesis?.cancel();
    setOpen(false);
  }
  function batTatDoc() {
    if (docTo) window.speechSynthesis?.cancel();
    setDocTo((v) => !v);
  }

  return (
    <>
      {!open && (
        <button className="tl-fab" onClick={() => setOpen(true)} aria-label="Mở trợ lý" title="Hỏi trợ lý"><TroLyAvatar /></button>
      )}
      {open && (
        <div className="tl-panel" role="dialog" aria-label="Trợ lý">
          <div className="tl-head">
            <span className="tl-title"><TroLyAvatar size={30} />Trợ lý Thời tiết Quảng Trị</span>
            <span className="tl-head-btns">
              {coGiong && <button onClick={batTatDoc} aria-label={docTo ? 'Tắt đọc to' : 'Bật đọc to'} title={docTo ? 'Đang đọc to mọi câu trả lời — bấm để tắt' : 'Bật đọc to mọi câu trả lời'}>{docTo ? '🔊' : '🔇'}</button>}
              <button onClick={dong} aria-label="Đóng">✕</button>
            </span>
          </div>
          <div className="tl-body">
            {msgs.map((m, i) => (m.role === 'bot'
              ? <div key={i} className="tl-row"><TroLyAvatar size={28} /><div className="tl-msg tl-msg--bot">{m.text}</div></div>
              : <div key={i} className="tl-msg tl-msg--user">{m.text}</div>))}
            {busy && <div className="tl-row"><TroLyAvatar size={28} /><div className="tl-msg tl-msg--bot">⏳ Đang xử lý...</div></div>}
            <div ref={endRef} />
          </div>
          <div className="tl-chips">
            {GOI_Y.map((g) => <button key={g} onClick={() => gui(g)} disabled={busy}>{g}</button>)}
          </div>
          <form className="tl-input" onSubmit={(e) => { e.preventDefault(); gui(); }}>
            {SR && (
              <button type="button" className={`tl-mic${nghe ? ' tl-mic--on' : ''}`} onClick={batDauNghe} disabled={busy} aria-label={nghe ? 'Dừng nghe' : 'Nói câu hỏi'} title={nghe ? 'Đang nghe — bấm để dừng' : 'Bấm để nói câu hỏi'}>🎤</button>
            )}
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={nghe ? 'Đang nghe... hãy nói' : 'Nhập câu hỏi...'} />
            <button type="submit" disabled={busy || !input.trim()}>Gửi</button>
          </form>
        </div>
      )}
    </>
  );
}

// Điểm cắm AI (Lớp 2). Hiện trả null -> trợ lý dùng kịch bản. Sau này: POST tới
// Netlify Function (giữ khóa API phía máy chủ), gửi câu hỏi + số liệu đã tóm tắt,
// bắt buộc AI chỉ diễn đạt lại số liệu đó.
async function goiAI(/* cauHoi, ngCanh */) { return null; }
