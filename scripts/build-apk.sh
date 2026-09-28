#!/usr/bin/env bash
# ETHAN Super App — 手工构建 Android APK（不依赖 Gradle / Android Studio）
#
#   aapt2 → javac → d8 → dex 注入 → zipalign → apksigner
# 零第三方依赖；assets = app/ + modules/（单一真源，构建时合并）。
#
# 用法（Git Bash）：
#   bash scripts/build-apk.sh
# 环境变量：ESA_JDK_HOME / ESA_SDK_HOME / ESA_KS_PASS
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

JDK="${ESA_JDK_HOME:-D:/android-toolchain/jdk/jdk-17.0.13+11}"
SDK="${ESA_SDK_HOME:-D:/android-toolchain/sdk}"
BT="$SDK/build-tools/34.0.0"
PLATFORM_JAR="$SDK/platforms/android-34/android.jar"

AAPT2="$BT/aapt2.exe"
ZIPALIGN="$BT/zipalign.exe"
APKSIGNER="$BT/apksigner.bat"
D8="$BT/d8.bat"
JAVAC="$JDK/bin/javac.exe"
KEYTOOL="$JDK/bin/keytool.exe"

KS="android/keystore/superapp.jks"
KS_PASS="${ESA_KS_PASS:?请先 export ESA_KS_PASS=你的keystore密码（密码不写入仓库）}"
KS_ALIAS="superapp"

VERSION_NAME="0.1.20"
VERSION_CODE="21"
OUT="dist/ETHAN-SuperApp-v$VERSION_NAME.apk"

echo "== ETHAN Super App APK 构建 =="

export JAVA_HOME="$(cygpath -w "$JDK" 2>/dev/null || echo "$JDK")"
export PATH="$JDK/bin:$PATH"
for f in "$JAVAC" "$KEYTOOL" "$AAPT2" "$ZIPALIGN" "$APKSIGNER" "$D8" "$PLATFORM_JAR"; do
  [ -f "$f" ] || { echo "缺少工具/依赖: $f"; exit 1; }
done

# 1. 清理与准备（assets = app/ + modules/*，与 H5 完全一致）
rm -rf android/build
mkdir -p android/build/assets/modules dist
cp -r app/. android/build/assets/
for m in my-space toolbox travel-footprint ethan; do
  cp -r modules/$m android/build/assets/modules/$m
done
echo "assets: $(ls android/build/assets | tr '\n' ' ')"

# 3. aapt2 link（--java 生成 R.java，随源码一起编译）
mkdir -p android/build/compiled android/build/r
"$AAPT2" compile --dir android/res -o android/build/compiled

"$AAPT2" link \
  -I "$PLATFORM_JAR" \
  --manifest android/AndroidManifest.xml \
  -A android/build/assets \
  --java android/build/r \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --auto-add-overlay \
  -o android/build/linked.apk \
  android/build/compiled/*.flat

# 4. javac → class
mkdir -p android/build/obj
"$JAVAC" -encoding UTF-8 -source 11 -target 11 -nowarn -Xlint:none \
  -classpath "$PLATFORM_JAR" \
  -d android/build/obj \
  android/build/r/cn/ethan/superapp/R.java \
  android/java/cn/ethan/superapp/*.java

# 5. d8 → dex
mkdir -p android/build/dex
"$JDK/bin/jar.exe" cf android/build/obj.jar -C android/build/obj .
"$D8" --min-api 24 --lib "$PLATFORM_JAR" --output android/build/dex \
  android/build/obj.jar
[ -f android/build/dex/classes.dex ] || { echo "未生成 classes.dex"; exit 1; }

# 6. dex 注入 APK（重建干净 zip）
python -c "
import zipfile,sys
src,dst,dex = sys.argv[1],sys.argv[2],sys.argv[3]
zin = zipfile.ZipFile(src)
zout = zipfile.ZipFile(dst,'w')
for info in zin.infolist():
    if info.filename == 'classes.dex': continue
    ni = zipfile.ZipInfo(info.filename, date_time=info.date_time)
    ni.compress_type = info.compress_type
    ni.external_attr = info.external_attr
    zout.writestr(ni, zin.read(info.filename))
ni = zipfile.ZipInfo('classes.dex', date_time=(2026,1,1,0,0,0))
ni.compress_type = zipfile.ZIP_STORED
ni.external_attr = 0o600 << 16
zout.writestr(ni, open(dex,'rb').read())
zout.close()
print('dex 注入完成')
" android/build/linked.apk android/build/linked2.apk android/build/dex/classes.dex

# 7. zipalign
"$ZIPALIGN" -p -f 4 android/build/linked2.apk android/build/aligned.apk

# 8. 签名（密钥不存在则生成；请妥善保留 keystore）
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  "$KEYTOOL" -genkeypair -keystore "$KS" -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=ETHAN SuperApp, OU=Personal, O=ETHAN, C=CN" -storetype JKS
  echo "已创建签名密钥: $KS"
fi

"$APKSIGNER" sign \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --ks "$KS" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$OUT" \
  android/build/aligned.apk

# 9. 静态验证
echo ""
echo "== 验证 =="
BADGING=$("$AAPT2" dump badging "$OUT")
echo "$BADGING" | grep -E "^package:|^application-label:|^sdkVersion:|^launchable-activity:" || true
PERMS=$(echo "$BADGING" | grep "uses-permission" || true)
echo "权限: ${PERMS:-（无）}"

if "$APKSIGNER" verify -v "$OUT" | grep -q "Verifies"; then
  echo "签名: 通过"
else
  echo "签名: 未通过"; exit 1
fi

ASSETS=$(python -c "import zipfile,sys; print('\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))" "$OUT")
echo "$ASSETS" | grep -q "^assets/index.html$" || { echo "assets 缺少超级 App index.html"; exit 1; }
echo "$ASSETS" | grep -q "^assets/modules/ethan/app/index.html$" || { echo "assets 缺少 ETHAN 模块"; exit 1; }
echo "$ASSETS" | grep -q "^assets/modules/travel-footprint/app/index.html$" || { echo "assets 缺少旅行足迹模块"; exit 1; }
echo "$BADGING" | grep -q "launchable-activity" || { echo "没有启动入口"; exit 1; }
if echo "$BADGING" | grep -q "android.permission.INTERNET"; then
  echo "出现了 INTERNET 权限（离线保证被破坏）"; exit 1
fi

echo ""
echo "APK   : $OUT"
SIZE=$(stat -c%s "$OUT" 2>/dev/null || wc -c < "$OUT")
echo "大小  : $((SIZE / 1024)) KB"
echo "SHA256: $(sha256sum "$OUT" | cut -d' ' -f1)"
echo ""
echo "构建完成 ✅"
