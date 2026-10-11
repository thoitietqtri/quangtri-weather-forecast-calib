import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList, ResponsiveContainer } from 'recharts';
import './MucNuocHienHanh.css';

const MAU_XAM = '#9E9E9E';

function formatCapNhat(t) {
  const d = new Date(t + 7 * 3600 * 1000); // giờ VN
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}H NGÀY ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// Chỉ lấy 17 trạm KTTV (id kttv_...), hiện tên dạng "TV <tên>", tên theo cách gọi trong bản tin.
const TEN_HIEN_THI = { 'Đông Tâm': 'Đồng Tâm', Dakrong: 'Đakrông' };

// Màu theo cấp báo động — cùng bảng màu với icon bản đồ và bảng mực nước.
const MAU_BD = { duoi: '#1976D2', 1: '#F9A825', 2: '#EF6C00', 3: '#D32F2F' };

// Kích thước cửa sổ trình duyệt — để đồ thị luôn vừa khung hiện tại (xoay ngang điện thoại thì tự giãn ra).
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

// Giá trị mới nhất của trạm (cuối chuỗi) so với cấp báo động của CHÍNH trạm đó
// (station.alertInfo do backend cung cấp, không lưu ngưỡng riêng ở frontend).
//   - Đã vượt: ">BĐx d" ở cấp cao nhất đã vượt, tô màu theo cấp (I vàng, II cam, III đỏ).
//   - Chưa vượt cấp thấp nhất: "<BĐI d" — xanh.
//   - Trạm ngưỡng tự quy định: CB (cảnh báo, cam) / NH (nguy hiểm, đỏ).
//   - Không có alertInfo: xám.
function soSanh(current, alertInfo) {
  if (current == null || !alertInfo) return { mau: MAU_XAM, text: 'Không có thông tin so sánh', vuot: false };
  const cap = alertInfo.type === 'official'
    ? [['BĐI', alertInfo.bd1, MAU_BD[1]], ['BĐII', alertInfo.bd2, MAU_BD[2]], ['BĐIII', alertInfo.bd3, MAU_BD[3]]]
    : [['CB', alertInfo.binhThuongMax, MAU_BD[2]], ['NH', alertInfo.nguyHiemMin, MAU_BD[3]]];
  let vuot = null;
  for (const c of cap) if (c[1] != null && current >= c[1]) vuot = c;
  if (vuot) return { mau: vuot[2], text: `>${vuot[0]} ${(current - vuot[1]).toFixed(2)}`, vuot: true };
  return { mau: MAU_BD.duoi, text: `<${cap[0][0]} ${(cap[0][1] - current).toFixed(2)}`, vuot: false };
}

// Nhãn trên đầu cột. Cột hẹp (điện thoại dọc): viết DỌC (xoay -90°) để 17 cột không đè nhau.
function NhanCot({ x, y, width, value, index, data, doc }) {
  const d = data[index];
  if (!d || value == null) return null;
  const cx = x + width / 2;
  const gt = `${Number(value).toFixed(2)} m`;
  const ct = d.text.includes('Không có') ? 'Không có thông tin so sánh' : d.text;
  if (doc) {
    return (
      <text transform={`translate(${cx + 3},${y - 5}) rotate(-90)`} fontSize="9.5">
        <tspan fontWeight="700" fill="#222">{gt}</tspan>
        <tspan dx="5" fontSize="8.5" fontWeight={d.vuot ? 800 : 500} fill={d.mauChu}>{ct}</tspan>
      </text>
    );
  }
  return (
    <g>
      <text x={cx} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#222">{gt}</text>
      {d.text.includes('Không có') ? (
        <text textAnchor="middle" fontSize="9.5" fill={d.mauChu}>
          <tspan x={cx} y={y - 31}>Không có</tspan>
          <tspan x={cx} y={y - 20}>thông tin</tspan>
        </text>
      ) : (
        <text x={cx} y={y - 20} textAnchor="middle" fontSize="9.5" fontWeight={d.vuot ? 800 : 500} fill={d.mauChu}>{d.text}</text>
      )}
    </g>
  );
}

function NhanTrucX({ x, y, payload, doc }) {
  return (
    <g transform={`translate(${x},${y + 6}) rotate(${doc ? -60 : -40})`}>
      <text textAnchor="end" fontSize={doc ? 9.5 : 11} fill="#333">{payload.value}</text>
    </g>
  );
}

// stations: [{ id, name, coords, alertInfo, series: [{t, v}] }, ...] — cùng nguồn với bảng/biểu đồ mực nước.
export default function MucNuocHienHanh({ stations, onClose }) {
  const { data, capNhat, max } = useMemo(() => {
    const list = [];
    let tMoi = 0;
    for (const s of stations) {
      if (!String(s.id).startsWith('kttv_') || !s.series || s.series.length === 0) continue;
      const last = [...s.series].sort((a, b) => a.t - b.t).slice(-1)[0];
      if (last.t > tMoi) tMoi = last.t;
      const sc = soSanh(last.v, s.alertInfo);
      list.push({
        id: s.id, ten: `TV ${TEN_HIEN_THI[s.name] || s.name}`, v: last.v,
        mau: sc.mau, mauChu: sc.mau === MAU_BD[1] ? '#B8860B' : sc.mau, // chữ vàng đậm hơn cho dễ đọc
        text: sc.text, vuot: sc.vuot, lat: s.coords?.lat ?? 0,
      });
    }
    list.sort((a, b) => b.lat - a.lat); // từ trái sang phải: Bắc → Nam (vĩ độ giảm dần)
    const m = list.reduce((acc, r) => Math.max(acc, r.v), 0);
    return { data: list, capNhat: tMoi, max: Math.ceil((m * 1.12 + 1) / 5) * 5 };
  }, [stations]);

  const khung = useKhung();
  const [ngangTay, setNgangTay] = useState(false); // nút "Xem ngang": xoay giao diện đồ thị 90° khi điện thoại đang cầm dọc
  const dienThoaiDoc = khung.w < 700 && khung.w < khung.h;
  const ngang = ngangTay && dienThoaiDoc; // xoay máy ngang thật -> tự tắt chế độ xoay tay
  // Kích thước "ảo" mà đồ thị được vẽ trong đó: khi xoay tay thì đổi chỗ rộng/cao.
  const w = ngang ? khung.h : khung.w;
  const h = ngang ? khung.w : khung.h;
  const gon = w < 700 || h < 520; // điện thoại (dọc hoặc ngang): cửa sổ phủ kín màn hình
  const doc = w < 700;            // điện thoại dọc: nhãn cột viết dọc
  // Chiều cao đồ thị: điện thoại ngang thì ăn theo chiều cao màn hình (~175px dành cho tiêu đề/chú giải).
  const chieuCao = !gon ? 400 : Math.max(230, Math.min(h - 175, doc ? 560 : 420));
  const kieuPanel = ngang
    ? { position: 'fixed', top: 0, left: khung.w, width: khung.h, height: khung.w, maxHeight: 'none', transformOrigin: '0 0', transform: 'rotate(90deg)' }
    : undefined;

  return (
    <div className={`mnhh-overlay${gon ? ' mnhh-hep' : ''}`} onClick={onClose}>
      <div className="mnhh-panel" style={kieuPanel} onClick={(e) => e.stopPropagation()}>
        <div className="mnhh-header">
          <h3>📊 Mực nước hiện hành</h3>
          <div className="mnhh-actions">
            {dienThoaiDoc && (
              <button className="mnhh-rotate" onClick={() => setNgangTay((v) => !v)}>
                {ngang ? '↺ Xem dọc' : '⟳ Xem ngang'}
              </button>
            )}
            <button className="mnhh-close" onClick={onClose} aria-label="Đóng">✕</button>
          </div>
        </div>
        <div className="mnhh-body">
          <div className="mnhh-title">MỰC NƯỚC CÁC TRẠM THỦY VĂN<br />TỈNH QUẢNG TRỊ{capNhat ? ` | CẬP NHẬT ${formatCapNhat(capNhat)}` : ''}</div>
          <div className="mnhh-sub">Đơn vị: m | Giá trị so sánh cấp báo động ghi theo bảng nguồn</div>
          <div style={{ width: '100%', height: chieuCao }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: doc ? 80 : 50, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#ccc" />
                <XAxis dataKey="ten" interval={0} tick={<NhanTrucX doc={doc} />} height={doc ? 80 : 80} />
                <YAxis domain={[0, max]} tickCount={7} allowDecimals={false} tick={{ fontSize: doc ? 9 : 11 }} width={doc ? 26 : 48}
                  label={doc ? undefined : { value: 'Mực nước hiện tại (m)', angle: -90, position: 'insideLeft', fontSize: 11, dx: -2, style: { textAnchor: 'middle' } }} />
                <Bar dataKey="v" isAnimationActive={false} maxBarSize={30}>
                  {data.map((r) => <Cell key={r.id} fill={r.mau} />)}
                  <LabelList dataKey="v" content={(p) => <NhanCot {...p} data={data} doc={doc} />} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mnhh-legend">
            <span><i style={{ background: MAU_BD.duoi }} />Dưới BĐI</span>
            <span><i style={{ background: MAU_BD[1] }} />BĐI</span>
            <span><i style={{ background: MAU_BD[2] }} />BĐII</span>
            <span><i style={{ background: MAU_BD[3] }} />BĐIII</span>
            <span><i style={{ background: MAU_XAM }} />Không có thông tin so sánh</span>
          </div>
          <div className="mnhh-foot">Nguồn: số liệu quan trắc các trạm KTTV. Sắp xếp Bắc → Nam. Tham khảo - Không thay thế bản tin chính thức từ Đài KTTV tỉnh Quảng Trị.</div>
        </div>
      </div>
    </div>
  );
}
