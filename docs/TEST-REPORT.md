# ETHAN Super App · 测试报告

> 生成时间：2026-09-24 · 全部数据来自真实运行，无虚构

## 汇总

| 类别 | 结果 | 说明 |
|---|---|---|
| Shell 单元测试 | **25 / 25 通过** | `node tests/run-tests.mjs`（工具函数 / 偏好引擎 / 最近使用合并 / 随机回忆空态 / ETHAN 非敏感统计） |
| Shell E2E 冒烟 | **44 / 44 通过** | `node tools/e2e.mjs`（CDP 驱动真实 Edge headless） |
| 响应式 | **18 / 18 通过** | 320 / 375 / 390 / 430 / 768 / 1280 ×（首页 / 设置 / 工具箱模块）无横向溢出 |
| 网络审计（E2E 内） | **0 个外部请求** | 全程收集 requestWillBeSent，非 127.0.0.1 域名数量 = 0 |
| 静态网络扫描（外壳） | **0 处网络原语** | `fetch( / XMLHttpRequest / WebSocket / sendBeacon / serviceWorker` 在 app/ 中出现 0 次；无外部 URL |
| Console 错误（E2E 内） | **0** | console.error 与未捕获异常计数 = 0 |
| 模块回归 · 我的空间 | **151 / 151 通过** | 整合副本运行 `tests/run-tests.mjs` |
| 模块回归 · 工具箱 | **301 / 301 通过** | 整合副本运行 `tests/run-tests.mjs` |
| 模块回归 · 旅行足迹 | **279 / 279 通过** | 整合副本运行 `tests/run-tests.mjs` |
| 模块回归 · ETHAN | **73 / 73 通过** | 整合副本运行 `tests/unit.js`（含加密 / PIN / 备份恢复） |
| Android 构建 | **通过** | aapt2 → javac → d8 → zipalign → apksigner（v1+v2+v3），详见下节 |
| Android 真机 | **未测试** | 本机无设备/模拟器，如实说明；未执行任何真机测试，不虚构结果 |
| ETHAN 安全专项 | **由模块自身保障** | 加密架构未改动（仅新增非敏感计数写入）；模块 73 项单测覆盖加密/备份/迁移 |

## E2E 覆盖明细（44 项）

- **首页结构**：品牌 ETHAN、右上角唯一齿轮、2×2 四卡片、无 Bottom Bar、时间=真实系统时间（与本地时钟逐分比对）、日期格式 THURSDAY · SEP 24
- **动态数据**：工具箱卡片=真实工具数 13、我的空间卡片=真实物品数（当前 0）、ETHAN 卡片=非敏感状态「已加密保护」
- **设置中心**：齿轮打开、Bottom Bar 四入口（通用/我的空间/旅行足迹/ETHAN）、外观三选一、界面三开关、深色切换即时生效、偏好持久化（esa.theme）、设置内页签切换不退出
- **模块接入**：工具箱 iframe 就绪、工具箱无 Bottom Bar、13 工具全在、模块内进入计算器页、模块内返回 stay、模块根返回关闭模块回首页
- **主题同步**：统一深色同步进模块（toolbox data-theme=dark）
- **my-space / travel-footprint / ethan**：iframe 就绪、我的空间 Bottom Bar 3 tab 无设置、`?page=settings` 深链、我的空间设置无外观项、旅行足迹 Bottom Bar 4 tab、ETHAN 锁定屏完好、ETHAN 底部导航无设置、锁定屏返回交外壳
- **收尾**：0 外部请求、0 Console 错误

## Android 构建验证

```
package: name='cn.ethan.superapp' versionCode='1' versionName='0.1.0'
application-label:'ETHAN'
launchable-activity: cn.ethan.superapp.MainActivity   ✓ 存在
权限: VIBRATE + WRITE/READ_EXTERNAL_STORAGE(maxSdk 28)  ✓ 无 INTERNET
签名: apksigner verify 通过（v1+v2+v3）
assets: 含 assets/index.html 与四个模块的 assets/modules/*/app/index.html  ✓
大小  : 2020 KB
SHA256: 19a4e1380176dc2fc8be366365b290ae4d3e6b16ec4ac5de6d3ea0dcaf7c29e3
```

## UI 对照（docs/shots/）

- home-light.png / home-dark.png —— 对照首页设计图：品牌、艺术化大时间（时分明度分级）、2×2 玻璃卡片（图标芯片+角标圆点+真实数据）、最近使用、随机回忆（↻ 按钮）、无 Bottom Bar ✓
- settings-light.png / settings-dark.png —— 对照设置设计图：返回+居中标题、外观三选一（选中绿环）、界面三开关（绿色）、数据与备份分组、悬浮胶囊 Bottom Bar ✓

## 已知未验证项

1. Android 真机（无设备）——安装后请按 docs/BUILD.md 的真机验证清单核对。
2. 各模块 tools/ 下原有的 CDP e2e 属于原项目回归（原始项目已通过），本次整合验证以模块单元测试 + 超级 App E2E 为准。
