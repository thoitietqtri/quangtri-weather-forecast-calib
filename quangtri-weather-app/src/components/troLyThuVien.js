// ============================================================================
// THƯ VIỆN NỘI DUNG CỦA TRỢ LÝ — anh chỉ cần sửa file này để thêm/đổi câu hỏi.
// Viết tiếng Việt CÓ DẤU bình thường; trợ lý tự bỏ dấu khi so khớp.
// Sửa xong: git add . → commit → push là có hiệu lực (không cần sửa TroLyAI.jsx).
// ============================================================================

export const LOI_CHAO =
  'Xin chào! Em là trợ lý của app Thời tiết Quảng Trị. Anh/chị hỏi về cách dùng app, mưa và mực nước hiện tại, hoặc dự báo một xã/phường (ví dụ: "mưa Đồng Tâm", "mực nước Mai Hóa", "dự báo Đông Hà 5 ngày tới", "ngày 20/10 Đông Hà có mưa không").\nSố liệu chỉ để tham khảo, tin chính thức theo bản tin của Đài KTTV.';

// Các nút gợi ý nhanh dưới khung chat.
export const GOI_Y = [
  'Hướng dẫn sử dụng',
  'Mưa nhiều nhất hiện nay',
  'Mực nước các trạm',
  'Dự báo ngày mai',
  'Dự báo 5 ngày tới',
];

// Từ khóa nhận dạng loại câu hỏi (khớp theo TỪ/CỤM TỪ nguyên vẹn, không phân biệt dấu).
export const TU_KHOA = {
  mua: ['mưa', 'trạm mưa'],
  nuoc: ['nước', 'lũ', 'báo động', 'mực'],
  duBao: [
    'dự báo', 'ngày mai', 'ngày kia', 'ngày mốt', 'nhiệt', 'nóng', 'rét', 'gió', 'thời tiết',
    'ngày tới', 'ngày nữa', 'tuần tới', 'tuần sau', 'cuối tuần', 'thứ bảy', 'chủ nhật',
  ],
  huongDan: ['hướng dẫn', 'cách', 'làm sao', 'làm thế nào', 'ở đâu', 'bấm', 'sử dụng', 'chức năng'],
  tongQuanMua: ['nhiều nhất', 'lớn nhất', 'cao nhất', 'tổng quan', 'hiện nay', 'đang mưa'],
};

// Mục hướng dẫn: k = các từ khóa kích hoạt, a = câu trả lời.
export const HUONG_DAN = [
  { k: ['chọn xã', 'chọn phường', 'xem dự báo', 'địa danh'], a: '📍 Chọn xã/phường: dùng ô "Chọn xã/phường" ở thanh trên cùng, hoặc bấm trực tiếp vào xã trên bản đồ. Popup hiện nhiệt độ, mưa, gió và cảnh báo; biểu đồ theo giờ hiện dưới bản đồ.' },
  { k: ['ngày', 'lịch', 'hôm khác'], a: '📅 Ô "Ngày" chọn được tối đa +13 ngày kể từ hôm nay. Chọn xã trước rồi đổi ngày, dự báo sẽ tải lại. Anh/chị cũng có thể hỏi trợ lý, ví dụ "Đông Hà 5 ngày tới" hoặc "ngày 20/10 Đông Hà có mưa không".' },
  { k: ['trạm mưa', 'giọt nước', 'màu mưa', 'chú thích'], a: '💧 Tick "Trạm mưa" để hiện trạm đo. Màu theo mưa 24h: xám 0mm · xanh dương <25 · xanh lá 25–50 · cam 50–100 · đỏ nhấp nháy >100mm. Bấm vào trạm xem 1h/3h/6h/24h/48h/72h.' },
  { k: ['trạm mực nước', 'báo động', 'màu mực nước'], a: '🌊 Tick "Trạm mực nước". Màu theo cấp báo động của từng trạm: xanh dưới BĐI · vàng BĐI · cam BĐII · đỏ ≥BĐIII. Trạm hồ chứa chưa phân cấp nên màu xám.' },
  { k: ['radar'], a: '📡 Tick "Ảnh radar" để phủ ảnh radar tổ hợp lên bản đồ, tự làm mới 10 phút/lần; bỏ tick là dừng.' },
  { k: ['định vị', 'vị trí của tôi', 'gps'], a: '📍 Nút định vị (trên bản đồ) đưa bản đồ tới vị trí của anh/chị — cần cho phép truy cập vị trí. Nút 🏠 đưa về toàn tỉnh Quảng Trị.' },
  { k: ['menu', 'chức năng', 'bảng', 'biểu đồ', 'thời đoạn'], a: '☰ Menu (góc trên trái) có: mưa thực đo theo thời đoạn/giờ, đồ thị mưa, mực nước thực đo, biểu đồ mực nước, mực nước hiện hành (cột), bảng dự báo mưa/nhiệt/gió và dự báo mực nước khi có lũ.' },
  { k: ['mai hóa', 'đồng tâm', 'dự báo mực nước', 'đỉnh lũ'], a: '🌊 Dự báo mực nước khi có lũ: Menu → "Dự báo Mực nước (khi có lũ)" → Sông Gianh → Đồng Tâm hoặc Mai Hóa. Các trạm khác đang xây dựng.' },
  { k: ['cài đặt', 'cài app', 'install', 'màn hình chính'], a: '📲 Dùng nút cài đặt ở thanh công cụ (hoặc "Thêm vào màn hình chính" của trình duyệt) để cài app như ứng dụng điện thoại.' },
  { k: ['màu nhiệt', 'màu xã', 'mạng sông', 'lớp'], a: '🎛️ Các ô tick dưới thanh chọn xã: Trạm mưa, Trạm mực nước, Mạng lưới sông, Màu nhiệt độ xã, Ảnh radar — bật/tắt từng lớp trên bản đồ.' },
  { k: ['giọng nói', 'nói', 'micro', 'đọc to'], a: '🎤 Bấm nút micro cạnh ô nhập để nói câu hỏi bằng tiếng Việt; trợ lý sẽ đọc to câu trả lời. Nút 🔊 trên đầu khung chat để bật/tắt đọc to mọi câu trả lời. Cần trình duyệt Chrome/Edge (hoặc Safari mới) và cho phép dùng micro.' },
];
