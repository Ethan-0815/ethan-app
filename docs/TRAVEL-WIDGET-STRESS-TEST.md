# 旅行足迹首页小组件 · 暴力测试与自动修复报告

日期：2026-09-28
测试对象：ETHAN Super App 首页「旅行足迹」小组件（ travel 统计卡片 + 迷你地图 + 最近旅程票据）及其数据链路
测试版本：v0.1.15（versionCode 16，未做任何代码修改的最终构建）

---

## 1. 【Travel Widget Architecture】（实测确认，非推测）

| 项 | 内容 |
|---|---|
| UI 文件 | `app/js/ui/home.js`（travel 统计卡 / `buildMapPreview` 迷你地图 / 最近旅程票据） |
| JS 文件 | `app/js/core/stats.js`（travelStats）、`app/js/ui/modules.js`（iframe 生命周期） |
| 数据来源 | **直接读取 travel-footprint 的 IndexedDB**（同源，`travelStats()` 打开 `travel-footprint` 库读 cities/trips），只读不写 |
| 数据结构 | cities{id,name,lat,lng,deletedAt…}、trips{id,cityId,fromCityId,startDate,endDate,note,deletedAt…} |
| 更新入口 | 旅行足迹模块内保存/删除（`repo.save` 写 IndexedDB） |
| 刷新入口 | 模块关闭/返回首页 → `closeModule()/popstate` → `home.refreshStats()` → `ESA.stats.all()` 重新读库 → `fillCards` 更新卡片 |
| 事件入口 | 卡片点击 → `ESA.app.openApp('travel-footprint')` |
| 生命周期 | 首页 section 常驻；模块 iframe 按需加载、`hideActive` 隐藏（单 frame 复用） |
| 与 Shell 通信 | 同源 IndexedDB 直读 + `postMessage`（主题/设置跳转）+ history pushState/popstate |

## 2. 测试环境

- Headless Edge（Chromium，CDP 直连真实页面，非 mock）
- 视口 412×901 @3.1x（OnePlus Ace 6 同比例）
- 数据隔离：测试前导出 travel-footprint 全部 stores 至临时文件，测试后**删除数据库并原样恢复**（实测恢复成功）

## 3. 测试基线（测试前）

Shell Unit 25/25 · Shell E2E 47/47 · Console 0 errors · External Network 0

## 4. 实际执行的操作量

| 类别 | 实际执行次数 |
|---|---|
| A 高频点击小组件 | **100** 次（无等待连点） |
| B 首页↔旅行足迹快速切换 | **100** cycles（每次 open+back） |
| C TF 内部 tab 循环（map→timeline→cities） | **50** cycles（=150 次 tab 切换） |
| D 主题切换 | **100** 次（dark/light 交替） |
| E 空数据检查 | 1 组（0 行程） |
| F 1城1行程 + 真实返回链路刷新 | 1 组 |
| G/H 日期 + 字符串边界 seed | 9 种日期 × 8 种字符串（含 XSS/超长/emoji），**8 城市 + 11 行程** |
| I 极端量 | **200 城市 + 100 行程** 批量写入（61ms），城市列表 211 卡渲染 1.4s |
| 随机状态机（seed 20260928） | **1000** actions（11 种动作） |
| 竞态专项 | 打开中返回 ×20（延迟 40–230ms 阶梯覆盖加载各阶段）+ 主题-加载竞态 ×20 |
| **总操作** | **约 1700+** |

## 5. 检测项与结果

每阶段健康检查（全量文本扫描 + travel 卡片断言）：

| 检查项 | 结果 |
|---|---|
| Console Error | **0**（全程） |
| 未捕获 Exception | **0**（全程） |
| undefined / NaN / [object Object] 文本 | **未出现** |
| travel 卡片 stat 格式（`N 个城市`） | **始终合法**（空数据=0 个城市；边界后=10 个城市） |
| XSS（`<img onerror>` / `<script>` 注入城市名与备注） | **未执行**（`__xss`/`__xss2` 均为 false，城市名以纯文本渲染） |
| 主题切换后 data-theme 同步 | 深色/浅色均与 Shell 一致 |
| 竞态（打开中返回 / 主题-加载竞态） | 无异常、无状态错乱 |
| 数据损坏 | 0（测试后原样恢复） |

## 6. 发现的 Bug

**0 个可复现 Bug。**

在本次测试覆盖范围内（约 1700+ 次操作、11 种随机动作、9 类边界日期、8 类边界字符串、200 城市极端量、40 次竞态）**未发现可复现 Bug**。过程中出现的两次脚本侧异常均为测试脚本自身的上下文问题（模块按需加载关闭后 `is-active` frame 为 null），非产品缺陷，已在测试脚本内修正。

需要说明的行为（非 Bug）：
- 通过模块 API 直接写库（绕过 UI）后，首页卡片**不会**立即刷新——这是设计使然：真实 UI 保存路径会经 `flows.after()` → `router.refreshAll()` → `home.refreshStats()` 即时刷新（已由 v0.1.13 的完整 UI 流验证）。

## 7. 性能记录

| 项 | 实测 |
|---|---|
| 200 城市 + 100 行程批量写入 | **61ms** |
| 211 张城市卡列表（含渲染） | **约 1.4s**（一次性 mount，含 200+ DOM 节点，可接受） |
| 首页 travel 卡片刷新 | 毫秒级（IndexedDB getAll 直读） |
| memory / 帧率 | 未测量（环境不支持 headless 帧率采样） |

## 8. 修改文件

**无**（产品代码零修改）。测试脚本归档于 `tools/stress-a.js`、`tools/stress-a2.js`、`tools/stress-b.js`（可重复执行，脚本内含备份/恢复）。

## 9. 最终状态

- 数据：测试数据已全部清理，真实数据原样恢复（恢复后首页 stat 回到测试前状态）
- Console：0 errors
- 回归：Shell Unit 25/25 · Shell E2E 47/47（暴力测试后复跑）

## 10. 结论

在本次测试覆盖范围内**未发现可复现 Bug**——不排除未覆盖路径存在问题的可能。旅行足迹首页小组件在正常、边界、极端与随机压力条件下表现稳定。
