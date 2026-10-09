#!/bin/sh
# dsh-desktop-updater 的安装脚本。
#
# 由宿主插件以 detached 方式拉起，参数：
#   $1 = 下载好的 DMG 路径
#   $2 = 期望的版本号（校验用）
#   $3 = 当前 /Applications/DSH Desktop.app 的路径
#   $4 = 日志文件路径
#   $5 = real | dry-run（dry-run 只演练到暂存，不换 app、不重启）
#
# 顺序刻意如此：**先把新 app 完整落到暂存目录并验签，再退出旧 app，
# 最后才做「移开旧的 / 换上新的」**。任何一步失败都不会留下半个 app：
# 换 app 的两条 mv 之间出错会把旧的搬回来。
#
# 全程不碰别的东西：只动 $3 这一个 bundle、它的暂存兄弟目录，以及自己的 DMG。
#
# 注意：变量一律写成 ${VAR} 花括号形式。macOS 的 /bin/sh 会把紧跟其后的
# 多字节字符（比如「，」「（」）当成变量名的一部分，$APP， 会报 unbound variable。

set -u

DMG="$1"
EXPECT="$2"
APP="$3"
LOG="$4"
MODE="${5:-real}"

APP_DIR=$(dirname "${APP}")
STAGE="${APP_DIR}/.DSH Desktop.app.staging"
OLD="${APP_DIR}/.DSH Desktop.app.old-$$"
BUNDLE_ID="ai.deepseek.dsh.desktop"

log() {
	printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "${LOG}" 2>/dev/null || true
}

die() {
	log "失败：$*"
	log "安装中止，当前 app 未被改动。"
	exit 1
}

mount_point=""
cleanup_mount() {
	[ -n "${mount_point}" ] || return 0
	hdiutil detach "${mount_point}" -quiet >> "${LOG}" 2>&1 || hdiutil detach "${mount_point}" -force -quiet >> "${LOG}" 2>&1 || true
	rmdir "${mount_point}" 2>/dev/null || true
}
trap cleanup_mount EXIT

log "===== 开始安装：期望版本 ${EXPECT} -> ${APP} （模式 ${MODE}） ====="

[ -f "${DMG}" ] || die "找不到安装包 ${DMG}"
[ -d "${APP}" ] || die "找不到现有 app ${APP}"
[ -w "${APP_DIR}" ] || die "对 ${APP_DIR} 没有写权限，无法自动安装"

# ---------------------------------------------------------------------------
# 1. 挂载 DMG，取出里面的 .app
# ---------------------------------------------------------------------------

mount_point=$(mktemp -d /tmp/dsh-update.XXXXXX) || die "mktemp 失败"
hdiutil attach "${DMG}" -nobrowse -quiet -mountpoint "${mount_point}" >> "${LOG}" 2>&1 || die "挂载 DMG 失败：${DMG}"

SRC="${mount_point}/DSH Desktop.app"
if [ ! -d "${SRC}" ]; then
	for candidate in "${mount_point}"/*.app; do
		if [ -d "${candidate}" ]; then
			SRC="${candidate}"
			break
		fi
	done
fi
[ -d "${SRC}" ] || die "DMG 里没有 .app"
log "DMG 已挂载，源 app：${SRC}"

NEW_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${SRC}/Contents/Info.plist" 2>/dev/null)
[ "${NEW_ID}" = "${BUNDLE_ID}" ] || die "DMG 里的 app 不是 DSH Desktop，bundle id = ${NEW_ID}"

NEW_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${SRC}/Contents/Info.plist" 2>/dev/null)
[ "${NEW_VERSION}" = "${EXPECT}" ] || die "版本不匹配：DMG 里是 ${NEW_VERSION} ，期望 ${EXPECT}"

codesign --verify --deep --strict "${SRC}" >> "${LOG}" 2>&1 || die "新 app 的代码签名校验没通过"
log "源 app 校验通过：${NEW_ID} ${NEW_VERSION}"

# ---------------------------------------------------------------------------
# 2. 整份复制到暂存目录，再验一次（防截断）
# ---------------------------------------------------------------------------

if [ "${MODE}" = "dry-run" ]; then
	STAGE="$(dirname "${LOG}")/staged-app-dry-run"
fi
rm -rf "${STAGE}" || die "清不掉暂存目录 ${STAGE}"
ditto "${SRC}" "${STAGE}" >> "${LOG}" 2>&1 || die "复制到暂存目录失败"
if ! codesign --verify --deep --strict "${STAGE}" >> "${LOG}" 2>&1; then
	rm -rf "${STAGE}"
	die "暂存 app 验签失败，可能复制不完整"
fi
log "暂存完成并验签通过：${STAGE}"

if [ "${MODE}" = "dry-run" ]; then
	log "dry-run：到此为止，不动 ${APP} ，也不重启。"
	exit 0
fi

# ---------------------------------------------------------------------------
# 3. 退出正在运行的旧 app
#
# 为什么**不用** pkill -f <app 路径>：宿主进程带沙箱，**枚举不到 Electron 主进程**
# （实测：pgrep -f 一个都匹配不上，于是「请旧 app 退出」当场就以为它已经退了，
#   旧进程继续活着、用户看到的还是旧版本 —— 2026-10-09 踩过）。
# 改成三保险，谁先成谁算：
#   1) killall 按**进程名精确匹配**：只命中主进程，helper 叫「… Helper」不会误伤；
#   2) osascript 走 LaunchServices 请它正常退出：不依赖进程枚举；
#   3) 等它真的退：看它的 HTTP 端口关没关（也不依赖进程枚举），超时就 killall -KILL。
# 退不掉也不影响换 app（mv 对运行中的 bundle 是允许的），只是要等下次手动重启才生效。
# ---------------------------------------------------------------------------

APP_EXEC=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "${APP}/Contents/Info.plist" 2>/dev/null)
[ -n "${APP_EXEC}" ] || APP_EXEC="$(basename "${APP}" .app)"
HEALTH_URL="${DSH_WEB_URL:-}"

log "请旧 app 退出（进程名 ${APP_EXEC}，健康检查 ${HEALTH_URL:-无}）"
/usr/bin/killall -TERM "${APP_EXEC}" >> "${LOG}" 2>&1 || true
/usr/bin/osascript -e "tell application id \"${BUNDLE_ID}\" to quit" >> "${LOG}" 2>&1 || true

waited=0
while :; do
	if [ -n "${HEALTH_URL}" ]; then
		/usr/bin/curl -s -m 1 -o /dev/null "${HEALTH_URL}" || break
	else
		[ "${waited}" -ge 8 ] && break
	fi
	waited=$((waited + 1))
	if [ "${waited}" -ge 30 ]; then
		log "还没退干净，强制结束"
		/usr/bin/killall -KILL "${APP_EXEC}" >> "${LOG}" 2>&1 || true
	fi
	if [ "${waited}" -ge 60 ]; then
		break
	fi
	sleep 0.5
done
log "旧 app 已退出（等待了 ${waited} 个 0.5 秒）"

# ---------------------------------------------------------------------------
# 4. 换 app（失败就把旧的搬回来）
# ---------------------------------------------------------------------------

rm -rf "${OLD}" 2>/dev/null || true
mv "${APP}" "${OLD}" || die "无法把现有 app 移开"
if ! mv "${STAGE}" "${APP}"; then
	mv "${OLD}" "${APP}" 2>/dev/null || log "警告：回滚也没成功，旧 app 还在 ${OLD}"
	die "无法把新 app 放到 ${APP}"
fi
log "已替换：${APP} ，旧版本暂时留在 ${OLD}"

# ---------------------------------------------------------------------------
# 5. 收尾并重启
# ---------------------------------------------------------------------------

cleanup_mount
mount_point=""
rm -rf "${OLD}" >> "${LOG}" 2>&1 || log "警告：旧 app 清理失败，可手动删除 ${OLD}"
xattr -dr com.apple.quarantine "${APP}" >> "${LOG}" 2>&1 || true
rm -f "${DMG}" >> "${LOG}" 2>&1 || log "警告：安装包清理失败，可手动删除 ${DMG}"

case "${DSH_UPDATER_NO_RELAUNCH:-0}" in
	1 | true | yes)
		log "DSH_UPDATER_NO_RELAUNCH=1：已换好 app，跳过重启"
		exit 0
		;;
esac

log "重启新版本"
open "${APP}" >> "${LOG}" 2>&1 || die "重启失败，请手动打开 ${APP}"
log "===== 安装完成：${EXPECT} ====="
