import { useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSetState } from "ahooks";
import { Button, List, Tag, Typography, Space, Input, Empty } from "antd";
import dayjs from "dayjs";
import { listDownloads } from "@/utils";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [state, setState] = useSetState({
    loading: false,
    records: [],
    filterText: "",
  });

  useEffect(() => {
    init();
  }, []);
  const init = async () => {
    await refresh();
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
    </div>
  );
}
