import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList, ReferenceArea, ResponsiveContainer } from 'recharts';
import './MuaThoiDoanChart.css';
import { layLuuVucMua, layTenHienThi } from './luuVucSong';

const GIO = 3600 * 1000;
const VN = 7 * GIO;

// Thang màu tổng lượng mưa — thống nhất với bảng "Mưa thực đo theo thời đoạn".
function mauMua(mm) {
  if (mm == null) return '#9E9E9E';
  if (mm <= 25) return '#1565C0';
  if (mm <= 50) return '#2E7D32';
  if (mm <= 100) return '#F9A825';
  return '#D32F2F';
}

const p2 = (n) => String(n).padStart(2, '0');
// epoch -> "yyyy-MM-ddTHH:mm" theo giờ VN (dùng cho <input type="datetime-local">)
function toInput(t) {
  const d = new Date(t + VN);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
// "yyyy-MM-ddTHH:mm" (giờ VN) -> epoch
function fromInput(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - VN;
}
function vnText(t) {
  const d = new Date(t + VN);
  return `${p2(d.getUTCHours())}h${p2(d.getUTCMinutes())} ngày ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function useKhung() {
  const get = () => (typeof window === 'undefined' ? { w: 1200, h: 800 } : { w: window.innerWidth, h: window.innerHeight });
  const [k, setK] = useState(get);
  useEffect(() => {
    const f = () => setK(get());
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f); };
  }, []);
  return k;
}

const XAH = 74;     // chiều cao vùng tên trạm dưới trục
const NHOM_H = 34;  // chỗ dành cho dòng nhóm lưu vực dưới cùng

// Nhãn giá trị trên đầu cột; cột hẹp thì viết dọc.
function NhanGiaTri({ x, y, width, value, index, data, doc }) {
  const d = data[index];
  if (!d || value == null) return null;
  const cx = x + width / 2;
  const txt = Number(value).toFixed(1);
  if (doc) {
    return <text transform={`translate(${cx + 3},${y - 4}) rotate(-90)`} fontSize="9" fontWeight="700" fill="#222">{txt}</text>;
  }
  return <text x={cx} y={y - 5} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#222">{txt}</text>;
}

function NhanTram({ x, y, payload, ten, doc }) {
  return (
    <g transform={`translate(${x},${y + 6}) rotate(${doc ? -90 : -45})`}>
      <text x={doc ? -2 : 0} y={doc ? 3 : 0} textAnchor="end" fontSize={doc ? 8.5 : 10.5} fill="#333">{ten[payload.value] || payload.value}</text>
    </g>
  );
}

// stations: [{ id, name, series: [{t, v}] }, ...] — cùng dữ liệu "Mưa theo giờ" (rainfall-hourly), không gọi thêm API.
export default function MuaThoiDoanChart({ stations, onClose }) {
  // Khoảng thời gian có dữ liệu chung của các trạm.
  const { tMin, tMax } = useMemo(() => {
    let lo = Infinity; let hi = -Infinity;
    for (const s of stations) for (const p of s.series || []) { if (p.t < lo) lo = p.t; if (p.t > hi) hi = p.t; }
    return { tMin: lo, tMax: hi };
  }, [stations]);
  const coDuLieu = Number.isFinite(tMax);

  // Mặc định 12 giờ gần nhất (như ảnh mẫu: 18h → 06h).
  const [bd, setBd] = useState(() => (coDuLieu ? toInput(tMax - 12 * GIO) : ''));
  const [kt, setKt] = useState(() => (coDuLieu ? toInput(tMax) : ''));
  const tBd = fromInput(bd);
  const tKt = fromInput(kt);
  const hopLe = tBd != null && tKt != null && tBd < tKt;

  const datNhanh = (gio) => { if (!coDuLieu) return; setKt(toInput(tMax)); setBd(toInput(tMax - gio * GIO)); };

  // Tổng mưa mỗi trạm trong (bd, kt]: mốc giờ t là lượng mưa tích đến giờ t (giờ 19h = mưa 18h–19h).
  const { data, nhom, ten, max } = useMemo(() => {
    const list = [];
    if (hopLe) {
      for (const s of stations) {
        if (!s.series || s.series.length === 0) continue;
        let tong = 0; let dem = 0;
        for (const p of s.series) if (p.t > tBd && p.t <= tKt) { tong += p.v || 0; dem += 1; }
        if (dem === 0) continue; // trạm không có số liệu trong khoảng này -> không vẽ cột
        const lv = layLuuVucMua(s.name);
        list.push({ id: s.id, ten: layTenHienThi(s.name), v: Math.round(tong * 10) / 10, thuTu: lv.thuTu, luuVuc: lv.luuVuc || 'Khác' });
      }
      list.sort((a, b) => a.thuTu - b.thuTu); // theo lưu vực (Bắc → Nam), cùng thứ tự bảng mưa
    }
    const groups = [];
    list.forEach((r) => {
      const g = groups[groups.length - 1];
      if (g && g.ten === r.luuVuc) { g.cuoi = r.id; g.n += 1; } else groups.push({ ten: r.luuVuc, dau: r.id, cuoi: r.id, n: 1 });
    });
    const tenMap = {};
    list.forEach((r) => { tenMap[r.id] = r.ten; });
    const m = list.reduce((a, r) => Math.max(a, r.v), 0);
    const buoc = m <= 20 ? 5 : m <= 60 ? 10 : m <= 150 ? 25 : 50;
    return { data: list, nhom: groups, ten: tenMap, max: Math.max(buoc, Math.ceil((m * 1.12 + 1) / buoc) * buoc) };
  }, [stations, hopLe, tBd, tKt]);

  // ---- Kích thước / chế độ điện thoại ----
  const khung = useKhung();
  const [ngangTay, setNgangTay] = useState(false);
  const dienThoaiDoc = khung.w < 700 && khung.w < khung.h;
  const ngang = ngangTay && dienThoaiDoc;
  const w = ngang ? khung.h : khung.w;
  const h = ngang ? khung.w : khung.h;
  const gon = w < 700 || h < 560;
  const doc = w < 700;
  const kieuPanel = ngang
    ? { position: 'fixed', top: 0, left: khung.w, width: khung.h, height: khung.w, maxHeight: 'none', transformOrigin: '0 0', transform: 'rotate(90deg)' }
    : undefined;
  const chieuCao = !gon ? 440 : Math.max(250, Math.min(h - 235, doc ? 520 : 440));
  const bRongKhung = Math.max(300, w - (gon ? 14 : 64));
  const rongToiThieuCot = doc ? 12 : 17;
  const rongBieuDo = Math.max(bRongKhung, data.length * rongToiThieuCot + 50);
  const rongCot = (rongBieuDo - 50) / Math.max(1, data.length);
  const dungDoc = rongCot < 26; // cột hẹp: nhãn giá trị viết dọc

  return (
    <div className={`mtd-overlay${gon ? ' mtd-hep' : ''}`} onClick={onClose}>
      <div className="mtd-panel" style={kieuPanel} onClick={(e) => e.stopPropagation()}>
        <div className="mtd-header">
          <h3>📊 Đồ thị mưa theo thời đoạn</h3>
          <div className="mtd-actions">
            {dienThoaiDoc && (
              <button className="mtd-rotate" onClick={() => setNgangTay((v) => !v)}>{ngang ? '↺ Xem dọc' : '⟳ Xem ngang'}</button>
            )}
            <button className="mtd-close" onClick={onClose} aria-label="Đóng">✕</button>
          </div>
        </div>

        <div className="mtd-controls">
          <label>Từ <input type="datetime-local" step="3600" value={bd} min={coDuLieu ? toInput(tMin) : undefined} max={kt || undefined} onChange={(e) => setBd(e.target.value)} /></label>
          <label>Đến <input type="datetime-local" step="3600" value={kt} min={bd || undefined} max={coDuLieu ? toInput(tMax) : undefined} onChange={(e) => setKt(e.target.value)} /></label>
          <span className="mtd-nhanh">
            {[3, 6, 12, 24, 48, 72].map((g) => <button key={g} onClick={() => datNhanh(g)}>{g}h</button>)}
          </span>
        </div>

        <div className="mtd-body">
          {!coDuLieu ? (
            <div className="mtd-empty">⏳ Chưa có dữ liệu mưa theo giờ</div>
          ) : !hopLe ? (
            <div className="mtd-empty">Thời gian bắt đầu phải trước thời gian kết thúc.</div>
          ) : data.length === 0 ? (
            <div className="mtd-empty">Không có số liệu mưa trong khoảng thời gian này.</div>
          ) : (
            <>
              <div className="mtd-title">ĐỒ THỊ TỔNG LƯỢNG MƯA THEO TRẠM (mm)</div>
              <div className="mtd-sub">Thời gian tính từ {vnText(tBd)} đến {vnText(tKt)}.</div>
              <div className="mtd-scroll">
                <div style={{ width: rongBieuDo, height: chieuCao }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: dungDoc ? 40 : 24, right: 6, left: 0, bottom: NHOM_H }}>
                      {nhom.map((g, i) => (
                        <ReferenceArea
                          key={`${g.ten}-${i}`}
                          x1={g.dau}
                          x2={g.cuoi}
                          fill={i % 2 === 0 ? '#E8F0FB' : '#FFFFFF'}
                          fillOpacity={0.7}
                          stroke="none"
                          ifOverflow="visible"
                          label={{
                            position: 'insideBottom',
                            content: ({ viewBox }) => {
                              if (!viewBox) return null;
                              const cx = viewBox.x + viewBox.width / 2;
                              const yb = viewBox.y + viewBox.height + XAH + 6 + (viewBox.width < 60 && i % 2 === 1 ? 13 : 0);
                              return (
                                <g>
                                  <line x1={viewBox.x + 2} x2={viewBox.x + viewBox.width - 2} y1={yb - 11} y2={yb - 11} stroke="#4CAF50" strokeWidth="2" />
                                  <text x={cx} y={yb + 2} textAnchor="middle" fontSize={doc ? 9 : 11} fontWeight="700" fill="#2E5E2F">{g.ten}</text>
                                </g>
                              );
                            },
                          }}
                        />
                      ))}
                      <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#ccc" />
                      <XAxis dataKey="id" interval={0} tick={<NhanTram ten={ten} doc={doc} />} height={XAH} />
                      <YAxis domain={[0, max]} tickCount={6} allowDecimals={false} width={doc ? 28 : 40} tick={{ fontSize: doc ? 9 : 11 }} />
                      <Bar dataKey="v" isAnimationActive={false} maxBarSize={26}>
                        {data.map((r) => <Cell key={r.id} fill={mauMua(r.v)} />)}
                        <LabelList dataKey="v" content={(pr) => <NhanGiaTri {...pr} data={data} doc={dungDoc} />} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="mtd-legend">
                <span><i style={{ background: '#1565C0' }} />0–25mm</span>
                <span><i style={{ background: '#2E7D32' }} />&gt;25–50mm</span>
                <span><i style={{ background: '#F9A825' }} />&gt;50–100mm</span>
                <span><i style={{ background: '#D32F2F' }} />&gt;100mm</span>
              </div>
              <div className="mtd-foot">Nguồn: số liệu mưa thực đo các trạm KTTV và VRain. Cột xếp theo lưu vực (Bắc → Nam). Tham khảo - Không thay thế bản tin chính thức từ Đài KTTV tỉnh Quảng Trị.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
