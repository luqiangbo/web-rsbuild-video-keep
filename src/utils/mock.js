const STATUSES = ["completed", "queued", "interrupted"];
const NOW = Date.now();

const downloadList = Array.from({ length: 200 }, (_, i) => {
  const idx = i + 1;
  const status = STATUSES[i % STATUSES.length];
  const createdAt = NOW - idx * 60 * 1000;
  const updatedAt = createdAt + 60 * 1000;
  const completedAt = status === "completed" ? updatedAt + 60 * 1000 : null;
  const screenName = `user${String((i % 20) + 1).padStart(2, "0")}`;
  const username = `昵称${String((i % 20) + 1).padStart(2, "0")}`;
  const userId = String(100000000000 + i);
  const tweetId = String(900000000000 + i);
  const size = ["720x1280", "1280x720", "540x960", "720x720", "360x640"][i % 5];

  return {
    id: `mock-${idx}`,
    url: `https://video.twimg.com/ext_tw_video/${100 + (i % 1000)}/pu/vid/${size}/video${(i % 5) + 1}.mp4`,
    filename: `${screenName}_${username}_2025-01-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.mp4`,
    screenName,
    userId,
    user: `${screenName} (${userId})`,
    text: `示例文案 ${idx}，用于分页与展示调试。`,
    status,
    downloadId: 1000 + idx,
    tweetId,
    createdAt,
    updatedAt,
    completedAt,
  };
});

export { downloadList };
