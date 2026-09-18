import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

function formatGio(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

// hienTaiT/hienTaiV: thời điểm + giá trị hiện tại (mốc 0h)
// duBaoTheoMoc: { 6: v6, 12: v12, 18: v18, 24: v24 }
// nguong (tùy chọn): { bd1, bd2, bd3 } — vẽ thêm vạch ngưỡng báo động nếu có
export default function DuBaoChart({ hienTaiT, hienTaiV, duBaoTheoMoc, nguong }) {
  const data = [
    { t: hienTaiT, gio: formatGio(hienTaiT), v: hienTaiV },
    ...[6, 12, 18, 24].map((h) => ({ t: hienTaiT + h * 3600000, gio: formatGio(hienTaiT + h * 3600000), v: duBaoTheoMoc[h] })),
  ];

  return (
    <div style={{ width: '100%', height: 220, background: '#0D1B2A', borderRadius: 8, padding: '10px 4px 4px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.15)" />
          <XAxis dataKey="gio" stroke="#90CAF9" tick={{ fontSize: 11 }} />
          <YAxis stroke="#90CAF9" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}m`} width={45} />
          <Tooltip
            contentStyle={{ background: '#0D1B2A', border: '1px solid #90CAF9', borderRadius: 6 }}
            labelStyle={{ color: '#90CAF9' }}
            itemStyle={{ color: '#F9A825' }}
            formatter={(v) => [`${v}m`, 'Mực nước']}
          />
          {nguong?.bd1 && <ReferenceLine y={nguong.bd1} stroke="#F9A825" strokeDasharray="4 4" label={{ value: 'BĐ I', fill: '#F9A825', fontSize: 10, position: 'insideTopLeft' }} />}
          {nguong?.bd2 && <ReferenceLine y={nguong.bd2} stroke="#EF6C00" strokeDasharray="4 4" label={{ value: 'BĐ II', fill: '#EF6C00', fontSize: 10, position: 'insideTopLeft' }} />}
          {nguong?.bd3 && <ReferenceLine y={nguong.bd3} stroke="#D32F2F" strokeDasharray="4 4" label={{ value: 'BĐ III', fill: '#D32F2F', fontSize: 10, position: 'insideTopLeft' }} />}
          <Line type="monotone" dataKey="v" stroke="#F9A825" strokeWidth={2} dot={{ r: 4, fill: '#F9A825' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
