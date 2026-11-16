# CleanSweep — Flow Launcher Plugin

Быстрая очистка «мусора» на Windows прямо из **Flow Launcher** без открытия проводника и сторонних оптимизаторов.

## Возможности

- `clean temp` — удалить содержимое `%TEMP%` и `%LOCALAPPDATA%\Temp` (занятые системой файлы безопасно пропускаются).
- `clean bin` — очистить Корзину Windows.
- `clean downloads --older 30` — показать предпросмотр файлов и папок в «Загрузках» старше `N` дней (по умолчанию 30) и удалить их по нажатию Enter.
- `clean preview <категория>` — показать список того, что будет удалено (`temp`, `bin`, `downloads`), без выполнения удаления.

## Требования

- [Flow Launcher](https://www.flowlauncher.com/)
- [Node.js](https://nodejs.org/) (v16+)

## Установка

1. Скопируйте папку `CleanSweep` в директорию плагинов Flow Launcher:
   ```
   %APPDATA%\FlowLauncher\Plugins\CleanSweep
   ```
2. Перезапустите Flow Launcher или выполните команду `restart` в лаунчере.
3. Используйте ключевое слово `clean`.

## Примеры использования

```text
clean
clean temp
clean bin
clean downloads --older 30
clean preview temp
clean preview downloads --older 14
```

## Лицензия

MIT
