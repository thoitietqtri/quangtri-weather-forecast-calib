import { useEffect, useState } from 'react';
import './MaiHoaForecast.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

export default function MaiHoaForecast({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showBacktest, setShowBacktest] = useState(false);
  const [asofInput, setAsofInput] = useState('');
  const [heSo, setHeSo] = useState('1.0');

  const load = (asof, hs) => {
    setData(null);
    setError(null);
    const params = new URLSearchParams();
    if (asof) params.set('asof', asof);
    if (hs) params.set('hesoHieuChinh', hs);
    fetch(`/.netlify/functions/forecast-maihoa?${params.toString()}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(null, heSo); }, []);

  return (
    <div className="maihoa-forecast-overlay" onClick={onClose}>
      <div className="maihoa-forecast-panel" onClick={(e) => e.stopPropagation()}>
        <div className="maihoa-forecast-header">
          <div>
            <h3>🔮 Dự báo mực nước Mai Hóa</h3>
            <div className="maihoa-forecast-wip">(Chức năng này chưa xong, đang trong giai đoạn xây dựng)</div>
          </div>
          <button className="maihoa-forecast-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="maihoa-forecast-body">
          {!showBacktest && (
            <div className="dongtam-forecast-hesobox">
              <label>Hệ số hiệu chỉnh mưa dự báo ECMWF (mặc định 1.0 — chỉnh lên 2-2.5 nếu đang có bão/ATNĐ):</label>
              <div className="dongtam-forecast-hesobox-row">
                <input type="number" step="0.1" min="0.1" value={heSo} onChange={(e) => setHeSo(e.target.value)} />
                <button onClick={() => load(null, heSo)}>Áp dụng</button>
              </div>
            </div>
          )}

          <button className="maihoa-forecast-backtest-toggle" onClick={() => setShowBacktest((v) => !v)}>
            🔧 Chế độ kiểm nghiệm (kỹ thuật)
          </button>
          {showBacktest && (
            <div className="maihoa-forecast-backtest-box">
              <label>Giả lập "bây giờ" là (giờ VN):</label>
              <input type="text" placeholder="2026-09-14 05:00:00" value={asofInput} onChange={(e) => setAsofInput(e.target.value)} />
              <div className="maihoa-forecast-backtest-btns">
                <button onClick={() => load(asofInput)}>Kiểm tra</button>
                <button onClick={() => { setAsofInput(''); load(null, heSo); }}>Về chế độ thật</button>
              </div>
            </div>
          )}

          {data && data.backtestMode && (
            <div className="maihoa-forecast-backtest-note">🕑 Đang xem lại quá khứ — mốc: {data.asof} (mưa "dự báo" là mưa thật đã xảy ra sau mốc này, giả lập dự báo hoàn hảo)</div>
          )}

          {error && <div className="maihoa-forecast-error">⚠️ Lỗi: {error}</div>}
          {!error && !data && <div className="maihoa-forecast-loading">⏳ Đang tải...</div>}
          {data && !data.available && <div className="maihoa-forecast-empty">ℹ️ {data.reason}</div>}

          {data && data.available && (
            <>
              <div className="dongtam-forecast-hiennay">
                Mai Hóa hiện tại ({formatTimeVN(data.thoiDiemHienTai)}): <b>{data.maihoaHienTai}m</b>
                {' | '}Đồng Tâm: <b>{data.dongtamHienTai}m</b>
                {' | '}Tân Lâm: <b>{data.tanlamHienTai}m</b>
              </div>

              <table className="dongtam-forecast-table">
                <thead>
                  <tr><th></th><th>+6h</th><th>+12h</th><th>+18h</th><th>+24h</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Giờ</td>
                    {[6, 12, 18, 24].map((h) => <td key={h}>{formatTimeVN(data.thoiDiemHienTai + h * 3600000)}</td>)}
                  </tr>
                  <tr className="dongtam-forecast-table-value">
                    <td>Mực nước</td>
                    {[6, 12, 18, 24].map((h) => <td key={h}><b>{data.duBaoTheoMoc[h]}m</b></td>)}
                  </tr>
                </tbody>
              </table>

              <div className="dongtam-forecast-dinh">
                {data.nhanDinhDinh.coDinh ? (
                  <>🔴 Dự kiến đạt <b>ĐỈNH {data.nhanDinhDinh.giaTriDinh.toFixed(2)}m</b> trong khoảng {formatTimeVN(data.thoiDiemHienTai + data.nhanDinhDinh.gioTruoc * 3600000)} đến {formatTimeVN(data.thoiDiemHienTai + data.nhanDinhDinh.gioDinh * 3600000)}</>
                ) : data.nhanDinhDinh.dangTiepTucLen ? (
                  <>📈 Sau +24h vẫn còn xu hướng <b>TIẾP TỤC LÊN</b>, chưa xác định được đỉnh trong 24h tới</>
                ) : (
                  <>📉 Xu hướng giảm/ổn định trong 24h tới, không có đỉnh mới</>
                )}
              </div>

              <div className="maihoa-forecast-inputs">
                <div className="maihoa-forecast-row"><span>Mưa lưu vực 24h đã qua:</span><b>{data.rainDaQua24h}mm</b></div>
                {[6, 12, 18, 24].map((h) => (
                  <div className="maihoa-forecast-row" key={h}>
                    <span>Mưa dự báo +{h}h (gốc → hiệu chỉnh):</span>
                    <b>{data.mucMuaDuBao[h].goc}mm → {data.mucMuaDuBao[h].sauHieuChinh}mm</b>
                  </div>
                ))}
              </div>

              <div className="maihoa-forecast-note">
                📊 Phương trình riêng cho từng mốc, xây từ 212 mẫu giờ mùa lũ (2010-2025) — đạt chuẩn sai số ±1m: 91.5% (+6h), 76% (+12h), 74.5% (+18h), 81.6% (+24h).
                Đây là tham khảo hỗ trợ, không thay thế đánh giá chuyên môn của dự báo viên.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
