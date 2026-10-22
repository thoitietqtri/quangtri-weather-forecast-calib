import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot, ResponsiveContainer } from 'recharts';

function formatGio(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

// hienTaiT/hienTaiV: thời điểm + giá trị hiện tại (mốc 0h)
// duBaoTheoMoc: { 6: v6, 12: v12, 18: v18, 24: v24 }
// nguong (tùy chọn): { bd1, bd2, bd3 } — vẽ thêm vạch ngưỡng báo động nếu có
// duongCong (tùy chọn): [{ h: 0..24, v }] đường từng giờ (dùng cho mô hình triều); chấm tròn ở các mốc 0/6/12/18/24h
// diemCuc (tùy chọn): [{ t, v, loai: 'cao' | 'thap' }] đánh dấu đỉnh/chân triều
export default function DuBaoChart({ hienTaiT, hienTaiV, duBaoTheoMoc, nguong, duongCong, diemCuc }) {
  const data = duongCong
    ? duongCong.map((p) => ({ h: p.h, t: hienTaiT + p.h * 3600000, gio: formatGio(hienTaiT + p.h * 3600000), v: p.v }))
    : [
      { h: 0, t: hienTaiT, gio: formatGio(hienTaiT), v: hienTaiV },
      ...[6, 12, 18, 24].map((h) => ({ h, t: hienTaiT + h * 3600000, gio: formatGio(hienTaiT + h * 3600000), v: duBaoTheoMoc[h] })),
    ];
  // chỉ mô hình triều (có duongCong) đổi cách ghi nhãn: dấu trừ đúng, làm tròn 2 số lẻ; các khung khác giữ nguyên như cũ
  const nhanTruc = duongCong ? (v) => `${Math.round(v * 100) / 100}m`.replace('-', '−') : (v) => `${v}m`;
  // trục tung của mô hình triều: biên làm tròn tới 0,5m (hoặc 1m nếu dải rộng) để vạch chia dễ đọc
  let yDomain; // mặc định của recharts (các khung khác giữ nguyên)
  let yTicks;
  if (duongCong) {
    const vs = data.map((p) => p.v);
    const lo0 = Math.min(...vs) - 0.1; const hi0 = Math.max(...vs) + 0.1;
    const buoc = hi0 - lo0 > 3.5 ? 1 : 0.5;
    const lo = Math.floor(lo0 / buoc) * buoc; const hi = Math.ceil(hi0 / buoc) * buoc;
    yDomain = [lo, hi];
    yTicks = [];
    for (let v = lo; v <= hi + 1e-9; v += buoc) yTicks.push(Math.round(v * 100) / 100);
  }
  const ticks = duongCong ? data.filter((p) => p.h % 6 === 0).map((p) => p.gio) : undefined;
  const veCham = (props) => {
    const { cx, cy, payload, index } = props;
    if (payload.h % 6 !== 0) return <g key={`d${index}`} />;
    return <circle key={`d${index}`} cx={cx} cy={cy} r={4} fill="#1565C0" {...(duongCong ? { stroke: '#90CAF9', strokeWidth: 1 } : {})} />;
  };

  return (
    <div className="dubao-chart" style={{ width: '100%', height: 220, background: '#0D1B2A', borderRadius: 8, padding: '10px 4px 4px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={duongCong ? { top: 15, right: 30, left: -4, bottom: 5 } : { top: 5, right: 10, left: -10, bottom: 5 }}>
          <defs>
            <linearGradient id="duBaoMucNuocFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#1565C0" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#1565C0" stopOpacity={0.15} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.15)" />
          <XAxis dataKey="gio" stroke="#90CAF9" tick={{ fontSize: 11 }} ticks={ticks} interval={duongCong ? 0 : 'preserveEnd'} />
          <YAxis stroke="#90CAF9" tick={{ fontSize: 11 }} tickFormatter={nhanTruc} width={duongCong ? 52 : 45} domain={yDomain} ticks={yTicks} />
          <Tooltip
            contentStyle={{ background: '#0D1B2A', border: '1px solid #90CAF9', borderRadius: 6 }}
            labelStyle={{ color: '#90CAF9' }}
            itemStyle={{ color: '#F9A825' }}
            formatter={(v) => [nhanTruc(v), 'Mực nước']}
          />
          {nguong?.bd1 && <ReferenceLine y={nguong.bd1} stroke="#F9A825" strokeDasharray="4 4" label={{ value: 'BĐ I', fill: '#F9A825', fontSize: 10, position: 'insideTopLeft' }} />}
          {nguong?.bd2 && <ReferenceLine y={nguong.bd2} stroke="#EF6C00" strokeDasharray="4 4" label={{ value: 'BĐ II', fill: '#EF6C00', fontSize: 10, position: 'insideTopLeft' }} />}
          {nguong?.bd3 && <ReferenceLine y={nguong.bd3} stroke="#D32F2F" strokeDasharray="4 4" label={{ value: 'BĐ III', fill: '#D32F2F', fontSize: 10, position: 'insideTopLeft' }} />}
          <Area type="monotone" dataKey="v" stroke="#1565C0" strokeWidth={2} fill="url(#duBaoMucNuocFill)" dot={duongCong ? veCham : { r: 4, fill: '#1565C0' }} />
          {duongCong && (diemCuc || []).map((d) => {
            const diem = data.find((p) => p.t === d.t);
            return diem ? (
              <ReferenceDot key={`${d.loai}-${d.t}`} x={diem.gio} y={d.v} r={5} fill={d.loai === 'cao' ? '#F9A825' : '#4FC3F7'} stroke="#0D1B2A"
                label={{ value: `${d.loai === 'cao' ? 'Cao' : 'Thấp'} ${nhanTruc(d.v)}`, fill: d.loai === 'cao' ? '#F9A825' : '#4FC3F7', fontSize: 10, position: diem.h >= 20 ? 'left' : diem.h <= 3 ? 'right' : (d.loai === 'cao' ? 'top' : 'bottom') }} />
            ) : null;
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
