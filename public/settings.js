import { getSettings, setSettings } from "../src/utils/settings";

(async () => {
  const textarea = document.getElementById("tpl");
  const status = document.getElementById("status");
  const btn = document.getElementById("save");

  const current = await getSettings();
  textarea.value = current.filenameTemplate;

  btn.addEventListener("click", async () => {
    const tpl = textarea.value.trim();
    const next = tpl || current.filenameTemplate;
    const saved = await setSettings({ filenameTemplate: next });
    textarea.value = saved.filenameTemplate;
    status.textContent = "已保存";
    setTimeout(() => {
      status.textContent = "";
    }, 2000);
  });
})();
