import { useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSetState } from "ahooks";
import {
  Button,
  List,
  Tag,
  Typography,
  Space,
  Input,
  Empty,
  Modal,
  Form,
  Radio,
  Tooltip,
  message,
} from "antd";
import dayjs from "dayjs";
import { listDownloads } from "@/utils";
import { getSettings, setSettings } from "@/utils/settings";

const FILENAME_PRESETS = [
  {
    label: "默认：用户名_显示名_发布时间",
    value: "{screenName}_{username}_{tweetTime}",
  },
  {
    label: "用户名-显示名",
    value: "{screenName}-{username}",
  },
  {
    label: "显示名-用户名",
    value: "{username}-{screenName}",
  },
  {
    label: "用户名-发布时间",
    value: "{screenName}-{tweetTime}",
  },
  {
    label: "显示名-发布时间",
    value: "{username}-{tweetTime}",
  },
];

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

const SAMPLE_DATA = {
  screenName: "fancha1111",
  username: "虎式坦克",
  userId: "44196397",
  tweetTime: "2025-01-01T12:34",
  tweetId: "1234567890",
  random: "A1B2C3",
  text: "星舰发射",
};

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [state, setState] = useSetState({
    loading: false,
    records: [],
    filterText: "",
    settingsModal: false,
    filenameTemplate: "",
    savingSettings: false,
  });

  useEffect(() => {
    init();
  }, []);
  const init = async () => {
    await Promise.all([refresh(), loadSettings()]);
  };

  const loadSettings = async () => {
    const settings = await getSettings();
    setState({ filenameTemplate: settings.filenameTemplate });
  };

  const refresh = async () => {
    setState({ loading: true });
    try {
      const list = await listDownloads(500);
      setState({ records: list });
    } finally {
      setState({ loading: false });
    }
  };

  const openSettings = () => {
    setState({ settingsModal: true });
  };

  const handleSettingsOk = async () => {
    setState({ savingSettings: true });
    try {
      await setSettings({ filenameTemplate: state.filenameTemplate });
      message.success("已保存文件名模板");
      setState({ settingsModal: false });
    } catch (error) {
      message.error("保存失败，请稍后再试");
    } finally {
      setState({ savingSettings: false });
    }
  };

  const filtered = useMemo(() => {
    const t = state.filterText.trim().toLowerCase();
    if (!t) return state.records;
    return state.records.filter((r) =>
      [r.filename, r.screenName, r.userId, r.text, r.tweetId]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(t)),
    );
  }, [state.records, state.filterText]);

  return (
    <div style={{ padding: 12, width: 360 }}>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          视频下载记录
        </Typography.Title>
        <Button size="small" onClick={refresh} loading={state.loading}>
          刷新
        </Button>
        <Tooltip title="配置下载文件名格式">
          <Button size="small" onClick={openSettings}>
            设置
          </Button>
        </Tooltip>
      </Space>
      <Input.Search
        allowClear
        placeholder="搜索名称/用户/文案"
        size="small"
        onChange={(e) => setState({ filterText: e.target.value })}
        style={{ marginBottom: 8 }}
      />
      <List
        locale={{ emptyText: <Empty description="暂无下载记录" /> }}
        size="small"
        dataSource={filtered}
        bordered
        renderItem={(item) => {
          const statusColor =
            item.status === "completed"
              ? "green"
              : item.status === "interrupted"
                ? "red"
                : "blue";
          const createdAt = item.createdAt
            ? dayjs(item.createdAt).format("YYYY-MM-DD HH:mm")
            : "";
          const completedAt = item.completedAt
            ? dayjs(item.completedAt).format("HH:mm")
            : null;
          return (
            <List.Item
              actions={[
                <div key="times" style={{ textAlign: "right" }}>
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block" }}
                  >
                    {createdAt}
                  </Typography.Text>
                  {completedAt ? (
                    <Typography.Text type="secondary">
                      完成 {completedAt}
                    </Typography.Text>
                  ) : null}
                </div>,
                <Tag color={statusColor} key="status">
                  {item.status || "queued"}
                </Tag>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Typography.Text ellipsis style={{ maxWidth: 200 }}>
                    {item.filename || item.url}
                  </Typography.Text>
                }
                description={
                  <div>
                    <Typography.Text
                      style={{ display: "block" }}
                      type="secondary"
                    >
                      {item.screenName || "未知用户"}
                      {item.userId ? ` (${item.userId})` : ""} ·{" "}
                      {item.tweetId || "-"}
                    </Typography.Text>
                    {item.text ? (
                      <Typography.Paragraph
                        type="secondary"
                        style={{ marginBottom: 0 }}
                        ellipsis={{ rows: 2 }}
                      >
                        {item.text}
                      </Typography.Paragraph>
                    ) : null}
                  </div>
                }
              />
            </List.Item>
          );
        }}
      />

      <Modal
        open={state.settingsModal}
        title="文件名模板设置"
        onCancel={() => setState({ settingsModal: false })}
        onOk={handleSettingsOk}
        okButtonProps={{ loading: state.savingSettings }}
        width={480}
      >
        <Form layout="vertical">
          <Form.Item label="快速选择">
            <Radio.Group
              value={state.filenameTemplate}
              onChange={(e) => setState({ filenameTemplate: e.target.value })}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {FILENAME_PRESETS.map((preset) => (
                <Radio key={preset.value} value={preset.value}>
                  {preset.label}
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>
          <Form.Item label="自定义模板">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              value={state.filenameTemplate}
              onChange={(e) => setState({ filenameTemplate: e.target.value })}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              可用占位符： <code>{"{username}"}</code> 显示名、{" "}
              <code>{"{screenName}"}</code> 用户名、{" "}
              <code>{"{tweetTime}"}</code> 发布时间 (YYYY-MM-DDTHH:mm)、{" "}
              <code>{"{tweetId}"}</code> 推文 ID、 <code>{"{random}"}</code>{" "}
              随机串、 <code>{"{text}"}</code> 文案概要。
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary">
              示例：
              <Typography.Text code copyable style={{ marginLeft: 4 }}>
                {renderTemplateExample(state.filenameTemplate, SAMPLE_DATA)}
              </Typography.Text>
            </Typography.Paragraph>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
