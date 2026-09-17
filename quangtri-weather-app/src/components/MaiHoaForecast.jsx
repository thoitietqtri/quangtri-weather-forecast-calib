import { useEffect, useState } from 'react';
import './MaiHoaForecast.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export default function MaiHoaForecast({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showBacktest, setShowBacktest] = useState(false);
  const [asofInput, setAsofInput] = useState('');

  const load = (asof) => {
    setData(null);
    setError(null);
    const url = asof
      ? `/.netlify/functions/forecast-maihoa?asof=${encodeURIComponent(asof)}`
      : '/.netlify/functions/forecast-maihoa';
    fetch(url)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(null); }, []);

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
          <button className="maihoa-forecast-backtest-toggle" onClick={() => setShowBacktest((v) => !v)}>
            🔧 Chế độ kiểm nghiệm (kỹ thuật)
          </button>
          {showBacktest && (
            <div className="maihoa-forecast-backtest-box">
              <label>Giả lập "bây giờ" là (giờ VN):</label>
              <input
                type="text"
                placeholder="2026-09-14 05:00:00"
                value={asofInput}
                onChange={(e) => setAsofInput(e.target.value)}
              />
              <div className="maihoa-forecast-backtest-btns">
                <button onClick={() => load(asofInput)}>Kiểm tra</button>
                <button onClick={() => { setAsofInput(''); load(null); }}>Về chế độ thật</button>
              </div>
            </div>
          )}

          {data && data.backtestMode && (
            <div className="maihoa-forecast-backtest-note">🕑 Đang xem lại quá khứ — mốc: {data.asof} (không có mưa dự báo ECMWF của quá khứ)</div>
          )}

          {error && <div className="maihoa-forecast-error">⚠️ Lỗi: {error}</div>}

          {!error && !data && <div className="maihoa-forecast-loading">⏳ Đang tải...</div>}

          {data && !data.available && (
            <div className="maihoa-forecast-empty">
              ℹ️ {data.reason}
              {data.dongtamCurrentValue != null && (
                <div className="maihoa-forecast-row" style={{ marginTop: 10 }}><span>Đồng Tâm hiện tại:</span><b>{data.dongtamCurrentValue}m</b></div>
              )}
            </div>
          )}

          {data && data.available && (
            <>
              <div className="maihoa-forecast-main">
                <div className="maihoa-forecast-predicted">
                  <span className="label">Mai Hóa ước tính (theo mực nước Đồng Tâm hiện tại)</span>
                  <span className="value">{data.predictedMaiHoaPeak}m</span>
                </div>
                <div className="maihoa-forecast-since">
                  Đồng Tâm hiện tại ({formatTimeVN(data.dongtamCurrentTime)}): <b>{data.dongtamCurrentValue}m</b>
                </div>
                <div className="maihoa-forecast-warn">⚠️ Đây là ước tính theo mực nước Đồng Tâm NGAY LÚC NÀY — nếu lũ Đồng Tâm còn tiếp tục lên, con số này cũng sẽ còn tăng theo, chưa phải giá trị đỉnh cuối cùng.</div>
                {data.backtestMode && data.maihoaActualAtSameTime != null && (
                  <div className="maihoa-forecast-compare">
                    So sánh: Mai Hóa THỰC TẾ tại đúng mốc này = <b>{data.maihoaActualAtSameTime}m</b>
                    {' '}(lệch {(data.predictedMaiHoaPeak - data.maihoaActualAtSameTime).toFixed(2)}m)
                  </div>
                )}
              </div>

              <div className="maihoa-forecast-trend">
                <div className="maihoa-forecast-trend-row">
                  <b>Đồng Tâm ({data.dongtamCurrentValue}m):</b> {data.dongtamTrend.icon} {data.dongtamTrend.verdict}
                </div>
                {data.maihoaTrend && (
                  <div className="maihoa-forecast-trend-row">
                    <b>Mai Hóa ({data.maihoaCurrentValue}m):</b> {data.maihoaTrend.icon} {data.maihoaTrend.verdict}
                  </div>
                )}
              </div>

              <div className="maihoa-forecast-inputs">
                <h4>Số liệu khác:</h4>
                <div className="maihoa-forecast-row"><span>Mưa lưu vực 48h qua:</span><b>{data.rain48h}mm</b></div>
                <div className="maihoa-forecast-row"><span>Tốc độ lên Đồng Tâm (24h qua):</span><b>{data.riseRate24h}m/h</b></div>
                <div className="maihoa-forecast-row"><span>Mực nước Tân Lâm hiện tại:</span><b>{data.tanlamMucNuoc != null ? `${data.tanlamMucNuoc}m` : '— (không lấy được)'}</b></div>
              </div>

              <div className="maihoa-forecast-note">
                📊 Phương trình xây dựng từ 144 trận lũ lịch sử (2006-2025), kiểm định chéo R²=0.83, sai số trung bình ~0.6m (tính trên đỉnh lũ thật, không phải mực nước hiện hành).
                Đây là tham khảo hỗ trợ, không thay thế đánh giá chuyên môn của dự báo viên.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
