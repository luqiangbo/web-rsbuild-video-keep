import { useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSetState } from "ahooks";
import { Button, List, Tag, Typography, Space, message, Input } from "antd";
import { bulkAddDownloadRecords, listDownloads } from "@/utils";

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
      [r.filename, r.username, r.userId, r.text].some((x) =>
        String(x || "")
          .toLowerCase()
          .includes(t),
      ),
    );
  }, [state.records, state.filterText]);

  const onAddMock = async () => {
    const items = [
      {
        url: "https://example.com/video.mp4",
        filename: `user_uid_desc_${Date.now()}.mp4`,
        username: "user",
        userId: "uid",
        text: "desc",
        status: "queued",
      },
    ];
    await bulkAddDownloadRecords(items);
    message.success("已添加示例记录");
    refresh();
  };
  return (
    <div style={{ padding: 12, width: 360 }}>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          视频下载记录
        </Typography.Title>
        <Button size="small" onClick={refresh} loading={state.loading}>
          刷新
        </Button>
        <Button size="small" onClick={onAddMock}>
          添加示例
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
        size="small"
        dataSource={filtered}
        bordered
        renderItem={(item) => (
          <List.Item
            actions={[
              <Tag
                color={
                  item.status === "completed"
                    ? "green"
                    : item.status === "interrupted"
                      ? "red"
                      : "blue"
                }
                key="s"
              >
                {item.status}
              </Tag>,
            ]}
          >
            <List.Item.Meta
              title={
                <Typography.Text ellipsis style={{ maxWidth: 220 }}>
                  {item.filename}
                </Typography.Text>
              }
              description={`${item.username} (${item.userId}) ${item.text ? "- " + item.text : ""}`}
            />
          </List.Item>
        )}
      />
    </div>
  );
}
