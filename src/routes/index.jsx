import { useEffect, useMemo } from "react";
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
  Form,
  Select,
  Tooltip,
} from "antd";
import { downloadList as MOCK_DOWNLOADS } from "@/utils/mock";
import { listDownloads } from "@/utils";
import { getSettings, setSettings } from "@/utils/settings";
import { useTranslation } from "react-i18next";

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
  screenName: "abc123",
  username: "迪迦奥特曼",
  userId: "123213123213",
  tweetTime: "2025-01-01T12:34",
  tweetId: "1234567890",
  random: "A1B2C3",
  text: "哥尔巴，成为了光，得到了梦比优斯的认可，同时和希卡利一同将启示录·邪神格丽扎打入邪神宇宙。",
};

// 开关：是否使用本地假数据调试 UI
const USE_MOCK = true;
const MOCK_RECORDS = MOCK_DOWNLOADS;

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useSetState({
    loading: false,
    records: [],
    filterText: "",
    settingsModal: false,
    filenameTemplate: "",
    lang: "zh-CN",
  });

  useEffect(() => {
    init();
  }, []);
  const init = async () => {
    await Promise.all([refresh(), loadSettings()]);
  };

  const loadSettings = async () => {
    const settings = await getSettings();
    setState({
      filenameTemplate: settings.filenameTemplate,
      lang: settings.lang || "zh-CN",
    });
  };

  const refresh = async () => {
    setState({ loading: true });
    try {
      if (USE_MOCK) {
        await new Promise((r) => setTimeout(r, 200));
        setState({ records: MOCK_RECORDS });
        return;
      }
      const list = await listDownloads(500);
      setState({ records: list });
    } finally {
      setState({ loading: false });
    }
  };

  const openSettings = () => {
    setState({ settingsModal: true });
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

  const filtered = useMemo(() => {
    const t = state.filterText.trim().toLowerCase();
    if (!t) return state.records;
    return state.records.filter((r) =>
      [r.filename, r.screenName, r.userId, r.text, r.tweetId]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(t)),
    );
  }, [state.records, state.filterText]);

  const columns = useMemo(
    () => [
      {
        title: "名称",
        dataIndex: "filename",
        key: "filename",
        ellipsis: true,
        width: 120,
      },
      {
        title: "用户",
        dataIndex: "user",
        key: "user",
        width: 120,
      },
      {
        title: "推文ID",
        dataIndex: "tweetId",
        key: "tweetId",
        width: 120,
      },
      {
        title: "创建时间",
        key: "createdAt",
        width: 120,
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 90,
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
      </Space>
      <Input.Search
        allowClear
        placeholder={t("placeholder.search")}
        size="small"
        onChange={(e) => setState({ filterText: e.target.value })}
        style={{ marginBottom: 8 }}
      />
      <Table
        columns={columns.map((col) => {
          if (col.key === "filename") return { ...col, title: t("table.name") };
          if (col.key === "user") return { ...col, title: t("table.user") };
          if (col.key === "tweetId")
            return { ...col, title: t("table.tweetId") };
          if (col.key === "createdAt")
            return { ...col, title: t("table.createdAt") };
          if (col.key === "status") return { ...col, title: t("table.status") };
          return col;
        })}
        dataSource={filtered}
        rowKey={(r) => r.id}
        size="small"
        loading={state.loading}
        locale={{ emptyText: <Empty description={t("empty.records")} /> }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          hideOnSinglePage: false,
          position: ["bottomCenter"],
          total: filtered.length,
          showTotal: (total) => `Total ${total}`,
        }}
        scroll={{ x: "max-content", y: "calc(100vh - 220px)" }}
      />

      <Modal
        open={state.settingsModal}
        title={t("modal.settings.title")}
        onCancel={() => setState({ settingsModal: false })}
        footer={null}
        width={480}
      >
        <Form layout="vertical">
          <Form.Item label={t("form.lang")}>
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
          </Form.Item>
          <Form.Item label={t("form.quickSelect")}>
            <Select
              size="small"
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
          </Form.Item>
          <Form.Item label={t("form.customTemplate")}>
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              value={state.filenameTemplate}
              onChange={async (e) => {
                const val = e.target.value;
                setState({ filenameTemplate: val });
                await setSettings({ filenameTemplate: val, lang: state.lang });
              }}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              {t("form.placeholders.available")} <code>{"{username}"}</code>{" "}
              {t("form.placeholders.displayName")}、{" "}
              <code>{"{screenName}"}</code> {t("form.placeholders.username")}、{" "}
              <code>{"{tweetTime}"}</code> {t("form.placeholders.publishedAt")}{" "}
              (YYYY-MM-DDTHH:mm)、 <code>{"{tweetId}"}</code>{" "}
              {t("form.placeholders.tweetId")}、 <code>{"{random}"}</code>{" "}
              {t("form.placeholders.random")}、 <code>{"{text}"}</code>{" "}
              {t("form.placeholders.text")}。
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary">
              {t("form.example")}
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
