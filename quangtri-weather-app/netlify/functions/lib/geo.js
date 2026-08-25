// netlify/functions/lib/geo.js
//
// Danh mục 78 phường/xã (toạ độ = tâm bbox, TÍNH Y HỆT cách Leaflet
// `getBounds().getCenter()` đang dùng ở frontend MapComponent.jsx — để đảm
// bảo dữ liệu dự báo lưu vào DB đúng là dữ liệu người dùng đang thấy trên
// web, không lệch toạ độ) + 6 trạm đo nhiệt độ KTTV + hàm tiện ích không
// gian dùng chung.

export const XA_PHUONG = [
  { ma_xa: 1, ten_xa: 'Xã Tuyên Phú', lat: 17.864084, lng: 106.131152 },
  { ma_xa: 2, ten_xa: 'Xã Hòa Trạch', lat: 17.882985, lng: 106.388701 },
  { ma_xa: 3, ten_xa: 'Xã Ninh Châu', lat: 17.354819, lng: 106.721919 },
  { ma_xa: 4, ten_xa: 'Xã Tuyên Sơn', lat: 18.020281, lng: 105.904536 },
  { ma_xa: 5, ten_xa: 'Xã Tuyên Lâm', lat: 17.964366, lng: 105.750878 },
  { ma_xa: 6, ten_xa: 'Xã Tân Thành', lat: 17.889102, lng: 105.82871 },
  { ma_xa: 7, ten_xa: 'Xã Đồng Lê', lat: 17.931821, lng: 105.976146 },
  { ma_xa: 8, ten_xa: 'Xã Nam Hóa', lat: 17.82241, lng: 106.081922 },
  { ma_xa: 9, ten_xa: 'Xã Kim Điền', lat: 17.756457, lng: 105.860955 },
  { ma_xa: 10, ten_xa: 'Xã Minh Hóa', lat: 17.858106, lng: 105.958997 },
  { ma_xa: 11, ten_xa: 'Xã Kim Phú', lat: 17.663019, lng: 105.986638 },
  { ma_xa: 12, ten_xa: 'Xã Tuyên Hóa', lat: 17.783529, lng: 106.201351 },
  { ma_xa: 13, ten_xa: 'Xã Phú Trạch', lat: 17.931523, lng: 106.401265 },
  { ma_xa: 14, ten_xa: 'Xã Trung Thuần', lat: 17.843395, lng: 106.339898 },
  { ma_xa: 15, ten_xa: 'Xã Quảng Trạch', lat: 17.812367, lng: 106.398507 },
  { ma_xa: 16, ten_xa: 'Phường Ba Đồn', lat: 17.769522, lng: 106.395029 },
  { ma_xa: 17, ten_xa: 'Xã Tuyên Bình', lat: 17.864711, lng: 106.213284 },
  { ma_xa: 18, ten_xa: 'Xã Nam Ba Đồn', lat: 17.731855, lng: 106.304955 },
  { ma_xa: 19, ten_xa: 'Phường Bắc Gianh', lat: 17.739184, lng: 106.457288 },
  { ma_xa: 20, ten_xa: 'Xã Nam Gianh', lat: 17.712836, lng: 106.393538 },
  { ma_xa: 21, ten_xa: 'Xã Bắc Trạch', lat: 17.6831, lng: 106.428124 },
  { ma_xa: 22, ten_xa: 'Xã Đông Trạch', lat: 17.631043, lng: 106.490448 },
  { ma_xa: 23, ten_xa: 'Xã Hoàn Lão', lat: 17.569451, lng: 106.507179 },
  { ma_xa: 24, ten_xa: 'Xã Nam Trạch', lat: 17.475577, lng: 106.516552 },
  { ma_xa: 25, ten_xa: 'Xã Bố Trạch', lat: 17.522825, lng: 106.409935 },
  { ma_xa: 26, ten_xa: 'Xã Phong Nha', lat: 17.617884, lng: 106.215773 },
  { ma_xa: 27, ten_xa: 'Phường Đồng Thuận', lat: 17.495876, lng: 106.592084 },
  { ma_xa: 28, ten_xa: 'Phường Đồng Hới', lat: 17.45706, lng: 106.637382 },
  { ma_xa: 29, ten_xa: 'Phường Đồng Sơn', lat: 17.430305, lng: 106.555755 },
  { ma_xa: 30, ten_xa: 'Xã Quảng Ninh', lat: 17.39047, lng: 106.611919 },
  { ma_xa: 31, ten_xa: 'Xã Trường Ninh', lat: 17.294048, lng: 106.661006 },
  { ma_xa: 32, ten_xa: 'Xã Cam Hồng', lat: 17.273671, lng: 106.801449 },
  { ma_xa: 33, ten_xa: 'Xã Lệ Ninh', lat: 17.236036, lng: 106.691697 },
  { ma_xa: 34, ten_xa: 'Xã  Lệ Thủy', lat: 17.234022, lng: 106.772662 },
  { ma_xa: 35, ten_xa: 'Xã Trường Phú', lat: 17.163763, lng: 106.754148 },
  { ma_xa: 36, ten_xa: 'Xã Tân Mỹ', lat: 17.152292, lng: 106.847435 },
  { ma_xa: 37, ten_xa: 'Xã Sen Ngư', lat: 17.16609, lng: 106.915049 },
  { ma_xa: 38, ten_xa: 'Xã Kim Ngân', lat: 17.087055, lng: 106.638644 },
  { ma_xa: 39, ten_xa: 'Xã Dân Hóa', lat: 17.814631, lng: 105.723511 },
  { ma_xa: 40, ten_xa: 'Xã Trường Sơn', lat: 17.252776, lng: 106.466059 },
  { ma_xa: 41, ten_xa: 'Xã Thượng Trạch', lat: 17.448267, lng: 106.185503 },
  { ma_xa: 42, ten_xa: 'Xã Tân Gianh', lat: 17.787009, lng: 106.33524 },
  { ma_xa: 43, ten_xa: 'Xã Cam Lộ', lat: 16.754222, lng: 106.936478 },
  { ma_xa: 44, ten_xa: 'Xã Cồn Tiên', lat: 16.889389, lng: 106.878337 },
  { ma_xa: 45, ten_xa: 'Xã Tà Rụt', lat: 16.451974, lng: 107.003593 },
  { ma_xa: 46, ten_xa: 'Xã Đa Krông', lat: 16.579002, lng: 106.915207 },
  { ma_xa: 47, ten_xa: 'Xã Hiếu Giang', lat: 16.817716, lng: 106.966834 },
  { ma_xa: 48, ten_xa: 'Xã Hải Lăng', lat: 16.663442, lng: 107.164173 },
  { ma_xa: 49, ten_xa: 'Xã Ba Lòng', lat: 16.620642, lng: 107.021368 },
  { ma_xa: 50, ten_xa: 'Xã Triệu Phong', lat: 16.722752, lng: 107.136147 },
  { ma_xa: 51, ten_xa: 'Phường Quảng Trị', lat: 16.698344, lng: 107.138163 },
  { ma_xa: 52, ten_xa: 'Xã Nam Hải Lăng', lat: 16.635895, lng: 107.244659 },
  { ma_xa: 53, ten_xa: 'Xã Vĩnh Thủy', lat: 17.004284, lng: 106.986625 },
  { ma_xa: 54, ten_xa: 'Xã Diên Sanh', lat: 16.673331, lng: 107.251878 },
  { ma_xa: 55, ten_xa: 'Xã Vĩnh Hoàng', lat: 17.095345, lng: 107.025156 },
  { ma_xa: 56, ten_xa: 'Xã Nam Cửa Việt', lat: 16.854984, lng: 107.20848 },
  { ma_xa: 57, ten_xa: 'Xã Bến Hải', lat: 16.977328, lng: 107.059638 },
  { ma_xa: 58, ten_xa: 'Xã Vĩnh Linh', lat: 17.083837, lng: 106.954155 },
  { ma_xa: 59, ten_xa: 'Xã Mỹ Thủy', lat: 16.74988, lng: 107.343673 },
  { ma_xa: 60, ten_xa: 'Xã Vĩnh Định', lat: 16.755261, lng: 107.272593 },
  { ma_xa: 61, ten_xa: 'Xã Hướng Hiệp', lat: 16.729136, lng: 106.822658 },
  { ma_xa: 62, ten_xa: 'Phường Nam Đông Hà', lat: 16.802361, lng: 107.103264 },
  { ma_xa: 63, ten_xa: 'Xã Tân Lập', lat: 16.577368, lng: 106.710506 },
  { ma_xa: 64, ten_xa: 'Xã Triệu Cơ', lat: 16.801384, lng: 107.255657 },
  { ma_xa: 65, ten_xa: 'Xã Cửa Việt', lat: 16.908232, lng: 107.149893 },
  { ma_xa: 66, ten_xa: 'Xã Lìa', lat: 16.511665, lng: 106.698537 },
  { ma_xa: 67, ten_xa: 'Xã Khe Sanh', lat: 16.618307, lng: 106.737871 },
  { ma_xa: 68, ten_xa: 'Xã Triệu Bình', lat: 16.824475, lng: 107.168875 },
  { ma_xa: 69, ten_xa: 'Xã Ái Tử', lat: 16.748699, lng: 107.099588 },
  { ma_xa: 70, ten_xa: 'Xã Gio Linh', lat: 16.916209, lng: 107.071797 },
  { ma_xa: 71, ten_xa: 'Phường Đông Hà', lat: 16.802839, lng: 107.077204 },
  { ma_xa: 72, ten_xa: 'Xã Bến Quan', lat: 16.984313, lng: 106.816248 },
  { ma_xa: 73, ten_xa: 'Xã Cửa Tùng', lat: 17.050683, lng: 107.078548 },
  { ma_xa: 74, ten_xa: 'Xã Hướng Lập', lat: 16.897192, lng: 106.609041 },
  { ma_xa: 75, ten_xa: 'Xã Hướng Phùng', lat: 16.762729, lng: 106.678492 },
  { ma_xa: 76, ten_xa: 'Xã Lao Bảo', lat: 16.640418, lng: 106.626197 },
  { ma_xa: 77, ten_xa: 'Xã A Dơi', lat: 16.486028, lng: 106.768243 },
  { ma_xa: 78, ten_xa: 'Xã La Lay', lat: 16.364648, lng: 107.004429 },];

// 6 trạm đo nhiệt độ KTTV toàn tỉnh (nguồn: nhietdo.xlsx do anh Hudson cung
// cấp, 25/8/2026) — mã trạm trùng với 6 trạm mưa tương ứng (cùng vị trí đặt
// sensor). ten_table và tinhtong KHÁC bảng mưa (nhiệt độ không cộng dồn).
export const TRAM_NHIET_DO = [
  { matram: '557700', name: 'Khí Tượng TĐ Ba Đồn', ten_table: 'nhietdo_oday', tinhtong: 0, lat: 17.75, lng: 106.417 },
  { matram: '557500', name: 'Khí Tượng TĐ Tuyên Hóa', ten_table: 'nhietdo_oday', tinhtong: 0, lat: 17.8833, lng: 106.017 },
  { matram: '557400', name: 'Khí Tượng TĐ Cồn Cỏ', ten_table: 'nhietdo_oday', tinhtong: 0, lat: 17.1667, lng: 107.34 },
  { matram: '557300', name: 'Khí Tượng TĐ Đông Hà', ten_table: 'nhietdo_oday', tinhtong: 0, lat: 16.85, lng: 107.083 },
  { matram: '557200', name: 'Khí Tượng TĐ Khe Sanh', ten_table: 'nhietdo_oday', tinhtong: 0, lat: 16.6333, lng: 106.733 },
  { matram: '555600', name: 'Khí Tượng TĐ Đồng Hới', ten_table: 'nhietdo_oday', tinhtong: 0, lat: 17.4833, lng: 106.6 },
];

// Khoảng cách Haversine (km) giữa 2 toạ độ.
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Tìm điểm gần nhất trong danh sách `points` (mỗi phần tử phải có lat/lng)
// so với toạ độ (lat, lng) cho trước. Trả về { point, distanceKm } hoặc null
// nếu danh sách rỗng.
export function nearest(lat, lng, points) {
  let best = null;
  let bestDist = Infinity;
  for (const p of points) {
    if (p.lat == null || p.lng == null) continue;
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best ? { point: best, distanceKm: Math.round(bestDist * 100) / 100 } : null;
}
