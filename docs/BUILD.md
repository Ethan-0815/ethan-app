# ETHAN Super App · Android 构建说明

## 环境要求

本机已配置便携工具链 `D:/android-toolchain/`（JDK 17 + SDK 34 + Build-Tools 34.0.0）。
构建脚本默认使用该路径，可通过环境变量覆盖：

```bash
export ESA_JDK_HOME="D:/android-toolchain/jdk/jdk-17.0.13+11"
export ESA_SDK_HOME="D:/android-toolchain/sdk"
export ESA_KS_PASS="你的keystore密码"     # 必填，无默认值（签名密码不写入仓库）
```

## 一键构建

```bash
bash scripts/build-apk.sh
```

流程（零 Gradle / 零 Android Studio / 零第三方依赖）：

1. 合并 assets：`app/`（外壳）+ `modules/*/`（四个子 App）→ `android/build/assets/`
2. `aapt2 compile + link`（`--java` 生成 R.java）
3. `javac 11` 编译 Java 壳（MainActivity / NativeBridge / FileSaver / CameraContentProvider）
4. `d8` 转 dex → 注入 APK（重建干净 zip，避免 header mismatch）
5. `zipalign -p 4`
6. `apksigner`（v1+v2+v3 签名；keystore 不存在时自动生成 `android/keystore/superapp.jks`）
7. 静态验证：启动入口 / 权限清单（**出现 INTERNET 即失败**）/ assets 完整性 / 签名链

产物：`dist/ETHAN-SuperApp-v0.1.0.apk`

## 关键设计

- **资源拦截**：自实现 `https://appassets.androidplatform.net/assets/` → assets/（secure context，IndexedDB 与 Web Crypto 可用，ETHAN 加密体系依赖它）
- **零 INTERNET 权限**：整个超级 App 在系统层面物理离线
- **四名桥注入**：`ESANative` / `MySpaceNative` / `ToolboxNative` / `TravelFootprintNative` 指向同一桥实例，四个子模块的文件分段导出导入、振动等原生能力零改动可用
- **返回键**：`OnBackPressed → window.ESA_back()`，返回 `'exit'` 才 `finish()`
- **生命周期**：onPause/onResume 遍历主文档与 iframe，协同 ETHAN 自动锁定策略
- **相机**：零依赖自实现 `CameraContentProvider`（content:// 输出，取代 androidx FileProvider）

## 签名密钥

`android/keystore/superapp.jks`（storepass/keypass 见环境变量，alias `superapp`）。
**请妥善保留 keystore**：升级同一应用必须使用同一密钥，否则需先卸载旧版。

## 真机安装

1. 传输 APK 到手机安装（需允许未知来源）。
2. 首次启动进入 ETHAN 超级 App 首页；各模块数据保存在应用私有目录。
3. 崩溃排查：应用专属外部目录下的 `crash.txt`。

## 真机验证清单（本机无设备，未执行）

- [ ] 首页秒开、四卡片可点、返回键从模块回首页、首页二次返回退出
- [ ] 我的空间：拍照 / 相册选图 / 导出 zip 到 下载/ETHAN/ / 导入恢复
- [ ] 工具箱：图片压缩 / 图片转 PDF / 文件保存
- [ ] 旅行足迹：照片/附件选择 / 导出导入
- [ ] ETHAN：PIN 设置 / 解锁 / 自动锁定（切后台） / 加密备份导出与恢复
- [ ] 深浅色跟随系统切换不重建 WebView
