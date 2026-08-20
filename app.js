/* MDノート - a lightweight standalone Markdown editor / previewer / PDF exporter
 * Runs entirely client-side (no server, no Python, no build step).
 * Uses the File System Access API when available (Chrome/Edge) for real
 * in-place open/save; falls back to <input webkitdirectory>/download when not.
 */
(function () {
  "use strict";

  const hasFSAccess = "showDirectoryPicker" in window && "showOpenFilePicker" in window;

  // ---------- State ----------
  let rootDirHandle = null;
  let openFiles = new Map(); // id -> { id, name, path, handle, fileObj, doc, cleanGen, isNew }
  let activeId = null;
  let untitledCount = 0;
  let cm = null;
  let previewTimer = null;

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const editorTextarea = $("#editor");
  const previewContent = $("#preview-content");
  const tabsBar = $("#tabs");
  const fileTree = $("#file-tree");
  const folderNameEl = $("#folder-name");
  const statusFile = $("#status-file");
  const statusMsg = $("#status-msg");
  const workspace = $("#workspace");
  const folderInput = $("#folder-input");
  const fileInput = $("#file-input");

  marked.setOptions({ gfm: true, breaks: true });

  // ---------- CodeMirror ----------
  cm = CodeMirror.fromTextArea(editorTextarea, {
    mode: "markdown",
    theme: document.body.classList.contains("theme-dark") ? "dracula" : "default",
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    indentUnit: 2,
    viewportMargin: Infinity,
  });

  cm.on("change", () => {
    schedulePreviewUpdate();
    updateActiveTabDirtyState();
  });

  // ---------- Utility ----------
  function uid() {
    return "f" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function setStatus(msg, timeout) {
    statusMsg.textContent = msg || "";
    if (timeout) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(() => (statusMsg.textContent = ""), timeout);
    }
  }

  function isMarkdownish(name) {
    return /\.(md|markdown|mdx|txt)$/i.test(name);
  }

  function schedulePreviewUpdate() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 150);
  }

  function renderPreview() {
    const raw = cm.getValue();
    const html = DOMPurify.sanitize(marked.parse(raw));
    previewContent.innerHTML = html;
  }

  // ---------- Tabs / file state ----------
  function newDocFromContent(content) {
    return new CodeMirror.Doc(content, "markdown");
  }

  function addFile({ name, path, handle, fileObj, content, isNew }) {
    const id = uid();
    const doc = newDocFromContent(content);
    const entry = {
      id, name, path: path || name, handle: handle || null,
      fileObj: fileObj || null, doc, isNew: !!isNew,
    };
    entry.cleanGen = doc.changeGeneration();
    openFiles.set(id, entry);
    renderTabs();
    activateFile(id);
    return id;
  }

  function activateFile(id) {
    const entry = openFiles.get(id);
    if (!entry) return;
    activeId = id;
    cm.swapDoc(entry.doc);
    cm.focus();
    renderTabs();
    renderPreview();
    updateStatusBar();
    highlightActiveTreeNode();
  }

  function closeFile(id) {
    const entry = openFiles.get(id);
    if (!entry) return;
    if (!entry.doc.isClean(entry.cleanGen)) {
      const ok = confirm(`「${entry.name}」の変更を保存せずに閉じますか？`);
      if (!ok) return;
    }
    openFiles.delete(id);
    if (activeId === id) {
      const remaining = [...openFiles.keys()];
      if (remaining.length) {
        activateFile(remaining[remaining.length - 1]);
      } else {
        activeId = null;
        cm.swapDoc(newDocFromContent(""));
        previewContent.innerHTML = "";
        updateStatusBar();
      }
    }
    renderTabs();
  }

  function updateActiveTabDirtyState() {
    if (!activeId) return;
    const entry = openFiles.get(activeId);
    if (!entry) return;
    const tabEl = tabsBar.querySelector(`[data-id="${activeId}"] .dirty-dot`);
    const dirty = !entry.doc.isClean(entry.cleanGen);
    if (tabEl) tabEl.style.visibility = dirty ? "visible" : "hidden";
    updateStatusBar();
  }

  function renderTabs() {
    tabsBar.innerHTML = "";
    for (const [id, entry] of openFiles) {
      const dirty = !entry.doc.isClean(entry.cleanGen);
      const tab = document.createElement("div");
      tab.className = "tab" + (id === activeId ? " active" : "");
      tab.dataset.id = id;
      tab.innerHTML = `
        <span class="dirty-dot" style="visibility:${dirty ? "visible" : "hidden"}">●</span>
        <span class="tab-name">${escapeHtml(entry.name)}</span>
        <span class="tab-close" title="閉じる">✕</span>
      `;
      tab.addEventListener("click", (e) => {
        if (e.target.classList.contains("tab-close")) {
          closeFile(id);
        } else {
          activateFile(id);
        }
      });
      tabsBar.appendChild(tab);
    }
  }

  function updateStatusBar() {
    if (!activeId) {
      statusFile.textContent = "開いているファイルはありません";
      return;
    }
    const entry = openFiles.get(activeId);
    const dirty = !entry.doc.isClean(entry.cleanGen);
    const where = entry.handle ? entry.path : entry.isNew ? "(未保存)" : entry.path + " (読み取り専用ソース / 保存はダウンロードになります)";
    statusFile.textContent = `${entry.name} — ${where}${dirty ? "  ●未保存の変更" : ""}`;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- Folder tree (File System Access API) ----------
  async function buildTreeFromDirHandle(dirHandle) {
    const node = { name: dirHandle.name, kind: "directory", children: [] };
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "directory") {
        if (name.startsWith(".") || name === "node_modules") continue;
        node.children.push(await buildTreeFromDirHandle(handle));
      } else {
        node.children.push({ name, kind: "file", handle });
      }
    }
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
    return node;
  }

  // ---------- Folder tree (fallback: webkitdirectory FileList) ----------
  function buildTreeFromFileList(fileList) {
    const root = { name: "フォルダ", kind: "directory", children: [] };
    const dirMap = new Map();
    dirMap.set("", root);
    for (const file of fileList) {
      const relPath = file.webkitRelativePath || file.name;
      const parts = relPath.split("/");
      let parentPath = "";
      let parent = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const dirName = parts[i];
        const curPath = parentPath ? parentPath + "/" + dirName : dirName;
        if (!dirMap.has(curPath)) {
          const node = { name: dirName, kind: "directory", children: [] };
          dirMap.set(curPath, node);
          parent.children.push(node);
        }
        parent = dirMap.get(curPath);
        parentPath = curPath;
      }
      parent.children.push({ name: parts[parts.length - 1], kind: "file", fileObj: file, path: relPath });
    }
    return root;
  }

  function renderTree(node, container, path = "") {
    container.innerHTML = "";
    (node.children || []).forEach((child) => renderTreeNode(child, container, path));
  }

  function renderTreeNode(node, container, parentPath) {
    const fullPath = parentPath ? parentPath + "/" + node.name : node.name;
    const wrapper = document.createElement("div");
    wrapper.className = "tree-node";

    const label = document.createElement("div");
    label.className = "tree-label";
    label.dataset.path = fullPath;

    if (node.kind === "directory") {
      // Folders start collapsed (like VS Code's explorer) so opening a
      // folder with lots of nested subfolders doesn't dump everything
      // on screen at once. Click to expand one level at a time.
      label.innerHTML = `<span class="tree-toggle">▸</span><span>📂 ${escapeHtml(node.name)}</span>`;
      const childrenEl = document.createElement("div");
      childrenEl.className = "tree-children collapsed";
      (node.children || []).forEach((child) => renderTreeNode(child, childrenEl, fullPath));
      label.addEventListener("click", () => {
        childrenEl.classList.toggle("collapsed");
        label.querySelector(".tree-toggle").textContent = childrenEl.classList.contains("collapsed") ? "▸" : "▾";
      });
      wrapper.appendChild(label);
      wrapper.appendChild(childrenEl);
    } else {
      const icon = isMarkdownish(node.name) ? "📝" : "📄";
      label.innerHTML = `<span class="tree-toggle"></span><span>${icon} ${escapeHtml(node.name)}</span>`;
      label.addEventListener("click", () => openTreeFile(node, fullPath, label));
      wrapper.appendChild(label);
    }
    container.appendChild(wrapper);
  }

  function highlightActiveTreeNode() {
    fileTree.querySelectorAll(".tree-label.active").forEach((el) => el.classList.remove("active"));
    if (!activeId) return;
    const entry = openFiles.get(activeId);
    if (!entry || !entry.path) return;
    const el = fileTree.querySelector(`.tree-label[data-path="${CSS.escape(entry.path)}"]`);
    if (el) el.classList.add("active");
  }

  async function openTreeFile(node, fullPath, labelEl) {
    // Reuse already-open tab if same path
    for (const [id, entry] of openFiles) {
      if (entry.path === fullPath) {
        activateFile(id);
        return;
      }
    }
    let content = "";
    try {
      if (node.handle) {
        const file = await node.handle.getFile();
        content = await file.text();
      } else if (node.fileObj) {
        content = await node.fileObj.text();
      }
    } catch (err) {
      alert("ファイルを読み込めませんでした: " + err.message);
      return;
    }
    addFile({ name: node.name, path: fullPath, handle: node.handle || null, fileObj: node.fileObj || null, content });
  }

  // ---------- Open folder ----------
  $("#btn-open-folder").addEventListener("click", async () => {
    if (hasFSAccess) {
      try {
        rootDirHandle = await window.showDirectoryPicker();
      } catch (err) {
        if (err.name !== "AbortError") alert("フォルダを開けませんでした: " + err.message);
        return;
      }
      setStatus("フォルダを読み込み中…");
      const tree = await buildTreeFromDirHandle(rootDirHandle);
      folderNameEl.textContent = "📁 " + rootDirHandle.name;
      renderTree(tree, fileTree);
      setStatus("フォルダを読み込みました", 2000);
    } else {
      folderInput.click();
    }
  });

  folderInput.addEventListener("change", (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const firstRel = files[0].webkitRelativePath || "";
    const rootName = firstRel.split("/")[0] || "フォルダ";
    folderNameEl.textContent = "📁 " + rootName + " (読み取り専用ブラウザ)";
    const tree = buildTreeFromFileList(files);
    renderTree(tree, fileTree);
  });

  // ---------- Open single file ----------
  $("#btn-open-file").addEventListener("click", async () => {
    if (hasFSAccess) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] } }],
        });
        const file = await handle.getFile();
        const content = await file.text();
        addFile({ name: handle.name, path: handle.name, handle, content });
      } catch (err) {
        if (err.name !== "AbortError") alert("ファイルを開けませんでした: " + err.message);
      }
    } else {
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const content = await file.text();
    addFile({ name: file.name, path: file.name, fileObj: file, content });
    fileInput.value = "";
  });

  // ---------- New file ----------
  $("#btn-new-file").addEventListener("click", () => {
    untitledCount += 1;
    const name = untitledCount === 1 ? "無題.md" : `無題-${untitledCount}.md`;
    addFile({ name, path: name, content: "", isNew: true });
  });

  // ---------- Save ----------
  function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function writeToHandle(handle, content) {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async function saveActive(forcePrompt) {
    if (!activeId) return;
    const entry = openFiles.get(activeId);
    const content = entry.doc.getValue();

    try {
      if (entry.handle && !forcePrompt) {
        await writeToHandle(entry.handle, content);
        entry.cleanGen = entry.doc.changeGeneration();
        entry.isNew = false;
        setStatus(`「${entry.name}」を保存しました`, 2500);
      } else if (hasFSAccess && window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: entry.name,
          types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
        });
        await writeToHandle(handle, content);
        entry.handle = handle;
        entry.name = handle.name;
        entry.path = handle.name;
        entry.isNew = false;
        entry.cleanGen = entry.doc.changeGeneration();
        renderTabs();
        updateStatusBar();
        setStatus(`「${entry.name}」を保存しました`, 2500);
      } else {
        downloadTextFile(entry.name, content);
        entry.cleanGen = entry.doc.changeGeneration();
        setStatus(`「${entry.name}」をダウンロードしました（このブラウザは直接上書き保存に対応していません）`, 4000);
      }
    } catch (err) {
      if (err.name !== "AbortError") alert("保存に失敗しました: " + err.message);
      return;
    }
    renderTabs();
    updateStatusBar();
  }

  $("#btn-save").addEventListener("click", () => saveActive(false));
  $("#btn-save-as").addEventListener("click", () => saveActive(true));

  // ---------- View toggle ----------
  document.getElementById("view-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".view-btn");
    if (!btn) return;
    document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    workspace.className = "view-" + btn.dataset.view;
    cm.refresh();
  });

  // ---------- Theme toggle ----------
  $("#btn-theme-toggle").addEventListener("click", () => {
    const dark = document.body.classList.contains("theme-dark");
    document.body.classList.toggle("theme-dark", !dark);
    document.body.classList.toggle("theme-light", dark);
    cm.setOption("theme", dark ? "default" : "dracula");
    $("#btn-theme-toggle").textContent = dark ? "☀️" : "🌙";
  });

  // ---------- PDF export ----------
  $("#btn-export-pdf").addEventListener("click", async () => {
    if (!activeId) {
      alert("PDF出力するファイルを開いてください。");
      return;
    }
    const entry = openFiles.get(activeId);
    const raw = entry.doc.getValue();
    const html = DOMPurify.sanitize(marked.parse(raw));

    const container = document.createElement("div");
    container.id = "pdf-export-root";
    container.className = "markdown-body";
    container.innerHTML = html;
    document.body.appendChild(container);
    // html2canvas needs the source element rendered in normal document flow
    // (not off-screen / negative z-index) to reliably capture it, so we
    // briefly hide the app UI behind the export container instead.
    document.body.classList.add("exporting-pdf");

    const pdfName = entry.name.replace(/\.(md|markdown|txt)$/i, "") + ".pdf";
    setStatus("PDFを生成中…");
    try {
      await html2pdf()
        .set({
          margin: [12, 12, 14, 12],
          filename: pdfName,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "avoid-all"] },
        })
        .from(container)
        .save();
      setStatus(`「${pdfName}」をダウンロードしました`, 3000);
    } catch (err) {
      alert("PDFの生成に失敗しました: " + err.message);
    } finally {
      document.body.classList.remove("exporting-pdf");
      container.remove();
    }
  });

  // ---------- Keyboard shortcuts ----------
  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveActive(e.shiftKey);
    } else if (mod && e.key.toLowerCase() === "o") {
      e.preventDefault();
      $("#btn-open-file").click();
    } else if (mod && e.key.toLowerCase() === "n") {
      e.preventDefault();
      $("#btn-new-file").click();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    for (const entry of openFiles.values()) {
      if (!entry.doc.isClean(entry.cleanGen)) {
        e.preventDefault();
        e.returnValue = "";
        return;
      }
    }
  });

  // ---------- Boot ----------
  const welcome = `# MDノートへようこそ 👋

これはブラウザだけで動く、軽量なMarkdown編集アプリです。

## 使い方

- **📁 フォルダを開く** — Markdownファイルが入ったフォルダを選択すると、左側にファイル一覧（エクスプローラー）が表示されます。
- **📄 ファイルを開く / ＋ 新規** — 1つのファイルだけ開く、または新しい原稿を書き始めます。
- **💾 保存 (Ctrl+S)** — 元のファイルに上書き保存します。
- **📕 PDF出力** — 今表示中の内容をそのままPDFファイルとしてダウンロードします。
- 右上の **編集 / 分割 / プレビュー** で表示モードを切り替えられます。
- 🌙 ボタンでダークモードとライトモードを切り替えられます。

\`\`\`js
// コードブロックにもシンタックスハイライトが付きます
function hello() {
  console.log("Hello, Markdown!");
}
\`\`\`

> このタブを閉じるか、上のツールバーから新しいファイルを開いて始めましょう。
`;
  addFile({ name: "ようこそ.md", path: "ようこそ.md", content: welcome, isNew: true });
  cm.refresh();
})();
