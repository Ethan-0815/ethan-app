# ETHAN Super App · GitHub 发布安全审计报告

审计日期：2026-09-28 · 审计方式：只读扫描 + 仅在 GitHub 副本内做最小安全清理

---

## 1. 原项目路径

```
D:\workbuddy\all\ethan-super-app\
```

正式开发项目，本次任务全程**只读**，未执行任何 git 操作，未修改、删除、移动任何文件。

## 2. GitHub 副本路径

```
D:\workbuddy\github\ethan-super-app\
```

独立的发布副本，所有清理、审计、README、.gitignore、Git 操作仅发生在此目录。

## 3. 两者隔离确认

| 项目 | 结果 |
| --- | --- |
| 复制方式 | robocopy 完整复制（636 文件 / 138 目录 / 86 MB，0 失败） |
| 复制后副本文件数 | 636（与原项目一致） |
| 原项目 Git 状态 | 未执行 `git init / add / commit / remote / push`，原项目无 `.git` 目录，保持完全不变 |
| Git 操作范围 | `git init` 仅在 `D:\workbuddy\github\ethan-super-app\` 内执行 |
| 后续所有写入 | 仅发生在副本：`scripts/build-apk.sh`、`docs/BUILD.md`、`README.md`、`.gitignore`、本报告 |

## 4. 安全扫描结果

对副本全文关键词扫描（排除二进制与第三方库目录）：

| 扫描项 | 结果 |
| --- | --- |
| 私钥块（`BEGIN ... PRIVATE KEY`） | **0 处** |
| 数据库 / 消息队列连接串（jdbc / mongodb / mysql / postgres / redis / amqp） | **0 处** |
| Firebase 配置 / Google API Key（`AIza...`） | **0 处** |
| `Bearer` / `Authorization:` / `Set-Cookie` | **0 处** |
| 第三方服务密钥 | **0 处** |
| `.env` / `local.properties` 文件 | **不存在** |
| `password` / `secret` / `token` 关键词命中 | 33 个文件，经逐一核查均为功能代码与测试记录（详见第 5 节） |
| 真实个人数据 / 真实 ETHAN 密码库 / 真实备份文件 | **未发现**（截图与测试 JSON 均为空库 / 示例数据） |
| IndexedDB 导出数据 | **不存在** |

### 发现并已处理的问题

| 级别 | 问题 | 处理（仅限副本） |
| --- | --- | --- |
| P0 | `android/keystore/superapp.jks`（APK 签名密钥）存在于副本 | `.gitignore` 排除，文件保留在本地副本，不入仓库 |
| P1 | `scripts/build-apk.sh` 硬编码 keystore 默认密码 `ethan2026` | 改为强制环境变量：`KS_PASS="${ESA_KS_PASS:?...}"`，仓库中无任何默认密码 |
| P1 | `docs/BUILD.md` 注释中写出默认密码 `ethan2026` | 已删除该注释，改为「必填，无默认值」 |

处理后复核：`ethan2026` 在副本源码 / 文档中 **0 残留**。

## 5. 敏感文件检查结果

| 文件 | 判定 | 说明 |
| --- | --- | --- |
| `android/keystore/superapp.jks` | **敏感，不入仓库** | APK 签名密钥，`.gitignore` 双重排除（目录级 + `*.jks`） |
| `modules/ethan/tests/e2e.mjs` 第 23–25 行 | 可保留 | 测试专用凭据（`PIN='123456'` / `NEW_PIN='654321'` / `BACKUP_PWD='backup-pass-2026'`），仅用于本地自动化测试临时环境，非真实凭据，属行业惯例 |
| `modules/ethan/tests/security.mjs` / `unit.js` | 可保留 | 同上，测试 PIN（`135790` / `123456` / `654321`） |
| `modules/ethan/tests/*-results.json`、`net-scan-results.json` | 可保留 | 测试通过记录，无真实数据；`net-scan-results.json` 为 0 findings |
| `docs/shots/`（42 张截图）、`modules/ethan/tests/screenshots/`（16 张） | 可保留 | 抽查确认：空库状态 / 示例数据（`ethan@example.com`），无真实数据 |
| `docs/AUDIT.md`、`docs/FINAL-TECH-REPORT.md` | 可保留（低风险） | 含作者本机路径 `D:\workbuddy\...`，不含凭据；如介意可后续编辑 |
| `docs/TEST-REPORT.md` 中的 APK SHA256 | 可保留 | 公开哈希值，无风险 |
| `android/java/.../MainActivity.java` 的 `pendingPickToken` | 可保留 | 文件选择器会话 ID，非凭据 |
| `scripts/build-apk.sh` 中 `D:/android-toolchain/...` 默认工具链路径 | 可保留（低风险） | 本机路径约定，可被环境变量覆盖 |

## 6. .gitignore 内容摘要

新增 `.gitignore`（仓库根），要点：

- 依赖/第三方库：`node_modules/`、`tools/_pylibs/`（15 MB Pillow 库）
- 构建产物：`dist/`、`android/build/`、`*.apk`、`*.aab`、`*.idsig`
- 签名与密钥：`android/keystore/`、`*.jks`、`*.keystore`、`*.pem`、`*.key`、`*.p12`、`*.pfx`
- 环境与本地配置：`.env`、`.env.*`、`local.properties`
- 日志/临时/缓存：`*.log`、`.cache/`、`.tmp/`、`tmp/`、`coverage/`
- Python 缓存：`__pycache__/`、`*.pyc`
- IDE / 系统：`.idea/`、`.vscode/`、`.DS_Store`、`Thumbs.db`

验证：`git check-ignore` 确认 keystore、APK、build 产物、_pylibs、日志均被正确拦截。

## 7. README 创建结果

已重写 `README.md`（仅副本），包含 14 项要求：项目简介 / 核心功能 / 项目结构 / 四个核心模块 / 离线设计 / 隐私与安全设计 / 技术栈 / Android 构建方式 / 本地运行方式 / 测试情况 / 当前版本 / 已知限制 / 开源许可证 / GitHub Release 说明。

- 未宣传不存在的功能；未夸大安全性。
- 加密描述采用准确技术表述：6 位 PIN → PBKDF2-SHA256（随机盐）派生密钥 → AES-256-GCM 整体加密 vault → IndexedDB；忘记 PIN 无法恢复。
- 明确说明「正式 APK 通过 GitHub Releases 发布，不入源码仓库」。

## 8. LICENSE 状态

**项目尚未指定开源许可证，需要项目作者选择。**
按指令未擅自添加 LICENSE 文件。README「开源许可证」章节已如实注明：许可证确定前默认版权保护适用。

## 9. Git 初始化结果

```
git init               # 仅在 D:\workbuddy\github\ethan-super-app\ 执行
默认分支                 # master → 重命名为 main（GitHub 惯例）
仓库本地身份            # user.name=Ethan, user.email=ethan@users.noreply.github.com
                       # （仅此仓库生效，未改全局配置；连接 GitHub 后可自行修改）
```

## 10. Git status 结果

- `git add .` 前 status：仅未跟踪的源码/文档目录（.gitignore / README.md / android/ / app/ / docs/ / modules/ / scripts/ / tests/ / tools/）。
- `git add .` 后：**258 个文件进入暂存区**。
- 敏感模式核查（`.jks|.keystore|.apk|.aab|.idsig|.pem|.key|keystore/|android/build/|dist/|_pylibs|.log|.env|local.properties|.pyc`）：**0 命中**。
- 工作区状态：commit 后干净（0 未跟踪 / 0 未提交）。

## 11. 首次 Commit 结果

```
commit 6ff8716
message: Initial release: ETHAN Super App v0.1.15
文件数:  258
分支:    main
remote:  无（未创建，未 push，未连接 GitHub）
```

提交前逐项确认：无密码 ✓ 无 Token ✓ 无私钥 ✓ 无 keystore ✓ 无真实个人数据 ✓ 无真实 ETHAN 密码库 ✓ 无真实备份 ✓ 无不应公开的本地配置 ✓

## 12. 被排除的文件（不入仓库，保留在副本本地）

| 排除项 | 数量/体积 | 说明 |
| --- | --- | --- |
| `dist/`（v0.1.0–v0.1.20 APK + .idsig） | 41 个文件 / 43 MB | 历史版本 APK，正式包走 GitHub Releases |
| `android/build/` | 构建中间产物 | 每次构建自动重建 |
| `android/keystore/superapp.jks` | 1 个文件 | **签名密钥，请作者务必自行备份保管** |
| `tools/_pylibs/`（Pillow） | 15 MB | 第三方 Python 库 |
| `docs/dm-test-run.log`、`docs/dm-test-run2.log` | 2 个文件 | 测试运行日志 |

## 13. 建议通过 GitHub Releases 发布的文件

- `dist/ETHAN-SuperApp-v0.1.20.apk`（本次正式发布版本，与 `scripts/build-apk.sh` 的 `VERSION_NAME=0.1.20` 一致）
- 历史版本 APK（v0.1.0 – v0.1.15 等）保留在 `dist/` 本地，按需自行发布
- 建议 Release 附注中给出 APK 的 SHA256 校验值（构建脚本运行结束会自动打印）。

## 14. 仍需要人工确认的项目

1. **开源许可证**：未指定，需作者选择（MIT / Apache-2.0 / GPL-3.0 等）后添加 LICENSE 文件。
2. **版本号差异 — 已确认（2026-09-28）**：正式发布版本统一为 **v0.1.20**（versionCode 21），README 与本报告发布建议已同步更新；`docs/FINAL-TECH-REPORT.md`、`docs/TRAVEL-WIDGET-STRESS-TEST.md` 中的 v0.1.15 为历史验收/测试记录，保留不改；Git 历史 commit message 不重写。
3. **提交身份**：仓库本地身份为 `Ethan <ethan@users.noreply.github.com>` 占位邮箱，连接 GitHub 前可按需修改（`git commit --amend --reset-author` 或更新 config）。
4. **keystore 备份**：`android/keystore/superapp.jks` 不入仓库（正确做法），请确认已在仓库之外妥善备份；丢失将无法为同一应用签名升级。
5. **docs 报告中的本机路径**：`docs/AUDIT.md`、`docs/FINAL-TECH-REPORT.md` 含 `D:\workbuddy\...` 本地路径（无凭据），如介意可编辑后重新提交。
6. **测试凭据**：`modules/ethan/tests/` 中的测试 PIN/备份密码为自动化测试专用值，已确认为非真实凭据，如仍介意可后续替换。
7. **GitHub 仓库地址**：由作者后续手动提供，届时再添加 remote 与 push（本次未执行）。

---

**审计结论：副本通过发布前安全审计。Git 操作全部只发生在 GitHub 副本中，未执行 git push，未创建 remote。**
