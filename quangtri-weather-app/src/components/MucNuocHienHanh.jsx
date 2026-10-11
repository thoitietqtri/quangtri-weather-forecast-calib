import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList, ResponsiveContainer } from 'recharts';
import './MucNuocHienHanh.css';
import { layLuuVucMucNuoc } from './luuVucSong';

const MAU_DO = '#D32F2F';
const MAU_XANH = '#1976D2';
const MAU_XAM = '#9E9E9E';
const BAN_RONG_COT = 52; // px mỗi cột — vượt bề rộng khung thì cuộn ngang

function formatCapNhat(t) {
  const d = new Date(t + 7 * 3600 * 1000); // giờ VN
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}H NGÀY ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// Giá trị mới nhất của trạm (cuối chuỗi) rồi so với cấp báo động của CHÍNH trạm đó
// (station.alertInfo do backend cung cấp, không lưu ngưỡng riêng ở frontend).
//   - Đã vượt: ">BĐx d" ở cấp cao nhất đã vượt — chữ đỏ, cột đỏ.
//   - Chưa vượt cấp thấp nhất: "<BĐI d" — chữ xanh, cột xanh.
//   - Không có alertInfo: xám, "Không có thông tin so sánh".
function soSanh(current, alertInfo) {
  if (current == null || !alertInfo) return { mau: MAU_XAM, text: 'Không có thông tin so sánh', vuot: false };
  const cap = alertInfo.type === 'official'
    ? [['BĐI', alertInfo.bd1], ['BĐII', alertInfo.bd2], ['BĐIII', alertInfo.bd3]]
    : [['CB', alertInfo.binhThuongMax], ['NH', alertInfo.nguyHiemMin]];
  let vuot = null;
  for (const [ten, nguong] of cap) if (nguong != null && current >= nguong) vuot = [ten, nguong];
  if (vuot) return { mau: MAU_DO, text: `>${vuot[0]} ${(current - vuot[1]).toFixed(2)}`, vuot: true };
  const [ten, nguong] = cap[0];
  return { mau: MAU_XANH, text: `<${ten} ${(nguong - current).toFixed(2)}`, vuot: false };
}

function NhanCot({ x, y, width, value, index, data }) {
  const d = data[index];
  if (!d || value == null) return null;
  const cx = x + width / 2;
  return (
    <g>
      <text x={cx} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#222">{`${Number(value).toFixed(2)} m`}</text>
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

function NhanTrucX({ x, y, payload, data }) {
  const d = data.find((r) => r.ten === payload.value);
  return (
    <g transform={`translate(${x},${y + 6}) rotate(-40)`}>
      <text textAnchor="end" fontSize="11" fill="#333">
        {payload.value}
        {d && !d.vrain && <tspan fill="red" fontWeight="700"> *</tspan>}
      </text>
    </g>
  );
}

// stations: [{ id, name, alertInfo, series: [{t, v}] }, ...] — cùng nguồn với bảng/biểu đồ mực nước.
export default function MucNuocHienHanh({ stations, onClose }) {
  const { data, capNhat, max } = useMemo(() => {
    const list = [];
    let tMoi = 0;
    for (const s of stations) {
      if (!s.series || s.series.length === 0) continue;
      const last = [...s.series].sort((a, b) => a.t - b.t).slice(-1)[0];
      if (last.t > tMoi) tMoi = last.t;
      const sc = soSanh(last.v, s.alertInfo);
      list.push({
        id: s.id, ten: s.name, vrain: s.id.startsWith('vrain_'), v: last.v,
        mau: sc.mau, mauChu: sc.mau, text: sc.text, vuot: sc.vuot,
        thuTu: layLuuVucMucNuoc(s.name).thuTu,
      });
    }
    list.sort((a, b) => a.thuTu - b.thuTu);
    const m = list.reduce((acc, r) => Math.max(acc, r.v), 0);
    return { data: list, capNhat: tMoi, max: Math.ceil((m * 1.12 + 1) / 5) * 5 };
  }, [stations]);

  const width = Math.max(data.length * BAN_RONG_COT + 70, 320);

  return (
    <div className="mnhh-overlay" onClick={onClose}>
      <div className="mnhh-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mnhh-header">
          <h3>📊 Mực nước hiện hành</h3>
          <button className="mnhh-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="mnhh-body">
          <div className="mnhh-title">MỰC NƯỚC CÁC TRẠM THỦY VĂN<br />TỈNH QUẢNG TRỊ{capNhat ? ` | CẬP NHẬT ${formatCapNhat(capNhat)}` : ''}</div>
          <div className="mnhh-sub">Đơn vị: m | Giá trị so sánh cấp báo động ghi theo bảng nguồn</div>
          <div className="mnhh-scroll">
            <div style={{ width, height: 400 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 50, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#ccc" />
                  <XAxis dataKey="ten" interval={0} tick={<NhanTrucX data={data} />} height={80} />
                  <YAxis domain={[0, max]} tickCount={7} allowDecimals={false} tick={{ fontSize: 11 }} width={48}
                    label={{ value: 'Mực nước hiện tại (m)', angle: -90, position: 'insideLeft', fontSize: 11, dx: -2, style: { textAnchor: 'middle' } }} />
                  <Bar dataKey="v" isAnimationActive={false} maxBarSize={30}>
                    {data.map((r) => <Cell key={r.id} fill={r.mau} />)}
                    <LabelList dataKey="v" content={(p) => <NhanCot {...p} data={data} />} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="mnhh-legend">
            <span><i style={{ background: MAU_DO }} />Trên cấp báo động</span>
            <span><i style={{ background: MAU_XANH }} />Dưới cấp báo động</span>
            <span><i style={{ background: MAU_XAM }} />Không có thông tin so sánh</span>
          </div>
          <div className="mnhh-foot">Nguồn: số liệu quan trắc KTTV (<span style={{ color: 'red' }}>*</span>) và VRain/vfass. Tham khảo - Không thay thế bản tin chính thức từ Đài KTTV tỉnh Quảng Trị.</div>
        </div>
      </div>
    </div>
  );
}
