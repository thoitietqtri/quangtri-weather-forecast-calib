import { useState, useRef, useEffect } from 'react';
import L from 'leaflet';
import './TroLyAI.css';

// ===== Trợ lý theo kịch bản (Lớp 1 — không dùng AI, không tốn phí) =====
// Mọi con số do CODE lấy từ dữ liệu app đang có, không bịa. Muốn gắn AI sau này
// (Claude API/Groq...) chỉ cần điền hàm goiAI() ở cuối file; không đụng gì khác.

const chuanHoa = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
const coTu = (q, list) => list.some((k) => q.includes(k));
const layTen = (f) => f.properties?.ten || f.properties?.Ten || f.properties?.name || '';

// Tìm các tên (trạm/xã) xuất hiện trong câu hỏi; bỏ tên là phần con của tên dài hơn.
function timTen(q, danhSach, getName) {
  const hits = danhSach.map((x) => ({ x, n: chuanHoa(getName(x)) })).filter((h) => h.n && q.includes(h.n));
  return hits.filter((h) => !hits.some((o) => o !== h && o.n.length > h.n.length && o.n.includes(h.n))).map((h) => h.x);
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
const gio = (t) => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
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

const homNay = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d; };
const ymd = (d) => d.toISOString().slice(0, 10);

function layNgay(q, ngayDangChon) {
  const d = homNay();
  if (q.includes('ngay kia') || q.includes('ngay mot')) d.setDate(d.getDate() + 2);
  else if (q.includes('ngay mai') || q.includes('mai ')) d.setDate(d.getDate() + 1);
  else if (q.includes('hom nay')) { /* hôm nay */ }
  else if (ngayDangChon) return ngayDangChon;
  return ymd(d);
}

async function traLoiDuBao(ten, center, ngay) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&timezone=auto&models=ecmwf_ifs&start_date=${ngay}&end_date=${ngay}`;
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error(r.status);
    const d = (await r.json()).daily;
    const tmax = d.temperature_2m_max[0]; const tmin = d.temperature_2m_min[0];
    const rain = d.precipitation_sum[0]; const wind = parseFloat((d.windspeed_10m_max[0] / 3.6).toFixed(1));
    if (tmax == null) return `Chưa có dự báo cho ${ten} ngày ${ngay}.`;
    const w = canhBao(tmax, tmin, wind, rain);
    return `📍 Dự báo ${ten} — ngày ${ngay} (ECMWF IFS):\n• Nhiệt độ: ${tmin}–${tmax}°C\n• Mưa: ${rain} mm\n• Gió mạnh nhất: ${wind} m/s\n${w.length ? '⚠️ Cảnh báo: ' + w.join('; ') : '✅ Không có cảnh báo thiên tai'}`;
  } catch (e) {
    return 'Không tải được dự báo (mạng chậm hoặc máy chủ bận), anh/chị thử lại sau.';
  } finally { clearTimeout(timer); }
}

// ---- Hướng dẫn sử dụng ----
const HUONG_DAN = [
  { k: ['chon xa', 'chon phuong', 'xem du bao', 'dia danh'], a: '📍 Chọn xã/phường: dùng ô "Chọn xã/phường" ở thanh trên cùng, hoặc bấm trực tiếp vào xã trên bản đồ. Popup hiện nhiệt độ, mưa, gió và cảnh báo; biểu đồ theo giờ hiện dưới bản đồ.' },
  { k: ['ngay', 'lich', 'hom khac'], a: '📅 Ô "Ngày" chọn được tối đa +13 ngày kể từ hôm nay. Chọn xã trước rồi đổi ngày, dự báo sẽ tải lại.' },
  { k: ['tram mua', 'giot nuoc', 'mau mua', 'chu thich'], a: '💧 Tick "Trạm mưa" để hiện trạm đo. Màu theo mưa 24h: xám 0mm · xanh dương <25 · xanh lá 25–50 · cam 50–100 · đỏ nhấp nháy >100mm. Bấm vào trạm xem 1h/3h/6h/24h/48h/72h.' },
  { k: ['tram muc nuoc', 'bao dong', 'mau muc nuoc'], a: '🌊 Tick "Trạm mực nước". Màu theo cấp báo động của từng trạm: xanh dưới BĐI · vàng BĐI · cam BĐII · đỏ ≥BĐIII. Trạm hồ chứa chưa phân cấp nên màu xám.' },
  { k: ['radar'], a: '📡 Tick "Ảnh radar" để phủ ảnh radar tổ hợp lên bản đồ, tự làm mới 10 phút/lần; bỏ tick là dừng.' },
  { k: ['dinh vi', 'vi tri cua toi', 'gps'], a: '📍 Nút định vị (trên bản đồ) đưa bản đồ tới vị trí của anh/chị — cần cho phép truy cập vị trí. Nút 🏠 đưa về toàn tỉnh Quảng Trị.' },
  { k: ['menu', 'chuc nang', 'bang', 'bieu do', 'thoi doan'], a: '☰ Menu (góc trên trái) có: mưa thực đo theo thời đoạn/giờ, đồ thị mưa, mực nước thực đo, biểu đồ mực nước, mực nước hiện hành (cột), bảng dự báo mưa/nhiệt/gió và dự báo mực nước khi có lũ.' },
  { k: ['mai hoa', 'dong tam', 'du bao muc nuoc', 'dinh lu'], a: '🌊 Dự báo mực nước khi có lũ: Menu → "Dự báo Mực nước (khi có lũ)" → Sông Gianh → Đồng Tâm hoặc Mai Hóa. Các trạm khác đang xây dựng.' },
  { k: ['cai dat', 'cai app', 'install', 'man hinh chinh'], a: '📲 Dùng nút cài đặt ở thanh công cụ (hoặc "Thêm vào màn hình chính" của trình duyệt) để cài app như ứng dụng điện thoại.' },
  { k: ['mau nhiet', 'mau xa', 'mang song', 'lop'], a: '🎛️ Các ô tick dưới thanh chọn xã: Trạm mưa, Trạm mực nước, Mạng lưới sông, Màu nhiệt độ xã, Ảnh radar — bật/tắt từng lớp trên bản đồ.' },
];
const GOI_Y = ['Hướng dẫn sử dụng', 'Mưa nhiều nhất hiện nay', 'Mực nước các trạm', 'Dự báo ngày mai'];
const LOI_CHAO = 'Xin chào! Em là trợ lý của app Thời tiết Quảng Trị. Anh/chị hỏi về cách dùng app, mưa và mực nước hiện tại, hoặc dự báo một xã/phường (ví dụ: "mưa Đồng Tâm", "mực nước Mai Hóa", "dự báo Đông Hà ngày mai").\nSố liệu chỉ để tham khảo, tin chính thức theo bản tin của Đài KTTV.';

export default function TroLyAI({ rainStations = [], mucNuocStations = [], featureList = [], selectedFeature = null, selectedDate = '' }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([{ role: 'bot', text: LOI_CHAO }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, open]);

  async function traLoi(raw) {
    const q = chuanHoa(raw);
    const tram = timTen(q, rainStations, (s) => s.name);
    const nuoc = timTen(q, mucNuocStations, (s) => s.name);
    const xa = timTen(q, featureList, (f) => f.name);
    const hoiMua = coTu(q, ['mua', 'tram mua']);
    const hoiNuoc = coTu(q, ['nuoc', 'lu', 'bao dong', 'muc']);
    const hoiDuBao = coTu(q, ['du bao', 'ngay mai', 'ngay kia', 'nhiet', 'nong', 'ret', 'gio', 'thoi tiet']);
    const huongDan = coTu(q, ['huong dan', 'cach', 'lam sao', 'lam the nao', 'o dau', 'bam', 'su dung', 'chuc nang']);

    // 1) Số liệu thực đo theo tên trạm
    if (!hoiDuBao && (tram.length || nuoc.length) && !huongDan) {
      const out = [];
      if (tram.length && (hoiMua || !hoiNuoc)) tram.slice(0, 3).forEach((s) => out.push(traLoiMua(s)));
      if (nuoc.length && (hoiNuoc || !hoiMua)) nuoc.slice(0, 3).forEach((s) => out.push(traLoiMucNuoc(s)));
      if (out.length) return out.join('\n\n');
    }
    // 2) Dự báo xã/phường (đã nêu tên, hoặc xã đang chọn)
    if (hoiDuBao || xa.length) {
      if (!huongDan || xa.length) {
        let ten; let center;
        if (xa.length) { ten = xa[0].name; center = L.geoJSON(xa[0].feature).getBounds().getCenter(); }
        else if (selectedFeature) { ten = selectedFeature.name; center = selectedFeature.center; }
        else return 'Anh/chị cho em biết xã/phường cần xem (ví dụ: "dự báo Đông Hà ngày mai"), hoặc chọn xã trên bản đồ trước.';
        return traLoiDuBao(ten, center, layNgay(q, selectedDate));
      }
    }
    // 3) Tổng quan mưa / mực nước
    if (hoiMua && coTu(q, ['nhieu nhat', 'lon nhat', 'cao nhat', 'tong quan', 'hien nay', 'dang mua'])) {
      const ds = rainStations.filter((s) => Number(s.rain_24h) > 0).sort((a, b) => b.rain_24h - a.rain_24h).slice(0, 5);
      if (!ds.length) return '💧 Hiện chưa trạm nào ghi nhận mưa trong 24h qua (hoặc chưa có số liệu).';
      return '💧 Mưa 24h lớn nhất:\n' + ds.map((s, i) => `${i + 1}. ${s.name}: ${s.rain_24h}mm (3h: ${s.rain_3h ?? '—'}mm)`).join('\n');
    }
    if (hoiNuoc || coTu(q, ['tram nuoc'])) {
      const ds = mucNuocStations.map((s) => ({ s, ...tomTatMucNuoc(s.series) })).filter((x) => x.current != null);
      if (!ds.length) return '🌊 Hiện chưa có số liệu mực nước.';
      const vuot = ds.filter((x) => x.s.alertInfo && capBaoDong(x.current, x.s.alertInfo).match(/trên|TRÊN/));
      const dong = vuot.length ? 'Trạm đang vượt ngưỡng:\n' + vuot.map((x) => `• ${x.s.name}: ${x.current}m — ${capBaoDong(x.current, x.s.alertInfo)}`).join('\n') : 'Chưa trạm nào vượt báo động/ngưỡng cảnh báo.';
      const len = ds.filter((x) => x.change24h > 0.3).sort((a, b) => b.change24h - a.change24h).slice(0, 3);
      return `🌊 Mực nước (${ds.length} trạm):\n${dong}${len.length ? '\nĐang lên nhanh (24h): ' + len.map((x) => `${x.s.name} ${dau(x.change24h)}m`).join(', ') : ''}\n(Hỏi tên trạm để xem chi tiết, ví dụ "mực nước Mai Hóa")`;
    }
    if (hoiMua) {
      return 'Anh/chị cho em tên trạm (ví dụ "mưa Đồng Tâm"), hoặc hỏi "mưa nhiều nhất hiện nay".';
    }
    // 4) Hướng dẫn
    if (huongDan || q.includes('huong dan')) {
      const ds = HUONG_DAN.filter((h) => coTu(q, h.k));
      if (ds.length) return ds.slice(0, 2).map((h) => h.a).join('\n\n');
      return 'Em hướng dẫn được: chọn xã/phường · chọn ngày · trạm mưa · trạm mực nước · radar · định vị · menu chức năng · dự báo mực nước Mai Hóa/Đồng Tâm · cài app. Anh/chị muốn xem mục nào?';
    }
    const ds = HUONG_DAN.filter((h) => coTu(q, h.k));
    if (ds.length) return ds[0].a;
    const ai = await goiAI(raw, { rainStations, mucNuocStations, selectedFeature, selectedDate });
    if (ai) return ai;
    return 'Em chưa hiểu câu hỏi. Anh/chị thử: "Hướng dẫn sử dụng", "Mưa Đồng Tâm", "Mực nước Mai Hóa", "Dự báo Đông Hà ngày mai".';
  }

  async function gui(text) {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text: t }]);
    setBusy(true);
    let kq;
    try { kq = await traLoi(t); } catch (e) { console.error('[Trợ lý]', e); kq = 'Có lỗi khi xử lý, anh/chị thử lại.'; }
    setMsgs((m) => [...m, { role: 'bot', text: kq }]);
    setBusy(false);
  }

  return (
    <>
      {!open && (
        <button className="tl-fab" onClick={() => setOpen(true)} aria-label="Mở trợ lý" title="Hỏi trợ lý">💬</button>
      )}
      {open && (
        <div className="tl-panel" role="dialog" aria-label="Trợ lý">
          <div className="tl-head">
            <span>🤖 Trợ lý Thời tiết Quảng Trị</span>
            <button onClick={() => setOpen(false)} aria-label="Đóng">✕</button>
          </div>
          <div className="tl-body">
            {msgs.map((m, i) => <div key={i} className={`tl-msg tl-msg--${m.role}`}>{m.text}</div>)}
            {busy && <div className="tl-msg tl-msg--bot">⏳ Đang xử lý...</div>}
            <div ref={endRef} />
          </div>
          <div className="tl-chips">
            {GOI_Y.map((g) => <button key={g} onClick={() => gui(g)} disabled={busy}>{g}</button>)}
          </div>
          <form className="tl-input" onSubmit={(e) => { e.preventDefault(); gui(); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Nhập câu hỏi..." />
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
