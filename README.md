# ETHAN Super App

> 个人数字空间的统一入口 —— 把四个已完成的离线 App 整合为一个统一首页、统一视觉、统一主题、统一设置体系的超级 App。完全离线，无登录，无后端，零第三方依赖。

## 项目简介

ETHAN Super App 是一个纯本地的个人数字空间应用：H5 版本运行于浏览器（Node 静态服务器），Android 版本使用原生 WebView 壳打包为 APK。四个功能模块通过同源 iframe 隔离整合，共享统一的外观与设置体系，但各自保留独立的数据存储、路由与返回逻辑，原始功能与数据结构零合并、零迁移。

## 核心功能

- **统一首页**：品牌时钟（真实系统时间）、2×2 模块卡片（实时读取各模块非敏感统计）、最近使用、随机回忆
- **统一设置中心**：外观三选一（浅色 / 深色 / 跟随系统）、界面开关，主题变更实时同步到所有已打开模块
- **统一数据管理**：一键导出 / 导入 `.ethan` 统一备份包（覆盖三个模块的数据，导入前完整校验 + 动态预览，支持合并 / 替换）
- **模块按需加载**：首页不加载任何模块，点击卡片才创建 iframe，创建后缓存复用
- **统一返回链路**：Android 返回键 → 外壳 → 转发进模块；浏览器侧由 history 自然回退

## 四个核心模块

| App | 模块路径 | 说明 |
| --- | --- | --- |
| 📦 我的空间 | `modules/my-space/` | 物品收纳档案（图片、分类、标签、回收站、搜索、导入导出） |
| 🧰 工具箱 | `modules/toolbox/` | 13 个本地工具：图片压缩 / 格式转换 / 图片转 PDF / 计算器 / 折扣 / 百分比 / 单位换算 / 文件大小换算 / 随机数 / JSON 格式化 / 进制转换 / UUID / 时间戳转换 |
| 🗺️ 旅行足迹 | `modules/travel-footprint/` | 城市 / 旅程 / 离线 SVG 地图（含九段线合规）/ 照片附件 / 时间线 / 统计 |
| 🔐 ETHAN | `modules/ethan/` | 密码管理：账号密码 / 密钥 Token / 文本 / 其他四类条目，6 位 PIN · PBKDF2-SHA256 · AES-256-GCM · 加密 IndexedDB · 自动锁定 |

## 项目结构

```
ethan-super-app/
├─ app/                  # Super App 外壳（首页 / 统一设置 / 主题 / 路由 / 模块管理 / 统一数据管理）
│  ├─ css/{base,home,settings}.css
│  └─ js/{core,ui,platform}/...
├─ modules/              # 四个子 App（各自的 app/ + tests/），在原始独立项目副本上做最小整合补丁
│  ├─ my-space/
│  ├─ toolbox/
│  ├─ travel-footprint/
│  └─ ethan/
├─ android/              # Android 壳（原生 Java，零第三方依赖，无 INTERNET 权限）
│  ├─ AndroidManifest.xml
│  ├─ java/cn/ethan/superapp/
│  ├─ res/
│  └─ keystore/          # 签名密钥（本地保留，不入仓库）
├─ scripts/build-apk.sh  # aapt2 → javac → d8 → zipalign → apksigner 手工构建链
├─ tests/run-tests.mjs   # 外壳单元测试
├─ tools/                # serve / e2e / responsive / shots / diag（CDP 驱动）
└─ docs/                 # 审查报告 / 测试报告 / 构建说明 / 发布审计报告
```

## 离线设计

- **H5**：全部资源本地静态文件，代码经静态扫描 0 处网络原语（`fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `serviceWorker`），E2E 全程收集网络请求，非 `127.0.0.1` 域名请求数为 0。
- **Android**：`AndroidManifest.xml` **有意不声明 INTERNET 权限** —— 离线是系统级保证，构建脚本在打包后校验权限清单，出现 INTERNET 即构建失败。
- 模块数据全部保存在本地（浏览器 IndexedDB / localStorage，Android 应用私有目录），无任何云同步。

## 隐私与安全设计

- **ETHAN 加密方案**：6 位 PIN 经 PBKDF2-SHA256（随机盐）派生密钥，整个密码库（vault）以 AES-256-GCM 整体加密后存入 IndexedDB；meta 库仅存 KDF 盐与校验参数，不含任何明文机密。加密通过浏览器 Web Crypto API 实现，密钥不落盘。
- **忘记 PIN 无法恢复**：没有任何后门或找回机制，请定期创建加密备份并妥善保管备份密码。
- **外壳与模块的数据边界**：首页与随机回忆永不读取 ETHAN 明文；ETHAN 卡片只显示条目总数（模块在解锁 / 持久化时写入仅含数字与时间戳的非敏感计数 `ethan.stats.v1`）。
- **Android 壳**：`allowBackup="false"`、`usesCleartextTraffic="false"`；WebView 通过自实现资源拦截器加载 `https://appassets.androidplatform.net/assets/`（secure context，Web Crypto 可用）。
- **签名密钥与密码不入仓库**：keystore 由 `.gitignore` 排除，构建密码必须通过环境变量 `ESA_KS_PASS` 提供，仓库中不含任何默认密码。
- **统一备份**：ETHAN 部分只拷贝密文行，不解密、不重新加密；备份包中我的空间 / 旅行足迹部分为明文 JSON + base64，请妥善保管备份文件。

## 技术栈

- **前端**：原生 HTML / CSS / JavaScript（零框架、零构建步骤、零第三方运行时依赖），IIFE + 命名空间（`ESA` / `MS` / `TB` / `TF` / `Ethan`）
- **存储**：IndexedDB（my-space / travel-footprint / ethan 三库隔离）+ localStorage（工具箱与偏好）
- **加密**：Web Crypto API（PBKDF2-SHA256 + AES-256-GCM）
- **Android**：原生 Java WebView 壳，零第三方依赖；手工构建链 `aapt2 → javac → d8 → dex 注入 → zipalign → apksigner`（不依赖 Gradle / Android Studio）
- **测试**：自研 Node 脚本，CDP 驱动真实浏览器（Edge headless）

## Android 构建方式

需要 JDK 17 与 Android SDK Build-Tools 34.0.0（含 aapt2 / d8 / zipalign / apksigner），路径可通过环境变量覆盖：

```bash
export ESA_JDK_HOME="JDK17 路径"
export ESA_SDK_HOME="SDK 路径"
export ESA_KS_PASS="你的keystore密码"   # 必填，无默认值；keystore 不存在时脚本会用该密码自动生成
bash scripts/build-apk.sh
# 产物：dist/ETHAN-SuperApp-v<VERSION_NAME>.apk
```

详见 `docs/BUILD.md`。签名密钥 `android/keystore/superapp.jks` 不在仓库中：首次构建会自动生成新密钥，升级安装请使用与已装版本相同的密钥，否则需先卸载旧版。

## 本地运行方式（H5）

```bash
node tools/serve.mjs 8923        # 或 tools/start-server.cmd
# 浏览器打开 http://127.0.0.1:8923/
# 注意：必须走 http，file:// 下 IndexedDB 被浏览器禁用
```

## 测试情况

以下数据来自真实运行（详见 `docs/TEST-REPORT.md`、`docs/FINAL-TECH-REPORT.md`、`docs/UNIFIED-DATA-BACKUP-REPORT.md`）：

| 类别 | 结果 |
| --- | --- |
| 外壳单元测试 | 25 / 25 通过 |
| 外壳 E2E（CDP 真实浏览器） | 47 / 47 通过 |
| 响应式（6 视口 × 3 页面） | 18 / 18 通过 |
| 模块回归 · 我的空间 | 151 / 151 通过 |
| 模块回归 · 工具箱 | 301 / 301 通过 |
| 模块回归 · 旅行足迹 | 279 / 279 通过 |
| 模块回归 · ETHAN | 73 / 73 通过 |
| 统一数据管理全链路 | 19 / 19 通过 |
| 网络审计 | 全程 0 外部请求，0 Console 错误 |

```bash
node tests/run-tests.mjs                 # 外壳单元测试
node tools/e2e.mjs 8923 9335             # E2E（自动拉起 Edge headless，需先起 serve）
node tools/responsive.mjs 8923           # 6 视口响应式
# 四个模块各自的测试（整合回归）：
(cd modules/my-space && node tests/run-tests.mjs)
(cd modules/toolbox && node tests/run-tests.mjs)
(cd modules/travel-footprint && node tests/run-tests.mjs)
(cd modules/ethan && node tests/unit.js)
```

## 当前版本

- **当前正式版本：v0.1.20**（versionCode 21），与 `scripts/build-apk.sh` 中的 `VERSION_NAME` 一致，构建产物为 `dist/ETHAN-SuperApp-v0.1.20.apk`。
- `dist/` 目录内含 v0.1.0 – v0.1.20 的历史 APK（均不入仓库）；v0.1.15 为上一验收版本（见 `docs/FINAL-TECH-REPORT.md`）。

## 已知限制

- Android **真机未实测**（开发机无设备 / 模拟器）；APK 已构建签名并通过静态验证（启动入口 / 权限清单 / assets 完整性 / 签名链），真机验证清单见 `docs/BUILD.md`。
- ETHAN 锁定态下首页无法显示条目数（架构上拿不到明文计数），显示「已加密保护」，解锁一次后显示「N 条信息」。
- 旧的三种模块私有备份格式（MS zip / TF zip / ETHAN 加密备份文本）不再支持导入：旧备份需先在旧版本中恢复进 App，再用统一数据管理导出。
- 设置中心「数据与备份」入口会打开对应模块的数据管理页完成导入导出（复用原实现，保证冲突处理逻辑不变）。
- iframe 内 `<input type=file>` 的相机拍照依赖自实现 CameraContentProvider，部分机型相机 App 行为可能存在差异。
- 测试脚本中的 PIN / 备份密码（如 `123456`）为自动化测试专用值，仅存在于本地临时测试环境，与任何真实凭据无关。

## 开源许可证

**本项目尚未指定开源许可证，需要项目作者选择后添加 LICENSE 文件。**
在许可证确定之前，默认版权保护适用于仓库内全部代码：未经作者许可，不得复制、修改或再分发。

## GitHub Release 说明

- **正式 APK 不提交到源码仓库**（`dist/` 与 `*.apk` 已被 `.gitignore` 排除），建议通过 **GitHub Releases** 发布：在 Release 页附加对应版本的 APK，并注明版本号与 SHA256 校验值。
- 源码仓库仅包含源代码、构建脚本、测试与文档。
