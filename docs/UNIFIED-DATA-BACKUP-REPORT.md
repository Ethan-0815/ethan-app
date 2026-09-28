# ETHAN Super App · 统一数据备份 / 恢复系统重构报告

日期：2026-09-28
版本：v0.1.18（versionCode 19）

---

## 1. 旧导入 / 导出架构

| 模块 | 旧入口 | 旧格式 |
|---|---|---|
| 我的空间 | 设置 → 数据管理 → 导出/导入数据 | 私有 zip（MS.backup + zip.js 打包，含图片 blob） |
| 旅行足迹 | 首页工具区 / 城市页菜单 → 导出/导入备份 | 私有 zip（TF.core 打包，含照片附件） |
| ETHAN | 设置 → 创建加密备份 / 恢复备份 | 单文件加密 JSON（备份密码 + AES-GCM） |

三个模块各自独立，格式互不兼容，用户需要分别操作三套入口。

## 2. 发现的问题与根因

1. 三套入口、三种格式：用户必须分别导出/导入三个文件，且容易遗漏。
2. 备份文件无法互相识别，没有统一的 manifest。
3. ETHAN 备份入口在模块设置深处，可发现性差。
4. 旧 TF/MS zip 打包逻辑各自维护一份相似代码。

## 3. 新统一备份架构

- Shell 层新增 `app/js/ui/datamgr.js`（`ESA.dataMgr`）：
  - 同源直读三个模块的 IndexedDB（与 stats.js 相同的只读模式）
  - 导出：逐模块收集 → 构建统一包 → round-trip 校验 → 经 Android 桥分块保存（或浏览器下载）
  - 导入：文件选择 → 格式/版本/完整性校验 → 动态预览 → 合并/替换 → 分模块写回 → 模块 iframe 重载 + 首页卡片刷新
- 统一设置 → 通用 → **数据管理**（全局唯一入口，置于通用 tab 顶部）

## 4. 数据包格式（.ethan 单文件）

```json
{
  "format": "ethan-superapp-backup",
  "version": 1,
  "createdAt": "ISO 时间",
  "modules": {
    "mySpace": {
      "stores": { "items": [...], "categories": [...], "tags": [...], "images": [...], "meta": [...] },
      "keys":   { "meta": ["kdf 类键"] },
      "blobs":  [ { "key": "img-1", "dataB64": "...", "mime": "image/png", "thumbB64": "..." } ]
    },
    "travelFootprint": { "stores": {...}, "keys": {...}, "blobs": [...] },
    "ethan": { "encrypted": true, "stores": { "meta": [...], "vault": [...] }, "keys": {...}, "blobs": [] }
  }
}
```

## 5. 三个模块数据范围

- **我的空间**：物品（含回收站/软删除）、分类、标签、图片引用（images）、meta、**图片/缩略图二进制（blobs，Blob → base64）**
- **旅行足迹**：城市、旅行（含出发地 fromCityId、起止日期、备注）、照片引用、附件引用、meta、**照片/附件二进制（blobs，Uint8Array → base64）**
- **ETHAN**：meta（KDF 盐/校验器）+ vault（AES-GCM 密文整体）——**全部为密文/派生参数，无任何明文机密**

## 6. ETHAN 加密方案（保持不变）

- vault 为整包 AES-GCM 密文（随机 IV），meta 为 PBKDF2-SHA256 派生参数
- 统一备份**只拷贝密文行**，不解密、不重新加密、不降低任何安全等级
- 恢复后用户 PIN 保持不变（KDF 参数一并恢复），解锁即读

## 7. 键模式处理（实现要点）

| 模块 | store 键模式 | 处理 |
|---|---|---|
| my-space items/categories/tags/images | 行内键 id | put(row) |
| my-space meta | 行内键 key | put(row) |
| my-space blobs | **显式键** | put(row, key) |
| TF cities/trips/photos/attachments | 行内键 id | put(row) |
| TF meta | 行内键 key | put(row) |
| TF blobs | **显式键** | put(row, key) |
| ethan meta/vault | **显式键** | put(row, key)（键随备份保存于 keys 数组） |

显式键 store 的导出同时保存 `getAllKeys()` 结果（keys 数组），导入时按位配对。

## 8. 导入策略

1. 文件读取 → JSON 解析 → format/version/modules 完整性校验（损坏文件给出明确错误，不触碰数据）
2. 动态预览（行数/图片数/加密标记/备份时间，全部由实际包生成）
3. 检测已有数据 → 选择「合并导入 / 完整替换 / 取消」
4. 写入顺序固定：我的空间 → 旅行足迹 → ETHAN
5. 写入失败即中止并提示，已写入部分不受破坏（各 store 独立事务）

## 9. 合并 / 替换策略

- **合并**：逐行按主键 `get()` 检查，**已存在则跳过**（保留现有数据），只补充新增——绝不 push 重复
- **完整替换**：二次 `confirm` 确认后，clear 各 store 再写入
- 出发地=到达地的行程在保存时已自动置空（上游逻辑），导入不会产生无效航线

## 10. 图片 / 附件处理

- my-space blobs：行内 `data`/`thumb` 为 Blob → FileReader 转 base64 入包；导入反向还原为 Blob
- TF blobs：行内 `bytes` 为 Uint8Array → btoa 分块转 base64 入包；导入还原为 Uint8Array（与模块读回格式一致）
- **实测**：导出 → 清库 → 导入后，`data instanceof Blob === true`、`bytes.length > 0`，图片可正常显示

## 11. 旧入口删除情况（已全部验证）

| 旧入口 | 状态 |
|---|---|
| 我的空间 设置 → 导入数据 / 导出数据 | **已删除**（doImport/doExport 函数与设置行一并移除；回收站/清空保留） |
| 旅行足迹 首页工具区 → 导出/导入备份 | **已删除** |
| 旅行足迹 城市页菜单 → 导出备份 | **已删除** |
| 旅行足迹 设置 → 备份分组 | **已删除**（回收站保留） |
| ETHAN 设置 → 创建加密备份 / 恢复备份 | **已删除**（数据分组整块移除，backup.js UI 文件删除） |
| flows.exportBackup / importBackup / importFromBytes / showImportPreview / runImport（TF） | **已删除**（约 360 行；kindLabel 因回收站使用而保留） |

全项目残留扫描：`exportBackup|importBackup` 在 UI 层 0 处。

## 12. 测试结果（CDP 实测，非理论）

统一数据管理全链路 **19/19 PASS**：

- 导出 10 项（格式/三模块/图片进包/ETHAN 密文/无明文安全扫描）
- 错误文件 2 项（JSON 损坏、format 不符 → 明确报错不触碰数据）
- 完整替换导入 6 项（MS 物品与图片 Blob、TF 行程与图片、ETHAN vault+meta）
- 合并导入 1 项（重复导入不翻倍）

## 13. 已知限制

1. 旧的三种私有格式（MS zip / TF zip / ETHAN 加密备份文本）**不再支持导入**——旧备份文件需先在旧版本中恢复进 App，再用 v0.1.18 统一导出。（原因：三格式各自加密/打包方式差异大，统一解析的复杂度与风险远超收益；且本应用无云端历史，旧文件只存在于用户手中）
2. ETHAN 部分在统一备份中以密文存在，**无法跨 PIN 恢复后查看**——恢复用的是同一设备的密文，PIN 不变即可解锁；跨设备恢复需使用相同 PIN 创建（KDF 参数随包恢复，实际同 PIN 即可解）
3. 备份文件为明文 JSON + base64（ETHAN 部分除外），建议用户妥善保管
4. Android 真机的文件选择/保存依赖此前已验证的桥接（onShowFileChooser / beginSave 分块），本次未重连真机复测

## 14. 回归测试

- Shell Unit **25/25** · Shell E2E **47/47** · Console 0 errors · External Network 0
- 首页/返回/主题/Bottom Bar/iframe 全部正常

## 15. 最终入口位置

统一设置（⚙）→ 通用 tab → **数据管理**（置于通用 tab 顶部第一位）
