import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSetState } from "ahooks";
import {
  Button,
  Table,
  Typography,
  Space,
  Input,
  Empty,
  Modal,
  Select,
  Tooltip,
  message,
  Card,
  Image,
} from "antd";
import {
  StarFilled,
  StarOutlined,
  FolderOpenOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import Plyr from "plyr-react";
import "plyr-react/plyr.css";
import styles from "./index.module.scss";
import {
  queryDownloads,
  listUsers,
  clearAllData,
  clearUserData,
} from "@/utils";
import { getSettings, setSettings } from "@/utils/settings";
import { useTranslation } from "react-i18next";

// 文件名预设与示例数据改为多语言

function renderTemplateExample(template, sample) {
  return template
    .replace("{screenName}", sample.screenName)
    .replace("{username}", sample.username)
    .replace("{userId}", sample.userId)
    .replace("{tweetTime}", sample.tweetTime)
    .replace("{tweetId}", sample.tweetId)
    .replace("{random}", sample.random)
    .replace("{text}", sample.text);
}

// SAMPLE_DATA 将在组件内通过 useMemo 基于 i18n 生成

// 使用真实数据

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useSetState({
    loading: false,
    records: [],
    total: 0,
    page: 1,
    pageSize: 20,
    filterText: "",
    filterUser: "",
    filterUsers: [],
    settingsModal: false,
    filenameTemplate: "",
    lang: "zh-CN",
    starredUsers: [],
    allUsers: [],
    clearUsers: [],
    videoPlayerModal: false,
    videoPlayerUrl: "",
  });

  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  }));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let frame = 0;

    const handleResize = () => {
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setViewport((prev) => {
          const width = window.innerWidth;
          const height = window.innerHeight;

          if (prev.width === width && prev.height === height) {
            return prev;
          }

          return { width, height };
        });
      });
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const videoSize = useMemo(() => {
    const aspect = 9 / 16;
    const maxWidth = viewport.width ? viewport.width * 0.96 : 0;
    const maxHeight = viewport.height ? viewport.height * 0.96 : 0;

    if (!maxWidth || !maxHeight) {
      const fallbackWidth = 360;
      return { width: fallbackWidth, height: fallbackWidth / aspect };
    }

    let width = maxWidth;
    let height = width / aspect;

    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }

    return { width, height };
  }, [viewport]);

  const plyrOptions = useMemo(
    () => ({
      controls: ["play", "progress", "current-time", "mute", "volume"],
      autoplay: true,
      ratio: "9:16",
      storage: { enabled: false },
      clickToPlay: true,
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      invertTime: false,
      toggleInvert: false,
    }),
    [],
  );

  useEffect(() => {
    init();
  }, []);
  const init = async () => {
    await loadUsers();
    await loadSettings();
    await refresh();
  };

  const loadUsers = async () => {
    const users = await listUsers();
    setState({ allUsers: Array.isArray(users) ? users : [] });
  };

  // 查询条件变化时自动刷新
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.page,
    state.pageSize,
    state.filterText,
    state.filterUser,
    state.filterUsers,
  ]);

  const loadSettings = async () => {
    const settings = await getSettings();
    setState({
      filenameTemplate: settings.filenameTemplate,
      lang: settings.lang || "zh-CN",
      starredUsers: Array.isArray(settings.starredUsers)
        ? settings.starredUsers
        : [],
    });
  };

  const refresh = async () => {
    setState({ loading: true });
    try {
      const { items, total, page, pageSize } = await queryDownloads({
        page: state.page,
        pageSize: state.pageSize,
        text: state.filterText,
        user: state.filterUser,
        users: state.filterUsers,
      });
      setState({ records: items, total, page, pageSize });
    } finally {
      setState({ loading: false });
    }
  };

  const openSettings = async () => {
    setState({ settingsModal: true });
    // 打开设置时刷新用户列表，确保获取最新数据
    await loadUsers();
  };

  const handleChangeLang = async (val) => {
    setState({ lang: val });
    i18n.changeLanguage(val);
    await setSettings({ filenameTemplate: state.filenameTemplate, lang: val });
  };

  const handleChangeTemplateQuick = async (val) => {
    setState({ filenameTemplate: val });
    await setSettings({ filenameTemplate: val, lang: state.lang });
  };

  const isStarred = (value) => state.starredUsers.includes(String(value));
  const toggleStar = async (value) => {
    const key = String(value);
    const next = isStarred(key)
      ? state.starredUsers.filter((v) => v !== key)
      : [...state.starredUsers, key];
    setState({ starredUsers: next });
    await setSettings({ starredUsers: next });
  };

  const handleClearAllData = async () => {
    try {
      await clearAllData();
      message.success(t("message.clearSuccess"));
      await Promise.all([refresh(), loadUsers()]);
    } catch (error) {
      message.error(t("message.clearFailed") + ": " + error.message);
    }
  };

  const handleClearUserData = async () => {
    if (!state.clearUsers.length) {
      message.warning(t("message.selectUsers"));
      return;
    }
    try {
      await clearUserData(state.clearUsers);
      message.success(t("message.clearSuccess"));
      setState({ clearUsers: [] });
      await Promise.all([refresh(), loadUsers()]);
    } catch (error) {
      message.error(t("message.clearFailed") + ": " + error.message);
    }
  };

  const filtered = state.records;

  // 多语言的文件名预设与示例数据
  const FILENAME_PRESETS = useMemo(
    () => [
      {
        label: t("preset.default"),
        value: "{screenName}_{username}_{tweetTime}",
      },
      {
        label: t("preset.userNameAndDisplay"),
        value: "{screenName}-{username}",
      },
      {
        label: t("preset.displayAndUserName"),
        value: "{username}-{screenName}",
      },
      {
        label: t("preset.userNameAndTime"),
        value: "{screenName}-{tweetTime}",
      },
      {
        label: t("preset.displayAndTime"),
        value: "{username}-{tweetTime}",
      },
    ],
    [t, i18n.language],
  );

  const SAMPLE_DATA = useMemo(
    () => ({
      screenName: t("sample.screenName", { defaultValue: "abc123" }),
      username: t("sample.username", { defaultValue: "User" }),
      userId: t("sample.userId", { defaultValue: "123213123213" }),
      tweetTime: t("sample.tweetTime", { defaultValue: "2025-01-01T12:34" }),
      tweetId: t("sample.tweetId", { defaultValue: "1234567890" }),
      random: t("sample.random", { defaultValue: "A1B2C3" }),
      text: t("sample.text", { defaultValue: "Sample text" }),
    }),
    [t, i18n.language],
  );

  const userOptions = useMemo(() => {
    const starred = [];
    const normal = [];
    (state.allUsers || []).forEach((u) => {
      const key = u.screenName || u.userId;
      if (!key) return;
      const screenName = u.screenName || String(key);
      const displayName = u.username ? String(u.username) : "";
      const userId = u.userId ? String(u.userId) : "";
      const baseLabel = `${screenName}${displayName ? ` / ${displayName}` : ""}${userId ? ` (${userId})` : ""}`;
      const option = { labelString: baseLabel, value: String(key), screenName };
      if (
        state.starredUsers.includes(String(key)) ||
        state.starredUsers.includes(String(u.userId))
      )
        starred.push(option);
      else normal.push(option);
    });
    normal.sort((a, b) => a.screenName.localeCompare(b.screenName));
    return [...starred, ...normal];
  }, [state.allUsers, state.starredUsers]);

  const columns = useMemo(
    () => [
      {
        title: "预览",
        key: "preview",
        width: 80,
        render: (_, item) => {
          const url = item.url || "";
          // 判断是图片还是视频
          const isImage =
            /\.(jpg|jpeg|png|gif|webp)(\?|$|#)/i.test(url) ||
            /pbs\.twimg\.com\/media\//i.test(url);
          const isVideo =
            /\.(mp4|mov|avi)(\?|$|#)/i.test(url) ||
            /video\.twimg\.com/i.test(url);

          if (isImage) {
            // 图片预览 - 使用 Image 组件支持点击放大
            let previewUrl = url;
            // 如果是 Twitter 图片，转换为小尺寸以加快加载
            if (/pbs\.twimg\.com\/media\//i.test(url)) {
              previewUrl = url.replace(/([?&])name=[^&]+/, "$1name=small");
              if (!/[?&]name=/i.test(previewUrl)) {
                previewUrl +=
                  (previewUrl.includes("?") ? "&" : "?") + "name=small";
              }
            }
            return (
              <Image
                src={previewUrl}
                alt="preview"
                width={60}
                height={60}
                style={{
                  objectFit: "cover",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
                preview={{
                  src: url.replace(/([?&])name=[^&]+/, "$1name=orig"),
                }}
                fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Crect width='60' height='60' fill='%23f0f0f0'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23999' font-size='12'%3E图片%3C/text%3E%3C/svg%3E"
              />
            );
          } else if (isVideo) {
            // 视频预览 - 点击打开播放器
            return (
              <div
                style={{
                  width: 60,
                  height: 60,
                  background: "#000",
                  borderRadius: 4,
                  overflow: "hidden",
                  position: "relative",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setState({ videoPlayerModal: true, videoPlayerUrl: url });
                }}
              >
                <video
                  src={url}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                  preload="metadata"
                />
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.9)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                  }}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="#000">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            );
          }

          // 未知类型显示占位符
          return (
            <div
              style={{
                width: 60,
                height: 60,
                background: "#f5f5f5",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                color: "#999",
              }}
            >
              N/A
            </div>
          );
        },
      },
      {
        title: "名称",
        dataIndex: "filename",
        key: "filename",
        ellipsis: true,
        width: 120,
        render: (_, item) => (
          <Typography.Text ellipsis style={{ maxWidth: 240 }}>
            {item.filename || item.url}
          </Typography.Text>
        ),
      },
      {
        title: "用户",
        key: "user",
        width: 120,
        render: (_, item) => (
          <Typography.Text type="secondary">
            {item.screenName || "-"}
            {item.userId ? ` (${item.userId})` : ""}
          </Typography.Text>
        ),
      },
      {
        title: "文案",
        dataIndex: "text",
        key: "text",
        ellipsis: true,
        width: 300,
        render: (v) => {
          const value = v || "";
          return (
            <Tooltip title={value} mouseEnterDelay={0.3}>
              <Typography.Text
                style={{
                  display: "inline-block",
                  maxWidth: 300,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {value}
              </Typography.Text>
            </Tooltip>
          );
        },
      },
      // 移除单独显示的源地址与推文ID列
      {
        title: "创建时间",
        key: "createdAt",
        width: 120,
        render: (_, item) => (
          <Typography.Text style={{ whiteSpace: "nowrap" }}>
            {item.createdAt
              ? dayjs(item.createdAt).format("YYYY-MM-DD HH:mm")
              : ""}
          </Typography.Text>
        ),
      },
      {
        title: "",
        key: "actions",
        fixed: "right",
        width: 80,
        render: (_, item) => {
          // 组合出源地址
          let postUrl = "";
          const sn = item.screenName;
          const tid = item.tweetId;
          if (sn && tid) postUrl = `https://x.com/${sn}/status/${tid}`;
          else if (tid) postUrl = `https://x.com/i/web/status/${tid}`;
          else if (item.text) {
            const m = String(item.text).match(/https?:\/\/\S+/);
            if (m) postUrl = m[0];
          }
          return (
            <Space>
              <Tooltip title={t("btn.openLocal")}>
                <Button
                  size="small"
                  type="text"
                  icon={<FolderOpenOutlined />}
                  onClick={() => {
                    if (!item.downloadId) return;
                    try {
                      chrome.runtime?.sendMessage(
                        {
                          type: "VK_SHOW_IN_FOLDER",
                          payload: { downloadId: item.downloadId },
                        },
                        () => {},
                      );
                    } catch (_) {}
                  }}
                />
              </Tooltip>
              <Tooltip title={t("btn.openSource")}>
                <Button
                  size="small"
                  type="text"
                  icon={<LinkOutlined />}
                  disabled={!postUrl}
                  onClick={() => {
                    if (!postUrl) return;
                    window.open(postUrl, "_blank", "noopener,noreferrer");
                  }}
                />
              </Tooltip>
            </Space>
          );
        },
      },
    ],
    [],
  );

  return (
    <div
      style={{
        padding: 12,
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t("title.records")}
        </Typography.Title>
        <Button size="small" onClick={refresh} loading={state.loading}>
          {t("btn.refresh")}
        </Button>
        <Tooltip title={t("tooltip.settings")}>
          <Button size="small" onClick={openSettings}>
            {t("btn.settings")}
          </Button>
        </Tooltip>
        {state.filterUser ? (
          <Tooltip title={t("filter.pinUserTooltip")}>★</Tooltip>
        ) : null}
      </Space>
      <Space style={{ marginBottom: 8 }} wrap>
        <Select
          allowClear
          size="small"
          style={{ width: 200 }}
          placeholder={t("filter.userPlaceholder")}
          mode="multiple"
          maxTagCount={1}
          options={userOptions.map((opt) => ({
            value: opt.value,
            searchKey: opt.labelString,
            label: (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span>{opt.labelString}</span>
                <span
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStar(opt.value);
                  }}
                  title={isStarred(opt.value) ? "Unpin" : "Pin"}
                >
                  {isStarred(opt.value) ? (
                    <StarFilled style={{ color: "#faad14" }} />
                  ) : (
                    <StarOutlined />
                  )}
                </span>
              </span>
            ),
          }))}
          value={state.filterUsers}
          onChange={(vals) => setState({ filterUsers: vals || [], page: 1 })}
          showSearch
          filterOption={(input, option) =>
            String(option?.searchKey || "")
              .toLowerCase()
              .includes(String(input || "").toLowerCase())
          }
        />
        <Input.Search
          allowClear
          placeholder={t("placeholder.search")}
          size="small"
          onChange={(e) => setState({ filterText: e.target.value, page: 1 })}
        />
      </Space>
      <Table
        columns={columns.map((col) => {
          if (col.key === "preview")
            return { ...col, title: t("table.preview") };
          if (col.key === "filename") return { ...col, title: t("table.name") };
          if (col.key === "user") return { ...col, title: t("table.user") };
          if (col.key === "text") return { ...col, title: t("table.text") };
          if (col.key === "source") return { ...col, title: t("table.source") };
          if (col.key === "tweetId")
            return { ...col, title: t("table.tweetId") };
          if (col.key === "createdAt")
            return { ...col, title: t("table.createdAt") };
          return col;
        })}
        dataSource={filtered}
        rowKey={(r) => r.id}
        size="small"
        loading={state.loading}
        locale={{ emptyText: <Empty description={t("empty.records")} /> }}
        scroll={{ x: "max-content", y: "calc(100vh - 220px)" }}
        sticky
        pagination={{
          current: state.page,
          pageSize: state.pageSize,
          total: state.total,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          onChange: (page, pageSize) => setState({ page, pageSize }),
          onShowSizeChange: (_page, size) =>
            setState({ page: 1, pageSize: size }),
        }}
      />

      <Modal
        open={state.settingsModal}
        title={t("modal.settings.title")}
        onCancel={() => setState({ settingsModal: false })}
        footer={null}
        width={520}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          {/* 功能1: 界面语言 */}
          <Card
            size="small"
            title={t("form.lang")}
            styles={{ body: { padding: "12px" } }}
          >
            <Select
              size="small"
              value={state.lang}
              onChange={handleChangeLang}
              options={[
                { label: t("lang.zhCN"), value: "zh-CN" },
                { label: t("lang.enUS"), value: "en-US" },
                { label: t("lang.jaJP"), value: "ja-JP" },
              ]}
              style={{ width: "100%" }}
            />
          </Card>

          {/* 功能2: 文件名模板 */}
          <Card
            size="small"
            title={t("form.customTemplate")}
            styles={{ body: { padding: "12px" } }}
          >
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              <Select
                size="small"
                placeholder={t("form.quickSelect")}
                value={state.filenameTemplate}
                onChange={handleChangeTemplateQuick}
                options={FILENAME_PRESETS.map((p) => ({
                  label: p.label,
                  value: p.value,
                }))}
                style={{ width: "100%" }}
                showSearch
                optionFilterProp="label"
              />
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 4 }}
                value={state.filenameTemplate}
                onChange={async (e) => {
                  const val = e.target.value;
                  setState({ filenameTemplate: val });
                  await setSettings({
                    filenameTemplate: val,
                    lang: state.lang,
                  });
                }}
              />
              <Typography.Paragraph
                type="secondary"
                style={{ marginBottom: 4, fontSize: 12 }}
              >
                {t("form.placeholders.available")} <code>{"{username}"}</code>{" "}
                {t("form.placeholders.displayName")}、{" "}
                <code>{"{screenName}"}</code> {t("form.placeholders.username")}
                、 <code>{"{tweetTime}"}</code>{" "}
                {t("form.placeholders.publishedAt")} (YYYY-MM-DDTHH:mm)、{" "}
                <code>{"{tweetId}"}</code> {t("form.placeholders.tweetId")}、{" "}
                <code>{"{random}"}</code> {t("form.placeholders.random")}、{" "}
                <code>{"{text}"}</code> {t("form.placeholders.text")}。
              </Typography.Paragraph>
              <Typography.Paragraph
                type="secondary"
                style={{ marginBottom: 0, fontSize: 12 }}
              >
                {t("form.example")}
                <Typography.Text code copyable style={{ marginLeft: 4 }}>
                  {renderTemplateExample(state.filenameTemplate, SAMPLE_DATA)}
                </Typography.Text>
              </Typography.Paragraph>
            </Space>
          </Card>

          {/* 功能3: 数据管理 */}
          <Card
            size="small"
            title={t("form.clearData")}
            styles={{ body: { padding: "12px" } }}
          >
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              <Button danger block size="small" onClick={handleClearAllData}>
                {t("btn.clearAll")}
              </Button>
              <Select
                mode="multiple"
                size="small"
                placeholder={t("form.selectUsers")}
                value={state.clearUsers}
                onChange={(val) => setState({ clearUsers: val })}
                options={userOptions.map((u) => ({
                  label: u.labelString,
                  value: u.value,
                }))}
                style={{ width: "100%" }}
                showSearch
                optionFilterProp="label"
                maxTagCount="responsive"
              />
              <Button
                danger
                block
                size="small"
                onClick={handleClearUserData}
                disabled={!state.clearUsers.length}
              >
                {t("btn.clearUser")}
              </Button>
            </Space>
          </Card>
        </Space>
      </Modal>

      {/* 视频播放器 Modal - 适配侧边栏，竖屏视频 */}
      <Modal
        open={state.videoPlayerModal}
        onCancel={() =>
          setState({ videoPlayerModal: false, videoPlayerUrl: "" })
        }
        footer={null}
        closable={false}
        maskClosable={true}
        keyboard={true}
        width={videoSize.width}
        centered
        destroyOnClose
        styles={{
          body: {
            padding: 0,
            height: videoSize.height,
          },
          content: {
            padding: 0,
            background: "#000",
            width: videoSize.width,
            height: videoSize.height,
            maxWidth: "100%",
            maxHeight: "100%",
          },
        }}
      >
        {state.videoPlayerUrl && (
          <div className={styles.playerWrapper}>
            <Plyr
              source={{
                type: "video",
                sources: [
                  {
                    src: state.videoPlayerUrl,
                    type: "video/mp4",
                  },
                ],
              }}
              options={plyrOptions}
            />
            <button
              type="button"
              onClick={() => window.open(state.videoPlayerUrl, "_blank")}
              className={styles.playerOpenBtn}
            >
              {t("btn.openInNewTab")}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
