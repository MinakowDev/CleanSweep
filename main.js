const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const ICON_PATH = "Images\\app.png";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function getTempDirs() {
  const candidates = [
    process.env.TEMP,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Temp") : null
  ].filter(Boolean);

  const seen = new Set();
  const dirs = [];
  for (const dir of candidates) {
    const resolved = path.resolve(dir).toLowerCase();
    if (!seen.has(resolved) && fs.existsSync(dir)) {
      seen.add(resolved);
      dirs.push(path.resolve(dir));
    }
  }
  return dirs;
}

function getDownloadsDir() {
  return path.join(os.homedir(), "Downloads");
}

function getEntrySize(entryPath) {
  try {
    const stat = fs.lstatSync(entryPath);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    const children = fs.readdirSync(entryPath);
    for (const child of children) {
      total += getEntrySize(path.join(entryPath, child));
    }
    return total;
  } catch {
    return 0;
  }
}

function scanTopLevel(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const items = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        const stat = fs.lstatSync(fullPath);
        const size = entry.isDirectory() ? getEntrySize(fullPath) : stat.size;
        items.push({
          name: entry.name,
          fullPath,
          isDirectory: entry.isDirectory(),
          size,
          mtimeMs: stat.mtimeMs
        });
      } catch {
        // Skip inaccessible entries
      }
    }
  } catch {
    // Skip inaccessible directory
  }
  return items;
}

function scanTemp() {
  const dirs = getTempDirs();
  const items = [];
  for (const dir of dirs) {
    items.push(...scanTopLevel(dir));
  }
  const totalSize = items.reduce((acc, item) => acc + item.size, 0);
  return { dirs, items, totalSize };
}

function scanOldDownloads(days) {
  const downloadsDir = getDownloadsDir();
  const cutoffMs = Date.now() - days * MS_PER_DAY;
  const allItems = scanTopLevel(downloadsDir);
  const oldItems = allItems
    .filter((item) => item.mtimeMs < cutoffMs)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  const totalSize = oldItems.reduce((acc, item) => acc + item.size, 0);
  return { downloadsDir, items: oldItems, totalSize, days };
}

function safeDelete(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function cleanTemp() {
  const { items } = scanTemp();
  let deleted = 0;
  for (const item of items) {
    if (safeDelete(item.fullPath)) {
      deleted++;
    }
  }
  return deleted;
}

function cleanOldDownloads(days) {
  const { items } = scanOldDownloads(days);
  let deleted = 0;
  for (const item of items) {
    if (safeDelete(item.fullPath)) {
      deleted++;
    }
  }
  return deleted;
}

function emptyRecycleBin() {
  execSync('powershell.exe -NoProfile -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"', {
    stdio: "ignore",
    windowsHide: true
  });
}

function parseOlderDays(tokens) {
  const idx = tokens.findIndex((t) => t === "--older" || t === "-o");
  if (idx !== -1 && tokens[idx + 1]) {
    const parsed = parseInt(tokens[idx + 1], 10);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
  }
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      return parseInt(token, 10);
    }
  }
  return 30;
}

function buildPreviewResults(category, extraTokens) {
  const cat = (category || "").toLowerCase();

  if (cat === "temp") {
    const { dirs, items, totalSize } = scanTemp();
    if (items.length === 0) {
      return [
        {
          Title: "Предпросмотр: Temp пуст",
          SubTitle: `Проверены папки: ${dirs.join(", ")}`,
          IcoPath: ICON_PATH
        }
      ];
    }
    const header = {
      Title: `Предпросмотр Temp: ${items.length} объектов (${formatBytes(totalSize)})`,
      SubTitle: "Режим предпросмотра — удаление не выполняется",
      IcoPath: ICON_PATH
    };
    const list = items.slice(0, 20).map((item) => ({
      Title: item.name,
      SubTitle: `${item.isDirectory ? "Папка" : "Файл"} • ${formatBytes(item.size)} • ${item.fullPath}`,
      IcoPath: ICON_PATH,
      JsonRPCAction: {
        method: "open_path",
        parameters: [path.dirname(item.fullPath)]
      }
    }));
    return [header, ...list];
  }

  if (cat === "downloads") {
    const days = parseOlderDays(extraTokens);
    const { downloadsDir, items, totalSize } = scanOldDownloads(days);
    if (items.length === 0) {
      return [
        {
          Title: `Предпросмотр Загрузок: нет файлов старше ${days} дн.`,
          SubTitle: downloadsDir,
          IcoPath: ICON_PATH
        }
      ];
    }
    const header = {
      Title: `Предпросмотр Загрузок (>${days} дн.): ${items.length} объектов (${formatBytes(totalSize)})`,
      SubTitle: "Режим предпросмотра — удаление не выполняется",
      IcoPath: ICON_PATH
    };
    const list = items.slice(0, 20).map((item) => {
      const ageDays = Math.floor((Date.now() - item.mtimeMs) / MS_PER_DAY);
      return {
        Title: item.name,
        SubTitle: `${ageDays} дн. назад • ${formatBytes(item.size)} • ${item.fullPath}`,
        IcoPath: ICON_PATH,
        JsonRPCAction: {
          method: "open_path",
          parameters: [path.dirname(item.fullPath)]
        }
      };
    });
    return [header, ...list];
  }

  if (cat === "bin") {
    return [
      {
        Title: "Предпросмотр Корзины",
        SubTitle: "Все файлы и папки в Корзине Windows будут безвозвратно удалены",
        IcoPath: ICON_PATH
      }
    ];
  }

  return [
    {
      Title: "Укажите категорию для предпросмотра",
      SubTitle: "Доступно: clean preview temp | clean preview bin | clean preview downloads",
      IcoPath: ICON_PATH
    }
  ];
}

function handleQuery(rawQuery) {
  const trimmed = (rawQuery || "").trim();
  const tokens = trimmed ? trimmed.split(/\s+/) : [];
  const cmd = (tokens[0] || "").toLowerCase();

  if (!cmd) {
    return [
      {
        Title: "clean temp — Очистить временные файлы",
        SubTitle: "Удалить содержимое %TEMP% и %LOCALAPPDATA%\\Temp",
        IcoPath: ICON_PATH,
        JsonRPCAction: { method: "clean_temp", parameters: [] }
      },
      {
        Title: "clean bin — Очистить корзину",
        SubTitle: "Безвозвратно очистить Корзину Windows",
        IcoPath: ICON_PATH,
        JsonRPCAction: { method: "clean_bin", parameters: [] }
      },
      {
        Title: "clean downloads --older 30 — Старые загрузки",
        SubTitle: "Показать список и удалить файлы из Загрузок старше 30 дней",
        IcoPath: ICON_PATH,
        JsonRPCAction: { method: "open_path", parameters: [getDownloadsDir()] }
      },
      {
        Title: "clean preview <категория> — Предпросмотр",
        SubTitle: "Показать, что будет удалено (temp, bin, downloads), без удаления",
        IcoPath: ICON_PATH
      }
    ];
  }

  if (cmd === "temp") {
    const { dirs, items, totalSize } = scanTemp();
    return [
      {
        Title: `Очистить Temp (${items.length} объектов, ${formatBytes(totalSize)})`,
        SubTitle: `Нажмите Enter для удаления содержимого: ${dirs.join(", ")}`,
        IcoPath: ICON_PATH,
        JsonRPCAction: { method: "clean_temp", parameters: [] }
      }
    ];
  }

  if (cmd === "bin") {
    return [
      {
        Title: "Очистить Корзину",
        SubTitle: "Нажмите Enter, чтобы безвозвратно очистить Корзину Windows",
        IcoPath: ICON_PATH,
        JsonRPCAction: { method: "clean_bin", parameters: [] }
      }
    ];
  }

  if (cmd === "downloads") {
    const days = parseOlderDays(tokens.slice(1));
    const { downloadsDir, items, totalSize } = scanOldDownloads(days);
    if (items.length === 0) {
      return [
        {
          Title: `В Загрузках нет файлов старше ${days} дн.`,
          SubTitle: downloadsDir,
          IcoPath: ICON_PATH
        }
      ];
    }
    const actionItem = {
      Title: `Удалить ${items.length} старых объектов (${formatBytes(totalSize)})`,
      SubTitle: `Файлы и папки в Загрузках старше ${days} дней • Нажмите Enter для удаления`,
      IcoPath: ICON_PATH,
      JsonRPCAction: { method: "clean_downloads", parameters: [days] }
    };
    const previewItems = items.slice(0, 15).map((item) => {
      const ageDays = Math.floor((Date.now() - item.mtimeMs) / MS_PER_DAY);
      return {
        Title: `[Предпросмотр] ${item.name}`,
        SubTitle: `${ageDays} дн. назад • ${formatBytes(item.size)}`,
        IcoPath: ICON_PATH,
        JsonRPCAction: { method: "open_path", parameters: [path.dirname(item.fullPath)] }
      };
    });
    return [actionItem, ...previewItems];
  }

  if (cmd === "preview") {
    return buildPreviewResults(tokens[1], tokens.slice(2));
  }

  return [
    {
      Title: `Неизвестная команда: ${trimmed}`,
      SubTitle: "Доступно: temp, bin, downloads --older 30, preview <категория>",
      IcoPath: ICON_PATH
    }
  ];
}

function main() {
  const rawArg = process.argv[2];
  if (!rawArg) {
    console.log(JSON.stringify({ result: [] }));
    return;
  }

  let request;
  try {
    request = JSON.parse(rawArg);
  } catch {
    console.log(JSON.stringify({ result: [] }));
    return;
  }

  const { method, parameters = [] } = request;

  if (method === "query") {
    const results = handleQuery(parameters[0] || "");
    console.log(JSON.stringify({ result: results }));
    return;
  }

  if (method === "clean_temp") {
    cleanTemp();
    console.log(JSON.stringify({ result: [] }));
    return;
  }

  if (method === "clean_bin") {
    emptyRecycleBin();
    console.log(JSON.stringify({ result: [] }));
    return;
  }

  if (method === "clean_downloads") {
    const days = typeof parameters[0] === "number" ? parameters[0] : 30;
    cleanOldDownloads(days);
    console.log(JSON.stringify({ result: [] }));
    return;
  }

  if (method === "open_path" && parameters[0]) {
    try {
      execSync(`explorer.exe "${parameters[0]}"`, { stdio: "ignore", windowsHide: true });
    } catch {
      // explorer.exe may return non-zero even on success
    }
    console.log(JSON.stringify({ result: [] }));
    return;
  }

  console.log(JSON.stringify({ result: [] }));
}

main();
