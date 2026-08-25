// Gọi Netlify Function (netlify/functions/rainfall.js) lấy dữ liệu mưa thực
// đo real-time (trạm KT Khe Sanh + toàn bộ trạm Vrain tỉnh Quảng Trị).
// Local dev cần chạy `netlify dev` (thay vì `vite dev` thường) để hàm này
// hoạt động — xem README.
const RAINFALL_API_URL = '/.netlify/functions/rainfall';

async function fetchRainData() {
  const res = await fetch(`${RAINFALL_API_URL}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Không gọi được API mưa: HTTP ${res.status}`);
  return res.json(); // { updated_at, stations, errors }
}

export async function getRainStations() {
  const data = await fetchRainData();
  if (data.errors?.length) {
    // eslint-disable-next-line no-console
    console.warn('[Mưa] Một số trạm lỗi:', data.errors);
  }
  // Chỉ giữ trạm có toạ độ — mới vẽ được lên bản đồ.
  return (data.stations || []).filter((s) => s.coords);
}

export async function getRainUpdatedAt() {
  const data = await fetchRainData();
  return data.updated_at || null;
}
