# ETHAN Super App — 第 1 步：四个现有项目审查报告

> 审查日期：2026-09-24 · 只读审查，未修改任何原始项目
> 原始项目位置：`D:\workbuddy\{my-space, toolbox, travel-footprint, passwork\ethan}`
> 整合副本位置：`ethan-super-app/modules/*`（副本上做最小补丁，原始项目保持不动）

## 一、总览对比

| 维度 | 我的空间 | 工具箱 | 旅行足迹 | ETHAN |
|---|---|---|---|---|
| JS 命名空间 | `MS` | `TB` | `TF` | `Ethan` |
| 脚本形态 | IIFE + 全局命名空间，零构建 | 同左 | 同左 | 同左（UMD 兼容 Node） |
| 持久化 | IndexedDB `my-space` v1（items/categories/tags/images/blobs/meta） | localStorage `toolbox.recent.v1`、`toolbox.prefs.v1` | IndexedDB `travel-footprint` v2（cities/trips/photos/attachments/blobs/meta） | IndexedDB `ethan` v1（meta 密文参数 + vault 整体密文） |
| Bottom Bar | 4 tab：首页/物品/搜索/**设置** | **无**（打开即用） | 4 tab：首页/地图/时间线/城市（无设置，设置在首页工具按钮） | 3 tab：首页/机密/**设置** + FAB |
| 主题 | 浅/深/跟随系统（`my-space-prefs.v1`） | **仅浅色**（无 data-theme） | 浅/深/跟随系统（`tf-theme`） | 自动/浅/深（`ethan.ui`） |
| 路由 | 自研页面栈 + history 同步 | 页面栈 + history | tab 栈 + push 栈 | SPA 视图切换（无 history 路由） |
| Android 包名 | com.myspace.app | com.toolbox.app | com.travefootprint.app（拼写缺 l） | cn.ethan.app |
| WebView 加载 | WebViewAssetLoader（https://appassets.androidplatform.net） | 同左 | 同左 | 自实现资源拦截器同域 |
| 原生桥 | `MySpaceNative`（分段文件读写） | `ToolboxNative`（分段文件读写） | `TravelFootprintNative`（分段+安全区注入） | **无桥**，evaluateJavascript 单向注入 |
| 测试 | 单测 151 断言 + e2e 106 断言 | 单测 301 断言 + e2e 164 断言 | 单测 279 断言（实跑全过）+ e2e 164 断言 | 单测 73 + e2e 115 + 安全 37（全过） |

## 二、关键结论（决定整合方案）

1. **四个命名空间（MS/TB/TF/Ethan）互不冲突**，四个 IndexedDB 库名与 localStorage key 也互不冲突——数据隔离天然成立，超级 App 不合并任何数据库。
2. **CSS 不能同文档共存**：三个项目都有 `:root` 级通用变量（`--bg/--text/--accent`）与无前缀通用类名（`.card/.btn/.input/.field/.section`），还有全局 reset。→ **采用同源 iframe 模块隔离**：每个子 App 保持自己的 document、CSS、路由、history，零样式冲突、零 JS 冲突、路由/返回逻辑 100% 保留。
3. **同源 iframe 内可见 Android 原生桥**：`addJavascriptInterface` 注入的对象在 WebView 所有 frame 可见。→ 统一 Android 壳只要用同一个桥实例**同时以 `MySpaceNative`/`ToolboxNative`/`TravelFootprintNative` 三个名字注入**，三个模块的文件导入导出/拍照/振动原生能力零改动可用。
4. **主题统一**：shell 拥有唯一主题状态（`esa.prefs.v1`），切换时 ① 写各模块期望的存储 key（`my-space-prefs.v1.theme`、`tf-theme`、`ethan.ui.theme`）② postMessage 通知已开模块实时切换。工具箱原本只有浅色 → 给副本补一套基于其现有 token 的深色变量。
5. **ETHAN 锁定态拿不到条目数**（审计确认 meta store 只有密文参数）→ 给副本加一个非敏感计数写入：解锁/持久化时把「条目总数」写入 localStorage `ethan.stats.v1`（只有数字与时间，无任何标题/字段值，不触碰加密架构）。首页卡片显示「N 条信息 · 全部已加密保存」；从未解锁过则显示「已加密保护」。
6. **首页统计数据读取路径**（shell 同源直读，只读不写）：
   - 我的空间：IndexedDB `my-space` → items（live 计数 + 最近物品名）
   - 工具箱：shell 直接加载 `modules/toolbox` 的 `core/util.js + core/registry.js`（TB 命名空间，与 shell 无冲突）→ `TB.registry.count()` = 13 + localStorage 最近使用
   - 旅行足迹：IndexedDB `travel-footprint` → cities/trips（live 城市计数 + 最近旅程城市）
   - ETHAN：`ethan.stats.v1`
7. **随机回忆安全过滤**：只从我空间 items（备注/位置）与旅行足迹 trips（城市+备注）抽取；**永远不触碰 ETHAN vault**（锁定态本就无明文，且安全策略上直接排除）。
8. **返回逻辑**：Android 返回键 → 壳 evaluateJavascript 调 shell 顶帧 `ESA.back()` → 有模块打开则 postMessage 转发进 iframe，由各模块原有返回处理器消费；模块在根页时回「exit」→ 壳关闭模块回首页；首页根态二次返回退出。
9. **各模块需要的最小补丁**（只动副本，不动原始项目）：
   - my-space：删 Bottom Bar「设置」tab；settings 页删外观区（主题归统一设置）；支持 `?page=settings` 深链；挂 esa-bridge。
   - toolbox：补深色 token；挂 esa-bridge（无需其它改动，本来就无设置无 Bottom Bar）。
   - travel-footprint：首页「设置」按钮改为请求 shell 打开统一设置；settings sheet 删外观三选；支持 `?flow=settings` 深链；挂 esa-bridge。
   - ethan：删 tabbar「设置」tab；settings 视图删外观三选；支持 `?view=settings` 深链（解锁后直达）；persist 时写非敏感计数；挂 esa-bridge。

## 三、潜在冲突与规避（已纳入方案）

| 冲突点 | 规避 |
|---|---|
| CSS 变量/类名全局污染 | iframe 隔离，永不同文档 |
| `MS/TB/TF/Ethan` 短命名空间 | 各自独立 iframe 文档，天然隔离；shell 自用 `ESA` |
| history/返回栈争抢 | iframe 各自独立 session history；Android 返回键由壳统一转发；H5 侧浏览器返回由各模块 popstate 自然处理 |
| 模块启动耗时 | 首页**不加载**任何模块（只直读统计），点击卡片才建 iframe，首次后缓存复用 |
| 大数据/图片解密 | 我的空间/旅行足迹首页只 cursor 计数不取 blob；ETHAN 首页只读非敏感计数 |
| toolbox `unhandledrejection` 全局接管 / TF `UI.nav` 身份替换等 | 均在各 iframe 内部，不影响 shell |

## 四、复核过的功能清单（整合后必须逐项回归）

- 我的空间：创建/编辑/删除/回收站/恢复/分类/自定义分类/多图片/搜索/最近查看/导入/导出
- 工具箱：13 个工具全部保留（图片压缩、图片格式转换、图片转 PDF、计算器、折扣、百分比、单位换算、文件大小换算、随机数/随机选择、JSON 格式化、进制转换、UUID、时间戳转换）
- 旅行足迹：城市/旅行记录/时间线/地图概览（含九段线合规）/照片/附件/统计/搜索/回收站/导入/导出
- ETHAN：账号密码/密钥 Token/文本/其他/搜索/创建/编辑/删除/回收站/密码生成/复制/敏感字段隐藏/6 位 PIN/自动锁定/立即锁定/PBKDF2+AES-GCM 加密存储/加密备份/恢复
